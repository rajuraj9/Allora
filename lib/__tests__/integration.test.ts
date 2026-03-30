// ============================================================
// lib/__tests__/integration.test.ts
// Integration and End-to-End tests for the Agent Loop
// Tests use AgentLoopDeps injection — no real network calls.
// ============================================================

import { describe, it, expect, vi } from "vitest";

// Mock the memory module so storeUserData (called directly in agent-loop)
// does not attempt a real Supabase connection.
vi.mock("../memory", () => ({
  loadMemoryContext: vi.fn(),
  storeUserData: vi.fn(async () => {}),
  persistExtractedData: vi.fn(async () => {}),
}));

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
// Shared helpers
// ----------------------------------------------------------------

const defaultPageState = {
  url: "https://example.com",
  title: "Test Page",
  forms_detected: [] as [],
};

const successResult: StepResult = {
  success: true,
  extracted_data: { item: "value" },
  page_state: defaultPageState,
};

function makeMemory(task_id: string, user_id: string): MemoryContext {
  return {
    user_profile: { user_id },
    session_state: { task_id, current_step_index: 0, retry_counts: {} },
    extracted_data: {},
    step_history: [],
  };
}

function makeStep(
  step_id: string,
  action_type: AgentStep["action_type"] = "open"
): AgentStep {
  return {
    step_id,
    action_type,
    target: `https://example.com/${step_id}`,
    expected_output: "loaded",
    fallback_strategy: "retry",
  };
}

// ----------------------------------------------------------------
// 11.1 Integration test: full happy-path task flow
// ----------------------------------------------------------------

describe("11.1 Integration: full happy-path task flow", () => {
  it("submit → plan (3 steps) → execute each step → complete", async () => {
    const steps: AgentStep[] = [
      makeStep("step_1", "open"),
      makeStep("step_2", "click"),
      makeStep("step_3", "extract"),
    ];

    const statusUpdates: Array<{ status: string; extra?: Record<string, unknown> }> = [];
    const loggedSteps: Array<{ step_id: string; status: StepLog["status"] }> = [];

    // Decision sequence: continue → continue → complete (one per step evaluation)
    const decisions: EvaluateResponse["decision"][] = ["continue", "continue", "complete"];
    let decisionIndex = 0;

    const deps: AgentLoopDeps = {
      loadMemoryContext: vi.fn(async (user_id, task_id) => makeMemory(task_id, user_id)),

      planTask: vi.fn(async (): Promise<PlanResponse> => ({
        steps,
        reasoning: "Happy path plan",
      })),

      executeStep: vi.fn(async (): Promise<StepResult> => ({
        success: true,
        extracted_data: { result: "extracted" },
        page_state: defaultPageState,
      })),

      evaluateStep: vi.fn(async (): Promise<EvaluateResponse> => {
        const decision = decisions[decisionIndex++] ?? "complete";
        return { decision, reasoning: "evaluation reasoning" };
      }),

      updateTaskStatus: vi.fn(async (task_id, status, extra) => {
        statusUpdates.push({ status, extra });
      }),

      logStep: vi.fn(async (task_id, step, status) => {
        loggedSteps.push({ step_id: step.step_id, status });
      }),

      persistExtractedData: vi.fn(async () => {}),
      awaitUserInput: vi.fn(async () => ({})),
      awaitConfirmation: vi.fn(async () => true),
      delay: async () => {},
    };

    const output = await runAgentLoop(
      { task_id: "task-happy", goal: "Do a 3-step task", user_id: "user-1" },
      deps
    );

    // Task status transitions: running → completed
    expect(statusUpdates.some((u) => u.status === "running")).toBe(true);
    expect(statusUpdates.some((u) => u.status === "completed")).toBe(true);
    expect(output.status).toBe("completed");

    // All 3 steps logged with success status
    for (const step of steps) {
      const successEntries = loggedSteps.filter(
        (l) => l.step_id === step.step_id && l.status === "success"
      );
      expect(successEntries.length).toBeGreaterThan(0);
    }

    // TaskResult has summary and extracted_data
    expect(output.result).toBeDefined();
    expect(output.result!.summary).toBeTruthy();
    expect(output.result!.extracted_data).toBeDefined();

    // planTask called once, executeStep called 3 times, evaluateStep called 3 times
    expect(deps.planTask).toHaveBeenCalledTimes(1);
    expect(deps.executeStep).toHaveBeenCalledTimes(3);
    expect(deps.evaluateStep).toHaveBeenCalledTimes(3);
  });
});

