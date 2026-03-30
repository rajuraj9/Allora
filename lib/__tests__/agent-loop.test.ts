// ============================================================
// lib/__tests__/agent-loop.test.ts
// Property-based and unit tests for the Agent Loop
// ============================================================

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { runAgentLoop, UserCancelledError } from "../agent-loop";
import type { AgentLoopDeps } from "../agent-loop";
import type {
  AgentStep,
  MemoryContext,
  StepResult,
  StepLog,
  UserInputRequest,
} from "../types";
import type { PlanResponse, EvaluateResponse } from "../gemini";

// ----------------------------------------------------------------
// Arbitraries
// ----------------------------------------------------------------

const actionTypeArb = fc.constantFrom(
  "search",
  "open",
  "click",
  "input",
  "extract",
  "select",
  "submit",
  "scroll",
  "upload",
  "wait"
) as fc.Arbitrary<AgentStep["action_type"]>;

// Non-safety-gated action types (no submit/upload)
const safeActionTypeArb = fc.constantFrom(
  "search",
  "open",
  "click",
  "input",
  "extract",
  "select",
  "scroll",
  "wait"
) as fc.Arbitrary<AgentStep["action_type"]>;

// Safety-gated action types
const gatedActionTypeArb = fc.constantFrom(
  "submit",
  "upload"
) as fc.Arbitrary<AgentStep["action_type"]>;

const agentStepArb = (actionType?: fc.Arbitrary<AgentStep["action_type"]>): fc.Arbitrary<AgentStep> =>
  fc.record({
    step_id: fc.string({ minLength: 1, maxLength: 20 }).map((s) => `step_${s}`),
    action_type: actionType ?? actionTypeArb,
    target: fc.string({ minLength: 1, maxLength: 50 }),
    expected_output: fc.string({ minLength: 1, maxLength: 50 }),
    fallback_strategy: fc.string({ minLength: 1, maxLength: 50 }),
  });

const defaultPageState = {
  url: "https://example.com",
  title: "Test",
  forms_detected: [] as [],
};

const successResult: StepResult = {
  success: true,
  page_state: defaultPageState,
};

const failResult: StepResult = {
  success: false,
  error: { type: "element_not_found", message: "not found" },
  page_state: defaultPageState,
};

function makeMemoryContext(task_id: string, user_id: string): MemoryContext {
  return {
    user_profile: { user_id },
    session_state: { task_id, current_step_index: 0, retry_counts: {} },
    extracted_data: {},
    step_history: [],
  };
}

// ----------------------------------------------------------------
// Dep builder helpers
// ----------------------------------------------------------------

type LoggedStep = { step_id: string; status: StepLog["status"] };

interface TestDepsOptions {
  /** Steps to plan (default: one safe step) */
  steps?: AgentStep[];
  /** Decision sequence — one per step execution */
  decisions?: EvaluateResponse["decision"][];
  /** Whether awaitConfirmation returns true */
  confirmationResult?: boolean;
  /** Whether awaitUserInput throws UserCancelledError */
  userInputCancels?: boolean;
  /** Collect logged steps here */
  loggedSteps?: LoggedStep[];
  /** Collect updateTaskStatus calls here */
  statusUpdates?: Array<{ status: string; extra?: Record<string, unknown> }>;
}

function makeDeps(opts: TestDepsOptions = {}): AgentLoopDeps {
  const {
    steps = [
      {
        step_id: "step_1",
        action_type: "open",
        target: "https://example.com",
        expected_output: "loaded",
        fallback_strategy: "retry",
      },
    ],
    decisions = ["complete"],
    confirmationResult = true,
    userInputCancels = false,
    loggedSteps = [],
    statusUpdates = [],
  } = opts;

  let decisionIndex = 0;

  const deps: AgentLoopDeps = {
    loadMemoryContext: vi.fn(async (user_id, task_id) =>
      makeMemoryContext(task_id, user_id)
    ),

    planTask: vi.fn(async () => ({
      steps,
      reasoning: "test plan",
    } satisfies PlanResponse)),

    executeStep: vi.fn(async () => successResult),

    evaluateStep: vi.fn(async () => {
      const decision = decisions[decisionIndex] ?? "complete";
      decisionIndex++;
      return {
        decision,
        reasoning: "test reasoning",
      } satisfies EvaluateResponse;
    }),

    updateTaskStatus: vi.fn(async (task_id, status, extra) => {
      statusUpdates.push({ status, extra });
    }),

    logStep: vi.fn(async (task_id, step, status) => {
      loggedSteps.push({ step_id: step.step_id, status });
    }),

    persistExtractedData: vi.fn(async () => {}),

    awaitUserInput: vi.fn(async () => {
      if (userInputCancels) throw new UserCancelledError();
      return { field: "value" };
    }),

    awaitConfirmation: vi.fn(async () => confirmationResult),
    delay: vi.fn(async () => {}), // zero delay for tests
  };

  return deps;
}

