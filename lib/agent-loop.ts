// ============================================================
// lib/agent-loop.ts
// Agent Loop — orchestrates plan → execute → evaluate cycle
//
// NOTE: The session_state table should have an `extracted_data` JSONB column.
// If not already present, add:
//   ALTER TABLE session_state ADD COLUMN IF NOT EXISTS extracted_data JSONB DEFAULT '{}';
// ============================================================

import type {
  AgentLoopInput,
  AgentLoopOutput,
  AgentStep,
  MemoryContext,
  StepLog,
  StepResult,
  TaskResult,
  ConfirmationEntry,
  UserInputRequest,
} from "./types";
import { loadMemoryContext, storeUserData, persistExtractedData } from "./memory";
import { planTask } from "./gemini";
import type { PlanResponse, EvaluateResponse } from "./gemini";
import { resolveTask } from "./gemini";
import { executeStep } from "./tinyfish";
import { requiresSafetyConfirmation } from "./safety";
import { getSupabaseClient } from "./supabase";

// ----------------------------------------------------------------
// UserCancelledError
// ----------------------------------------------------------------

export class UserCancelledError extends Error {
  constructor(message = "User cancelled the operation") {
    super(message);
    this.name = "UserCancelledError";
  }
}

// ----------------------------------------------------------------
// AgentLoopDeps — injectable dependencies for full testability
// ----------------------------------------------------------------

export interface AgentLoopDeps {
  /** Load memory context from Supabase */
  loadMemoryContext: (user_id: string, task_id: string) => Promise<MemoryContext>;
  /** Generate a step plan from Gemini */
  planTask: (
    goal: string,
    memory_context: MemoryContext,
    max_steps?: number
  ) => Promise<PlanResponse>;
  /** Execute a single browser step via TinyFish */
  executeStep: (
    session_id: string,
    step: AgentStep,
    onStreamingUrl?: (url: string) => Promise<void>,
    onProgress?: (purpose: string) => void
  ) => Promise<StepResult>;
  /** Evaluate a step result via Gemini */
  evaluateStep: (
    step: AgentStep,
    result: StepResult,
    remaining_steps: AgentStep[],
    retry_count: number
  ) => Promise<EvaluateResponse>;
  /** Update task status in Supabase */
  updateTaskStatus: (
    task_id: string,
    status: string,
    extra?: Record<string, unknown>
  ) => Promise<void>;
  /** Log a step entry in Supabase */
  logStep: (
    task_id: string,
    step: AgentStep,
    status: StepLog["status"],
    result?: StepResult,
    retry_count?: number
  ) => Promise<void>;
  /** Patch the result field of an existing step log row (for streaming URL updates) */
  patchStepResult: (task_id: string, step_id: string, result: StepResult) => Promise<void>;
  /** Persist extracted data to session state */
  persistExtractedData: (
    task_id: string,
    user_id: string,
    extracted_data: Record<string, unknown>
  ) => Promise<void>;
  /**
   * Pause and await user-provided field values.
   * Throws UserCancelledError if the user cancels.
   */
  awaitUserInput: (
    task_id: string,
    request: UserInputRequest
  ) => Promise<Record<string, string>>;
  /**
   * Pause and await a boolean safety confirmation from the user.
   * Returns true if approved, false if cancelled.
   */
  awaitConfirmation: (
    task_id: string,
    request: UserInputRequest
  ) => Promise<boolean>;
  /** Optional delay function — defaults to setTimeout. Inject for testing. */
  delay?: (ms: number) => Promise<void>;
}

// ----------------------------------------------------------------
// Default production deps (wired to real implementations)
// ----------------------------------------------------------------

