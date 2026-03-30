// ============================================================
// lib/error-handler.ts
// Error Handler — maps BrowserError + retry_count to ErrorHandlingDecision
// ============================================================

import type {
  AgentStep,
  BrowserError,
  ErrorHandlingDecision,
} from "./types";

export function handleStepError(
  step: AgentStep,
  error: BrowserError,
  retry_count: number,
  _task_id: string
): ErrorHandlingDecision {
  switch (error.type) {
    case "element_not_found":
    case "navigation_failed":
      if (retry_count < 2) {
        return { action: "retry", delay_ms: 1000 };
      }
      return { action: "replan" };

    case "login_required":
      return {
        action: "need_user_input",
        request: {
          task_id: _task_id,
          type: "credentials",
          message: "Login required for this site",
        },
      };

    case "captcha":
      return {
        action: "need_user_input",
        request: {
          task_id: _task_id,
          type: "captcha",
          message: "CAPTCHA detected — please solve manually",
        },
      };

    case "timeout":
      if (retry_count < 2) {
        return { action: "retry", delay_ms: 3000 };
      }
      return {
        action: "fail",
        reason: `Step timed out after retries: ${step.step_id}`,
      };

    default:
      return {
        action: "fail",
        reason: `Unrecoverable error: ${error.message}`,
      };
  }
}