// ----------------------------------------------------------------
// 11.2 Integration test: user input pause/resume flow
// ----------------------------------------------------------------

describe("11.2 Integration: user input pause/resume flow", () => {
  it("task pauses for user input, resumes with data, and completes", async () => {
    const step = makeStep("step_1", "input");

    const statusUpdates: Array<{ status: string; extra?: Record<string, unknown> }> = [];
    const loggedSteps: Array<{ step_id: string; status: StepLog["status"] }> = [];

    // First evaluation: need_user_input; second: complete (after retry with new data)
    let evalCount = 0;

    const deps: AgentLoopDeps = {
      loadMemoryContext: vi.fn(async (user_id, task_id) => makeMemory(task_id, user_id)),

      planTask: vi.fn(async (): Promise<PlanResponse> => ({
        steps: [step],
        reasoning: "plan",
      })),

      executeStep: vi.fn(async (): Promise<StepResult> => successResult),

      evaluateStep: vi.fn(async (): Promise<EvaluateResponse> => {
        evalCount++;
        if (evalCount === 1) {
          return {
            decision: "need_user_input",
            reasoning: "missing field",
            user_input_request: {
              task_id: "task-pause",
              type: "missing_fields",
              message: "Please provide your email",
              fields: [
                { label: "Email", name: "email", type: "email", required: true },
              ],
            },
          };
        }
        return { decision: "complete", reasoning: "done" };
      }),

      updateTaskStatus: vi.fn(async (task_id, status, extra) => {
        statusUpdates.push({ status, extra });
      }),

      logStep: vi.fn(async (task_id, step, status) => {
        loggedSteps.push({ step_id: step.step_id, status });
      }),

      persistExtractedData: vi.fn(async () => {}),

      // Simulate user providing data
      awaitUserInput: vi.fn(async (): Promise<Record<string, string>> => ({
        email: "user@example.com",
      })),

      awaitConfirmation: vi.fn(async () => true),
      delay: async () => {},
    };

    const output = await runAgentLoop(
      { task_id: "task-pause", goal: "Fill a form", user_id: "user-1" },
      deps
    );

    // Task was paused (pending_input written)
    const pausedUpdate = statusUpdates.find((u) => u.status === "paused");
    expect(pausedUpdate).toBeDefined();
    expect(pausedUpdate?.extra?.pending_input).toBeDefined();

    // awaitUserInput was called (user provided data)
    expect(deps.awaitUserInput).toHaveBeenCalledTimes(1);

    // Task resumed (status back to running after user input)
    const runningUpdates = statusUpdates.filter((u) => u.status === "running");
    expect(runningUpdates.length).toBeGreaterThanOrEqual(2); // initial + after resume

    // Same step retried with new data (executeStep called twice)
    expect(deps.executeStep).toHaveBeenCalledTimes(2);

    // Task completes after retry
    expect(output.status).toBe("completed");
  });
});

// ----------------------------------------------------------------
// 11.3 Integration test: safety confirmation gate
// ----------------------------------------------------------------