function buildDefaultDeps(): AgentLoopDeps {
  const db = getSupabaseClient();

  return {
    loadMemoryContext,

    planTask: (goal, memory_context, max_steps = 10) =>
      planTask(goal, memory_context, max_steps),

    executeStep: (session_id, step, onStreamingUrl?, onProgress?) =>
      executeStep(session_id, step, onStreamingUrl, onProgress),

    evaluateStep: async (step, result, remaining_steps, retry_count) => {
      const { evaluateStep: geminiEvaluate } = await import("./gemini");
      return geminiEvaluate(step, result, remaining_steps, retry_count);
    },

    updateTaskStatus: async (task_id, status, extra = {}) => {
      await db
        .from("tasks")
        .update({ status, updated_at: new Date().toISOString(), ...extra })
        .eq("id", task_id);
    },

    logStep: async (task_id, step, status, result?, retry_count = 0) => {
      const row = {
        task_id,
        step_id: step.step_id,
        action_type: step.action_type,
        target: step.target,
        status,
        result: result ?? null,
        retry_count,
        timestamp: new Date().toISOString(),
      };
      const { error } = await db.from("step_logs").upsert(row, {
        onConflict: "task_id,step_id",
      });
      if (error) {
        // Constraint may not exist yet — fall back to insert (ignore duplicate)
        await db.from("step_logs").insert(row);
      }
    },

    persistExtractedData,

    patchStepResult: async (task_id, step_id, result) => {
      // Retry — streaming_url can arrive before the row is written
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error } = await db
          .from("step_logs")
          .update({ result })
          .eq("task_id", task_id)
          .eq("step_id", step_id)
          .select("id");
        if (error) {
          console.error("[agent-loop] patchStepResult error:", error.message);
        } else if (data && data.length > 0) {
          console.log(`[agent-loop] patchStepResult ok for ${step_id}`);
          return;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      console.warn(`[agent-loop] patchStepResult: no row found for ${step_id} after retries`);
    },

    // In production these are async — the API layer writes pending_input and
    // the loop is re-invoked by the API after the user responds. For the
    // synchronous loop we pause by returning early; these stubs are only
    // called in the paused-return path and should never resolve in production.
    awaitUserInput: async (_task_id, _request) => {
      throw new Error(
        "awaitUserInput must be injected — production loop returns paused"
      );
    },

    awaitConfirmation: async (_task_id, _request) => {
      throw new Error(
        "awaitConfirmation must be injected — production loop returns paused"
      );
    },
  };
}

// ----------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------

function buildSafetyRequest(task_id: string, step: AgentStep): UserInputRequest {
  return {
    task_id,
    type: "safety_confirmation",
    message: `Confirm action: ${step.action_type} on "${step.target}"`,
    action_summary: `${step.action_type} on "${step.target}"`,
  };
}

function buildUserInputRequest(
  task_id: string,
  request?: UserInputRequest
): UserInputRequest {
  return (
    request ?? {
      task_id,
      type: "missing_fields",
      message: "Additional information is required to continue.",
    }
  );
}

async function writePendingInput(
  deps: AgentLoopDeps,
  task_id: string,
  request: UserInputRequest
): Promise<void> {
  await deps.updateTaskStatus(task_id, "paused", {
    pending_input: request,
  });
}

// ----------------------------------------------------------------
// 8.1 runAgentLoop
// ----------------------------------------------------------------