// ----------------------------------------------------------------
// Property 4: retry_count for any step never exceeds 3 before replan
// Validates: Requirements 5.3, 5.4
// ----------------------------------------------------------------

describe("Property 4: retry_count never exceeds 3 before replan is triggered", () => {
  it("forces replan when retry_count reaches 2 for any step", async () => {
    await fc.assert(
      fc.asyncProperty(
        agentStepArb(safeActionTypeArb),
        async (step) => {
          const loggedSteps: LoggedStep[] = [];
          const statusUpdates: Array<{ status: string; extra?: Record<string, unknown> }> = [];

          // Track how many times executeStep is called per step_id
          const executionCounts: Record<string, number> = {};
          let replanTriggered = false;
          let planCallCount = 0;

          const deps: AgentLoopDeps = {
            loadMemoryContext: vi.fn(async (user_id, task_id) =>
              makeMemoryContext(task_id, user_id)
            ),

            planTask: vi.fn(async () => {
              planCallCount++;
              if (planCallCount > 1) replanTriggered = true;
              return { steps: [step], reasoning: "plan" } satisfies PlanResponse;
            }),

            executeStep: vi.fn(async () => {
              executionCounts[step.step_id] =
                (executionCounts[step.step_id] ?? 0) + 1;
              return successResult;
            }),

            evaluateStep: vi.fn(async () => {
              const count = executionCounts[step.step_id] ?? 0;
              // Keep returning "retry" until replan is forced, then complete
              if (replanTriggered) {
                return { decision: "complete", reasoning: "done" } satisfies EvaluateResponse;
              }
              return { decision: "retry", reasoning: "retry" } satisfies EvaluateResponse;
            }),

            updateTaskStatus: vi.fn(async (_, status, extra) => {
              statusUpdates.push({ status, extra });
            }),

            logStep: vi.fn(async (_, s, status) => {
              loggedSteps.push({ step_id: s.step_id, status });
            }),

            persistExtractedData: vi.fn(async () => {}),
            awaitUserInput: vi.fn(async () => ({})),
            awaitConfirmation: vi.fn(async () => true),
            delay: vi.fn(async () => {}), // zero delay for tests
          };

          const output = await runAgentLoop(
            { task_id: "t1", goal: "test", user_id: "u1" },
            deps
          );

          // The loop must have completed (not hung)
          expect(["completed", "failed", "paused"]).toContain(output.status);

          // retry_count for the step must never exceed 3 before replan
          // i.e., the step is executed at most 3 times before replan fires
          // (2 retries = 3 total executions in first plan, then replan)
          const totalExecutions = executionCounts[step.step_id] ?? 0;
          // After 2 retries (count reaches 2), replan fires. So in the first
          // plan cycle the step runs at most 3 times (original + 2 retries).
          // After replan, it runs once more to complete.
          expect(totalExecutions).toBeLessThanOrEqual(4);
          expect(replanTriggered).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });

  it("does not replan when retry_count is below 2", async () => {
    const step: AgentStep = {
      step_id: "step_1",
      action_type: "open",
      target: "https://example.com",
      expected_output: "loaded",
      fallback_strategy: "retry",
    };

    let planCallCount = 0;
    const deps: AgentLoopDeps = {
      ...makeDeps({ steps: [step] }),
      planTask: vi.fn(async () => {
        planCallCount++;
        return { steps: [step], reasoning: "plan" };
      }),
      evaluateStep: vi.fn(async () => ({
        decision: "retry" as const,
        reasoning: "retry once",
      })),
    };

    // Override evaluateStep to return retry once then complete
    let evalCount = 0;
    deps.evaluateStep = vi.fn(async () => {
      evalCount++;
      if (evalCount === 1) return { decision: "retry" as const, reasoning: "retry" };
      return { decision: "complete" as const, reasoning: "done" };
    });

    await runAgentLoop({ task_id: "t1", goal: "test", user_id: "u1" }, deps);

    // Only 1 plan call (no replan triggered)
    expect(planCallCount).toBe(1);
  });
});

// ----------------------------------------------------------------
// Property 1: Completed tasks always have all steps logged (status !== "pending")
// Validates: Requirements 3.2, 3.3, 10.4
// ----------------------------------------------------------------

describe("Property 1: completed tasks have all steps logged with non-pending status", () => {
  it("every step in the plan has a logged entry when task completes", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(agentStepArb(safeActionTypeArb), { minLength: 1, maxLength: 5 }),
        async (steps) => {
          // Ensure unique step_ids
          const uniqueSteps = steps.map((s, i) => ({
            ...s,
            step_id: `step_${i + 1}`,
          }));

          const loggedSteps: LoggedStep[] = [];
          // One "continue" per step except last which is "complete"
          const decisions: EvaluateResponse["decision"][] = [
            ...Array(uniqueSteps.length - 1).fill("continue"),
            "complete",
          ];

          const deps = makeDeps({
            steps: uniqueSteps,
            decisions,
            loggedSteps,
          });

          const output = await runAgentLoop(
            { task_id: "t1", goal: "test", user_id: "u1" },
            deps
          );

          expect(output.status).toBe("completed");

          // Every step must have been logged at least once with a non-pending status
          for (const step of uniqueSteps) {
            const entries = loggedSteps.filter((l) => l.step_id === step.step_id);
            expect(entries.length).toBeGreaterThan(0);
            // At least one entry must not be "pending"
            const nonPending = entries.filter((e) => e.status !== "pending");
            expect(nonPending.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("steps are logged as running before execution", async () => {
    const loggedSteps: LoggedStep[] = [];
    const deps = makeDeps({ loggedSteps });

    await runAgentLoop({ task_id: "t1", goal: "test", user_id: "u1" }, deps);

    // The step must have been logged as "running" at some point
    const runningEntries = loggedSteps.filter((l) => l.status === "running");
    expect(runningEntries.length).toBeGreaterThan(0);
  });
});

// ----------------------------------------------------------------
// Property 7: Failed tasks always have non-empty failure_reason
// Validates: Requirements 10.5, 12.4
// ----------------------------------------------------------------

describe("Property 7: failed tasks always have non-empty failure_reason", () => {
  it("failure_reason is non-empty when evaluateStep returns fail", async () => {
    await fc.assert(
      fc.asyncProperty(
        agentStepArb(safeActionTypeArb),
        fc.string({ minLength: 1, maxLength: 100 }),
        async (step, reasoning) => {
          const statusUpdates: Array<{ status: string; extra?: Record<string, unknown> }> = [];
          const deps = makeDeps({
            steps: [step],
            decisions: ["fail"],
            statusUpdates,
          });

          // Override evaluateStep to return fail with the given reasoning
          deps.evaluateStep = vi.fn(async () => ({
            decision: "fail" as const,
            reasoning,
          }));

          const output = await runAgentLoop(
            { task_id: "t1", goal: "test", user_id: "u1" },
            deps
          );

          expect(output.status).toBe("failed");
          expect(output.failure_reason).toBeTruthy();
          expect(output.failure_reason!.length).toBeGreaterThan(0);

          // The Supabase update must also have a non-empty failure_reason
          const failedUpdate = statusUpdates.find((u) => u.status === "failed");
          expect(failedUpdate).toBeDefined();
          const reason = failedUpdate?.extra?.failure_reason;
          expect(typeof reason).toBe("string");
          expect((reason as string).length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("failure_reason is non-empty even when reasoning is empty string", async () => {
    const step: AgentStep = {
      step_id: "step_1",
      action_type: "open",
      target: "https://example.com",
      expected_output: "loaded",
      fallback_strategy: "retry",
    };

    const deps = makeDeps({ steps: [step] });
    deps.evaluateStep = vi.fn(async () => ({
      decision: "fail" as const,
      reasoning: "",
    }));

    const output = await runAgentLoop(
      { task_id: "t1", goal: "test", user_id: "u1" },
      deps
    );

    expect(output.status).toBe("failed");
    expect(output.failure_reason).toBeTruthy();
    expect(output.failure_reason!.length).toBeGreaterThan(0);
  });

  it("failure_reason is non-empty when user cancels at safety confirmation", async () => {
    const step: AgentStep = {
      step_id: "step_1",
      action_type: "submit",
      target: "#form",
      expected_output: "submitted",
      fallback_strategy: "retry",
    };

    const statusUpdates: Array<{ status: string; extra?: Record<string, unknown> }> = [];
    const deps = makeDeps({
      steps: [step],
      confirmationResult: false,
      statusUpdates,
    });

    const output = await runAgentLoop(
      { task_id: "t1", goal: "test", user_id: "u1" },
      deps
    );

    expect(output.status).toBe("failed");
    expect(output.failure_reason).toBeTruthy();
    expect(output.failure_reason!.length).toBeGreaterThan(0);

    const failedUpdate = statusUpdates.find((u) => u.status === "failed");
    expect(failedUpdate?.extra?.failure_reason).toBeTruthy();
  });
});

// ----------------------------------------------------------------
// Property 6: Safety-gated steps always have a prior ConfirmationEntry
// Validates: Requirements 7.1, 7.5
// ----------------------------------------------------------------

describe("Property 6: safety-gated steps always have a prior ConfirmationEntry", () => {
  it("confirmation_log contains an entry for every safety-gated step that executes", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(agentStepArb(gatedActionTypeArb), { minLength: 1, maxLength: 3 }),
        async (gatedSteps) => {
          const uniqueSteps = gatedSteps.map((s, i) => ({
            ...s,
            step_id: `step_${i + 1}`,
          }));

          const decisions: EvaluateResponse["decision"][] = [
            ...Array(uniqueSteps.length - 1).fill("continue"),
            "complete",
          ];

          const deps = makeDeps({
            steps: uniqueSteps,
            decisions,
            confirmationResult: true,
          });

          const output = await runAgentLoop(
            { task_id: "t1", goal: "test", user_id: "u1" },
            deps
          );

          expect(output.status).toBe("completed");
          expect(output.result).toBeDefined();

          const confirmLog = output.result!.confirmation_log;
          // Every gated step must have a ConfirmationEntry
          expect(confirmLog.length).toBe(uniqueSteps.length);
          for (const entry of confirmLog) {
            expect(entry.confirmed_by_user).toBe(true);
            expect(entry.action).toBeTruthy();
            expect(entry.timestamp).toBeTruthy();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it("safety-gated step does not execute when user cancels — task fails with confirmation logged", async () => {
    const step: AgentStep = {
      step_id: "step_1",
      action_type: "submit",
      target: "#checkout",
      expected_output: "submitted",
      fallback_strategy: "retry",
    };

    const executeStepSpy = vi.fn(async () => successResult);
    const deps = makeDeps({ steps: [step], confirmationResult: false });
    deps.executeStep = executeStepSpy;

    const output = await runAgentLoop(
      { task_id: "t1", goal: "test", user_id: "u1" },
      deps
    );

    expect(output.status).toBe("failed");
    expect(output.failure_reason).toBe("user_cancelled");
    // executeStep must NOT have been called (step was gated)
    expect(executeStepSpy).not.toHaveBeenCalled();
  });

  it("awaitConfirmation is called for every safety-gated step", async () => {
    const steps: AgentStep[] = [
      {
        step_id: "step_1",
        action_type: "submit",
        target: "#form",
        expected_output: "submitted",
        fallback_strategy: "retry",
      },
      {
        step_id: "step_2",
        action_type: "upload",
        target: "#file",
        expected_output: "uploaded",
        fallback_strategy: "retry",
      },
    ];

    const deps = makeDeps({
      steps,
      decisions: ["continue", "complete"],
      confirmationResult: true,
    });

    await runAgentLoop({ task_id: "t1", goal: "test", user_id: "u1" }, deps);

    expect(deps.awaitConfirmation).toHaveBeenCalledTimes(2);
  });
});

// ----------------------------------------------------------------
// Additional unit tests for core behaviours
// ----------------------------------------------------------------

describe("runAgentLoop — core behaviours", () => {
  it("returns completed with result when all steps succeed", async () => {
    const deps = makeDeps();
    const output = await runAgentLoop(
      { task_id: "t1", goal: "test", user_id: "u1" },
      deps
    );

    expect(output.status).toBe("completed");
    expect(output.result).toBeDefined();
    expect(output.result!.summary).toBeTruthy();
    expect(output.result!.confirmation_log).toBeInstanceOf(Array);
  });

  it("returns paused when awaitConfirmation throws (production stub)", async () => {
    const step: AgentStep = {
      step_id: "step_1",
      action_type: "submit",
      target: "#form",
      expected_output: "submitted",
      fallback_strategy: "retry",
    };

    const deps = makeDeps({ steps: [step] });
    deps.awaitConfirmation = vi.fn(async () => {
      throw new Error("production stub");
    });

    const output = await runAgentLoop(
      { task_id: "t1", goal: "test", user_id: "u1" },
      deps
    );

    expect(output.status).toBe("paused");
  });

  it("returns paused when awaitUserInput throws (production stub)", async () => {
    const step: AgentStep = {
      step_id: "step_1",
      action_type: "open",
      target: "https://example.com",
      expected_output: "loaded",
      fallback_strategy: "retry",
    };

    const deps = makeDeps({ steps: [step], decisions: ["need_user_input"] });
    deps.awaitUserInput = vi.fn(async () => {
      throw new Error("production stub");
    });

    const output = await runAgentLoop(
      { task_id: "t1", goal: "test", user_id: "u1" },
      deps
    );

    expect(output.status).toBe("paused");
  });

  it("returns failed with user_cancelled when user cancels input", async () => {
    const step: AgentStep = {
      step_id: "step_1",
      action_type: "open",
      target: "https://example.com",
      expected_output: "loaded",
      fallback_strategy: "retry",
    };

    const deps = makeDeps({
      steps: [step],
      decisions: ["need_user_input"],
      userInputCancels: true,
    });

    const output = await runAgentLoop(
      { task_id: "t1", goal: "test", user_id: "u1" },
      deps
    );

    expect(output.status).toBe("failed");
    expect(output.failure_reason).toBe("user_cancelled");
  });

  it("persists extracted_data when step returns it", async () => {
    const step: AgentStep = {
      step_id: "step_1",
      action_type: "extract",
      target: ".price",
      expected_output: "price extracted",
      fallback_strategy: "retry",
    };

    const deps = makeDeps({ steps: [step] });
    deps.executeStep = vi.fn(async () => ({
      success: true,
      extracted_data: { price: "29.99" },
      page_state: defaultPageState,
    }));

    await runAgentLoop({ task_id: "t1", goal: "test", user_id: "u1" }, deps);

    expect(deps.persistExtractedData).toHaveBeenCalledWith(
      "t1",
      "u1",
      expect.objectContaining({ price: "29.99" })
    );
  });

  it("calls planTask again on replan decision", async () => {
    const step: AgentStep = {
      step_id: "step_1",
      action_type: "open",
      target: "https://example.com",
      expected_output: "loaded",
      fallback_strategy: "retry",
    };

    let evalCount = 0;
    const deps = makeDeps({ steps: [step] });
    deps.evaluateStep = vi.fn(async () => {
      evalCount++;
      if (evalCount === 1) return { decision: "replan" as const, reasoning: "replan" };
      return { decision: "complete" as const, reasoning: "done" };
    });

    await runAgentLoop({ task_id: "t1", goal: "test", user_id: "u1" }, deps);

    // planTask called twice: initial + replan
    expect(deps.planTask).toHaveBeenCalledTimes(2);
  });

  it("task status is set to running at start", async () => {
    const statusUpdates: Array<{ status: string }> = [];
    const deps = makeDeps({ statusUpdates });

    await runAgentLoop({ task_id: "t1", goal: "test", user_id: "u1" }, deps);

    expect(statusUpdates.some((u) => u.status === "running")).toBe(true);
  });

  it("task status is set to completed on success", async () => {
    const statusUpdates: Array<{ status: string }> = [];
    const deps = makeDeps({ statusUpdates });

    await runAgentLoop({ task_id: "t1", goal: "test", user_id: "u1" }, deps);

    expect(statusUpdates.some((u) => u.status === "completed")).toBe(true);
  });

  it("task status is set to paused when safety confirmation is needed", async () => {
    const step: AgentStep = {
      step_id: "step_1",
      action_type: "submit",
      target: "#form",
      expected_output: "submitted",
      fallback_strategy: "retry",
    };

    const statusUpdates: Array<{ status: string }> = [];
    const deps = makeDeps({
      steps: [step],
      confirmationResult: true,
      statusUpdates,
    });

    await runAgentLoop({ task_id: "t1", goal: "test", user_id: "u1" }, deps);

    expect(statusUpdates.some((u) => u.status === "paused")).toBe(true);
  });
});