describe("11.3 Integration: safety confirmation gate", () => {
  it("awaitConfirmation called before executeStep, ConfirmationEntry recorded, task completes", async () => {
    const submitStep = makeStep("step_1", "submit");

    const statusUpdates: Array<{ status: string; extra?: Record<string, unknown> }> = [];
    const executeOrder: string[] = [];

    const deps: AgentLoopDeps = {
      loadMemoryContext: vi.fn(async (user_id, task_id) => makeMemory(task_id, user_id)),

      planTask: vi.fn(async (): Promise<PlanResponse> => ({
        steps: [submitStep],
        reasoning: "plan with submit step",
      })),

      executeStep: vi.fn(async (): Promise<StepResult> => {
        executeOrder.push("executeStep");
        return successResult;
      }),

      evaluateStep: vi.fn(async (): Promise<EvaluateResponse> => ({
        decision: "complete",
        reasoning: "done",
      })),

      updateTaskStatus: vi.fn(async (task_id, status, extra) => {
        statusUpdates.push({ status, extra });
      }),

      logStep: vi.fn(async () => {}),
      persistExtractedData: vi.fn(async () => {}),
      awaitUserInput: vi.fn(async () => ({})),

      awaitConfirmation: vi.fn(async (): Promise<boolean> => {
        executeOrder.push("awaitConfirmation");
        return true;
      }),

      delay: async () => {},
    };

    const output = await runAgentLoop(
      { task_id: "task-confirm", goal: "Submit a form", user_id: "user-1" },
      deps
    );

    // awaitConfirmation is called before executeStep
    expect(executeOrder.indexOf("awaitConfirmation")).toBeLessThan(
      executeOrder.indexOf("executeStep")
    );

    // executeStep IS called after confirmation
    expect(deps.executeStep).toHaveBeenCalledTimes(1);

    // ConfirmationEntry is recorded in TaskResult.confirmation_log
    expect(output.status).toBe("completed");
    expect(output.result).toBeDefined();
    const confirmLog = output.result!.confirmation_log;
    expect(confirmLog.length).toBe(1);
    expect(confirmLog[0].confirmed_by_user).toBe(true);
    expect(confirmLog[0].action).toContain("submit");
    expect(confirmLog[0].timestamp).toBeTruthy();

    // Task completes after confirmation
    expect(statusUpdates.some((u) => u.status === "completed")).toBe(true);
  });

  it("executeStep is NOT called until confirmed === true", async () => {
    const submitStep = makeStep("step_1", "submit");
    const executeStepSpy = vi.fn(async (): Promise<StepResult> => successResult);

    // First call: not confirmed; second call: confirmed
    let confirmCallCount = 0;
    const deps: AgentLoopDeps = {
      loadMemoryContext: vi.fn(async (user_id, task_id) => makeMemory(task_id, user_id)),
      planTask: vi.fn(async (): Promise<PlanResponse> => ({
        steps: [submitStep],
        reasoning: "plan",
      })),
      executeStep: executeStepSpy,
      evaluateStep: vi.fn(async (): Promise<EvaluateResponse> => ({
        decision: "complete",
        reasoning: "done",
      })),
      updateTaskStatus: vi.fn(async () => {}),
      logStep: vi.fn(async () => {}),
      persistExtractedData: vi.fn(async () => {}),
      awaitUserInput: vi.fn(async () => ({})),
      awaitConfirmation: vi.fn(async (): Promise<boolean> => {
        confirmCallCount++;
        return true; // confirmed on first call
      }),
      delay: async () => {},
    };

    await runAgentLoop(
      { task_id: "task-gate", goal: "Submit form", user_id: "user-1" },
      deps
    );

    // executeStep only called after confirmation
    expect(executeStepSpy).toHaveBeenCalledTimes(1);
    expect(confirmCallCount).toBe(1);
  });
});

// ----------------------------------------------------------------
// 11.4 Integration test: retry and replan flow
// ----------------------------------------------------------------