export async function runAgentLoop(
  input: AgentLoopInput,
  deps?: AgentLoopDeps
): Promise<AgentLoopOutput> {
  const { task_id, goal, user_id } = input;
  const d = deps ?? buildDefaultDeps();

  // Accumulate confirmation log across the entire run
  const confirmation_log: ConfirmationEntry[] = [];
  // Accumulate all extracted data across steps
  const all_extracted_data: Record<string, unknown> = {};

  // ── 1. Load memory & plan ──────────────────────────────────────
  const memory = await d.loadMemoryContext(user_id, task_id);

  // Fast path: if the goal matches a known domain, run as a single TinyFish task
  const domainRoute = resolveTask(goal);
  if (domainRoute) {
    await d.updateTaskStatus(task_id, "running");
    const fakeStep: AgentStep = {
      step_id: "step_1",
      action_type: "open",
      target: domainRoute.url,
      expected_output: domainRoute.tinyfishGoal,
      fallback_strategy: "retry",
    };
    await d.logStep(task_id, fakeStep, "running", undefined, 0);
    console.log(`[agent-loop] domain route → ${domainRoute.url}`);

    let result: StepResult;
    try {
      const onStreamingUrl = async (streaming_url: string) => {
        console.log(`[agent-loop] got streaming_url for step_1, updating DB`);
        await d.patchStepResult(task_id, "step_1", {
          success: true,
          extracted_data: { _streaming_url: streaming_url },
          page_state: { url: "", title: "", forms_detected: [] },
        });
      };
      result = await d.executeStep("", fakeStep, onStreamingUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result = { success: false, error: { type: "element_not_found", message: msg }, page_state: { url: "", title: "", forms_detected: [] } };
    }

    await d.logStep(task_id, fakeStep, result.success ? "success" : "failed", result, 0);

    if (result.success) {
      const taskResult: TaskResult = {
        summary: "Task completed successfully.",
        extracted_data: result.extracted_data ?? {},
        confirmation_log: [],
      };
      await d.updateTaskStatus(task_id, "completed", { result: taskResult });
      return { status: "completed", result: taskResult };
    } else {
      const reason = result.error?.message ?? "Task failed";
      await d.updateTaskStatus(task_id, "failed", { failure_reason: reason });
      return { status: "failed", failure_reason: reason };
    }
  }

  let plan = await d.planTask(goal, memory, 4);

  // ── 2. Mark task as running ────────────────────────────────────
  await d.updateTaskStatus(task_id, "running");
  console.log(`[agent-loop] task ${task_id} running, ${plan.steps.length} steps planned`);

  // ── 3. Execution loop ─────────────────────────────────────────
  let step_index = 0;
  // 8.4 retry_counts: Record<string, number>
  let retry_counts: Record<string, number> = {};
  let replan_count = 0;
  const MAX_REPLANS = 3;

  // Prefix step IDs with attempt number so replans create new rows
  function prefixedStep(step: AgentStep): AgentStep {
    return replan_count === 0
      ? step
      : { ...step, step_id: `r${replan_count}_${step.step_id}` };
  }

  while (step_index < plan.steps.length) {
    const step = prefixedStep(plan.steps[step_index]);
    const retry_count = retry_counts[step.step_id] ?? 0;

    // Log step as "running"
    await d.logStep(task_id, step, "running", undefined, retry_count);
    console.log(`[agent-loop] executing step ${step.step_id}: ${step.action_type} → "${step.target}"`);

    // ── 8.2 Safety confirmation gate ──────────────────────────────
    if (requiresSafetyConfirmation(step)) {
      const safetyRequest = buildSafetyRequest(task_id, step);

      // Write pending_input and pause
      await writePendingInput(d, task_id, safetyRequest);

      let confirmed: boolean;
      try {
        confirmed = await d.awaitConfirmation(task_id, safetyRequest);
      } catch {
        // awaitConfirmation threw (e.g. production stub) — return paused
        return { status: "paused" };
      }

      // 8.8 Record ConfirmationEntry regardless of outcome
      confirmation_log.push({
        action: `${step.action_type} on "${step.target}"`,
        confirmed_by_user: confirmed,
        timestamp: new Date().toISOString(),
      });

      if (!confirmed) {
        // User cancelled — fail the task
        const reason = "user_cancelled";
        await d.updateTaskStatus(task_id, "failed", { failure_reason: reason });
        return { status: "failed", failure_reason: reason };
      }

      // Restore running status after confirmation
      await d.updateTaskStatus(task_id, "running");
    }

    // ── Execute step ──────────────────────────────────────────────
    const session_id = memory.session_state.browser_session_id ?? task_id;
    let result: StepResult;
    try {
      // Callback fires as soon as TinyFish returns the streaming URL (~2s in)
      // We update the step log immediately so the UI can show the live iframe
      const onStreamingUrl = async (streaming_url: string) => {
        console.log(`[agent-loop] got streaming_url for ${step.step_id}, updating DB`);
        await d.patchStepResult(task_id, step.step_id, {
          success: true,
          extracted_data: { _streaming_url: streaming_url },
          page_state: { url: "", title: "", forms_detected: [] },
        });
      };
      result = await d.executeStep(session_id, step, onStreamingUrl);
    } catch (execErr) {
      const msg = execErr instanceof Error ? execErr.message : String(execErr);
      console.error(`[agent-loop] executeStep threw for ${step.step_id}:`, msg);
      result = {
        success: false,
        error: { type: "element_not_found", message: msg },
        page_state: { url: "", title: "", forms_detected: [] },
      };
    }
    // Log step result
    const stepStatus = result.success ? "success" : "failed";
    await d.logStep(task_id, step, stepStatus, result, retry_count);

    // Persist extracted_data if present
    if (result.extracted_data && Object.keys(result.extracted_data).length > 0) {
      Object.assign(all_extracted_data, result.extracted_data);
      await d.persistExtractedData(task_id, user_id, all_extracted_data);
    }

    // ── Evaluate step ─────────────────────────────────────────────
    const remaining = plan.steps.slice(step_index + 1);
    let evaluation: EvaluateResponse;
    try {
      evaluation = await d.evaluateStep(step, result, remaining, retry_count);
    } catch (evalErr) {
      const msg = evalErr instanceof Error ? evalErr.message : String(evalErr);
      console.error(`[agent-loop] evaluateStep threw for ${step.step_id}:`, msg);
      // Treat as a retry to avoid crashing the loop on a transient LLM error
      evaluation = { decision: "retry", reasoning: `evaluateStep error: ${msg}` };
    }

    // ── Handle decision ───────────────────────────────────────────
    switch (evaluation.decision) {
      case "continue": {
        step_index += 1;
        break;
      }

      case "retry": {
        // 8.4 Increment retry count
        const newCount = (retry_counts[step.step_id] ?? 0) + 1;
        retry_counts[step.step_id] = newCount;

        // If retry_count >= 2, force replan instead
        if (newCount >= 2) {
          // Fall through to replan
          replan_count += 1;
          if (replan_count > MAX_REPLANS) {
            const reason = `Exceeded maximum replans (${MAX_REPLANS}) after repeated failures.`;
            await d.updateTaskStatus(task_id, "failed", { failure_reason: reason });
            return { status: "failed", failure_reason: reason };
          }
          const freshMemory = await d.loadMemoryContext(user_id, task_id);
          plan = await d.planTask(goal, freshMemory, 4);
          step_index = 0;
          retry_counts = {};
        } else {
          // Wait then retry same step (step_index unchanged)
          // Use a fixed 1000ms delay for retry (TinyFish adapter handles error-specific delays)
          await (d.delay ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(1000);
          // step_index stays the same — loop will re-execute this step
        }
        break;
      }

      case "replan": {
        // 8.5 Replan with fresh memory
        replan_count += 1;
        if (replan_count > MAX_REPLANS) {
          const reason = `Exceeded maximum replans (${MAX_REPLANS}) after repeated failures.`;
          await d.updateTaskStatus(task_id, "failed", { failure_reason: reason });
          return { status: "failed", failure_reason: reason };
        }
        const freshMemory = await d.loadMemoryContext(user_id, task_id);
        plan = await d.planTask(goal, freshMemory, 4);
        step_index = 0;
        retry_counts = {};
        break;
      }

      case "need_user_input": {
        // 8.3 Pause for user input
        const inputRequest = buildUserInputRequest(
          task_id,
          evaluation.user_input_request
        );
        await writePendingInput(d, task_id, inputRequest);

        let userData: Record<string, string>;
        try {
          userData = await d.awaitUserInput(task_id, inputRequest);
        } catch (err) {
          if (err instanceof UserCancelledError) {
            const reason = "user_cancelled";
            await d.updateTaskStatus(task_id, "failed", { failure_reason: reason });
            return { status: "failed", failure_reason: reason };
          }
          // Production stub threw — return paused
          return { status: "paused" };
        }

        // Store user data and resume (do NOT advance step_index)
        await storeUserData(user_id, task_id, userData);
        await d.updateTaskStatus(task_id, "running");
        break;
      }

      case "complete": {
        // 8.6 Build TaskResult and complete
        const taskResult: TaskResult = {
          summary: evaluation.reasoning || "Task completed successfully.",
          extracted_data: all_extracted_data,
          confirmation_log,
        };
        await d.updateTaskStatus(task_id, "completed", { result: taskResult });
        return { status: "completed", result: taskResult };
      }

      case "fail": {
        // 8.7 Fail with non-empty reason
        const reason =
          evaluation.reasoning?.trim() ||
          `Step ${step.step_id} failed: ${result.error?.message ?? "unknown error"}`;
        await d.updateTaskStatus(task_id, "failed", { failure_reason: reason });
        return { status: "failed", failure_reason: reason };
      }
    }
  }

  // All steps exhausted — treat as complete
  const taskResult: TaskResult = {
    summary: "All steps completed successfully.",
    extracted_data: all_extracted_data,
    confirmation_log,
  };
  await d.updateTaskStatus(task_id, "completed", { result: taskResult });
  return { status: "completed", result: taskResult };
}