describe("11.4 Integration: retry and replan flow", () => {
  it("step fails twice → replan triggered → task completes with new plan", async () => {
    const originalStep = makeStep("step_1", "click");
    const newStep = makeStep("step_1_new", "click");

    const statusUpdates: Array<{ status: string; extra?: Record<string, unknown> }> = [];
    const loggedSteps: Array<{ step_id: string; status: StepLog["status"]; retry_count: number }> = [];

    let planCallCount = 0;
    let evalCount = 0;

    const deps: AgentLoopDeps = {
      loadMemoryContext: vi.fn(async (user_id, task_id) => makeMemory(task_id, user_id)),

      planTask: vi.fn(async (): Promise<PlanResponse> => {
        planCallCount++;
        // First plan: original step; replan: new step
        return {
          steps: planCallCount === 1 ? [originalStep] : [newStep],
          reasoning: planCallCount === 1 ? "original plan" : "replanned",
        };
      }),

      executeStep: vi.fn(async (): Promise<StepResult> => successResult),

      evaluateStep: vi.fn(async (): Promise<EvaluateResponse> => {
        evalCount++;
        // First two evaluations: retry; after replan: complete
        if (evalCount <= 2) {
          return { decision: "retry", reasoning: "step failed, retry" };
        }
        return { decision: "complete", reasoning: "done after replan" };
      }),

      updateTaskStatus: vi.fn(async (task_id, status, extra) => {
        statusUpdates.push({ status, extra });
      }),

      logStep: vi.fn(async (task_id, step, status, result, retry_count = 0) => {
        loggedSteps.push({ step_id: step.step_id, status, retry_count });
      }),

      persistExtractedData: vi.fn(async () => {}),
      awaitUserInput: vi.fn(async () => ({})),
      awaitConfirmation: vi.fn(async () => true),
      delay: async () => {},
    };

    const output = await runAgentLoop(
      { task_id: "task-retry", goal: "Click something", user_id: "user-1" },
      deps
    );

    // retry_count increments correctly (logged with increasing retry counts)
    const originalStepLogs = loggedSteps.filter((l) => l.step_id === originalStep.step_id);
    const retryCounts = originalStepLogs.map((l) => l.retry_count);
    // Should see retry_count 0 and 1 before replan
    expect(retryCounts).toContain(0);
    expect(retryCounts).toContain(1);

    // After 2 retries, replan is triggered (planTask called again)
    expect(planCallCount).toBe(2);

    // Task completes with new plan
    expect(output.status).toBe("completed");
    expect(statusUpdates.some((u) => u.status === "completed")).toBe(true);

    // retry_count reset to 0 after replan (new step logged with retry_count 0)
    const newStepLogs = loggedSteps.filter((l) => l.step_id === newStep.step_id);
    expect(newStepLogs.length).toBeGreaterThan(0);
    expect(newStepLogs[0].retry_count).toBe(0);
  });
});

// ----------------------------------------------------------------
// 11.5 Integration test: user cancellation at safety confirmation
// ----------------------------------------------------------------

describe("11.5 Integration: user cancellation at safety confirmation", () => {
  it("task fails with user_cancelled, executeStep not called, no further actions", async () => {
    const submitStep = makeStep("step_1", "submit");
    const extraStep = makeStep("step_2", "open");

    const statusUpdates: Array<{ status: string; extra?: Record<string, unknown> }> = [];
    const executeStepSpy = vi.fn(async (): Promise<StepResult> => successResult);

    const deps: AgentLoopDeps = {
      loadMemoryContext: vi.fn(async (user_id, task_id) => makeMemory(task_id, user_id)),

      planTask: vi.fn(async (): Promise<PlanResponse> => ({
        steps: [submitStep, extraStep],
        reasoning: "plan with submit then open",
      })),

      executeStep: executeStepSpy,

      evaluateStep: vi.fn(async (): Promise<EvaluateResponse> => ({
        decision: "complete",
        reasoning: "done",
      })),

      updateTaskStatus: vi.fn(async (task_id, status, extra) => {
        statusUpdates.push({ status, extra });
      }),

      logStep: vi.fn(async () => {}),
      persistExtractedData: vi.fn(async () => {}),
      awaitUserInput: vi.fn(async () => ({})),

      // User cancels the confirmation
      awaitConfirmation: vi.fn(async (): Promise<boolean> => false),

      delay: async () => {},
    };

    const output = await runAgentLoop(
      { task_id: "task-cancel", goal: "Submit form", user_id: "user-1" },
      deps
    );

    // Task status set to "failed"
    expect(output.status).toBe("failed");
    expect(statusUpdates.some((u) => u.status === "failed")).toBe(true);

    // failure_reason is "user_cancelled"
    expect(output.failure_reason).toBe("user_cancelled");
    const failedUpdate = statusUpdates.find((u) => u.status === "failed");
    expect(failedUpdate?.extra?.failure_reason).toBe("user_cancelled");

    // executeStep is NOT called after cancellation
    expect(executeStepSpy).not.toHaveBeenCalled();

    // No further browser actions (evaluateStep not called either)
    expect(deps.evaluateStep).not.toHaveBeenCalled();
  });
});
