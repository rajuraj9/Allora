// ============================================================
// lib/__tests__/error-handler.test.ts
// Property-based tests for the Error Handler
// ============================================================

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { handleStepError } from "../error-handler";
import type { AgentStep, BrowserError } from "../types";

// ----------------------------------------------------------------
// Arbitraries
// ----------------------------------------------------------------

const browserErrorTypeArb = fc.constantFrom(
  "element_not_found",
  "timeout",
  "login_required",
  "captcha",
  "navigation_failed"
) as fc.Arbitrary<BrowserError["type"]>;

const browserErrorArb: fc.Arbitrary<BrowserError> = fc.record({
  type: browserErrorTypeArb,
  message: fc.string({ minLength: 1, maxLength: 100 }),
});

const agentStepArb: fc.Arbitrary<AgentStep> = fc.record({
  step_id: fc.string({ minLength: 1, maxLength: 20 }),
  action_type: fc.constantFrom(
    "search", "open", "click", "input", "extract",
    "select", "submit", "scroll", "upload", "wait"
  ) as fc.Arbitrary<AgentStep["action_type"]>,
  target: fc.string({ minLength: 1, maxLength: 100 }),
  expected_output: fc.string({ minLength: 1, maxLength: 100 }),
  fallback_strategy: fc.string({ minLength: 1, maxLength: 100 }),
});

const retryCountArb = fc.nat(10);
const taskIdArb = fc.string({ minLength: 1, maxLength: 36 });

const VALID_ACTIONS = ["retry", "replan", "need_user_input", "fail"] as const;

// ----------------------------------------------------------------
// Property 9: handleStepError always returns a valid ErrorHandlingDecision
// Validates: Requirements 5.1, 5.2, 12.1, 12.3
// ----------------------------------------------------------------

describe("Property 9: handleStepError always returns a valid ErrorHandlingDecision", () => {
  it("always returns a decision with a valid action for any BrowserError and retry_count", () => {
    fc.assert(
      fc.property(
        agentStepArb,
        browserErrorArb,
        retryCountArb,
        taskIdArb,
        (step, error, retry_count, task_id) => {
          const decision = handleStepError(step, error, retry_count, task_id);

          expect(VALID_ACTIONS).toContain(decision.action);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("retry decisions always have delay_ms", () => {
    fc.assert(
      fc.property(
        agentStepArb,
        browserErrorArb,
        retryCountArb,
        taskIdArb,
        (step, error, retry_count, task_id) => {
          const decision = handleStepError(step, error, retry_count, task_id);

          if (decision.action === "retry") {
            expect(typeof decision.delay_ms).toBe("number");
            expect(decision.delay_ms).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("fail decisions always have a non-empty reason string", () => {
    fc.assert(
      fc.property(
        agentStepArb,
        browserErrorArb,
        retryCountArb,
        taskIdArb,
        (step, error, retry_count, task_id) => {
          const decision = handleStepError(step, error, retry_count, task_id);

          if (decision.action === "fail") {
            expect(typeof decision.reason).toBe("string");
            expect(decision.reason!.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("retry_count >= 2 triggers replan (not retry) for element_not_found and navigation_failed", () => {
    fc.assert(
      fc.property(
        agentStepArb,
        fc.constantFrom("element_not_found", "navigation_failed") as fc.Arbitrary<BrowserError["type"]>,
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.integer({ min: 2, max: 20 }),
        taskIdArb,
        (step, errorType, message, retry_count, task_id) => {
          const error: BrowserError = { type: errorType, message };
          const decision = handleStepError(step, error, retry_count, task_id);

          expect(decision.action).toBe("replan");
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ----------------------------------------------------------------
// Exhaustive unit tests for all error types and retry boundaries
// ----------------------------------------------------------------

describe("handleStepError exhaustive cases", () => {
  const step: AgentStep = {
    step_id: "step_1",
    action_type: "click",
    target: "#btn",
    expected_output: "clicked",
    fallback_strategy: "retry",
  };
  const task_id = "task-abc";

  it("element_not_found + retry_count=0 → retry with 1000ms", () => {
    const d = handleStepError(step, { type: "element_not_found", message: "not found" }, 0, task_id);
    expect(d.action).toBe("retry");
    expect(d.delay_ms).toBe(1000);
  });

  it("element_not_found + retry_count=1 → retry with 1000ms", () => {
    const d = handleStepError(step, { type: "element_not_found", message: "not found" }, 1, task_id);
    expect(d.action).toBe("retry");
    expect(d.delay_ms).toBe(1000);
  });

  it("element_not_found + retry_count=2 → replan", () => {
    const d = handleStepError(step, { type: "element_not_found", message: "not found" }, 2, task_id);
    expect(d.action).toBe("replan");
  });

  it("navigation_failed + retry_count=0 → retry with 1000ms", () => {
    const d = handleStepError(step, { type: "navigation_failed", message: "nav failed" }, 0, task_id);
    expect(d.action).toBe("retry");
    expect(d.delay_ms).toBe(1000);
  });

  it("navigation_failed + retry_count=2 → replan", () => {
    const d = handleStepError(step, { type: "navigation_failed", message: "nav failed" }, 2, task_id);
    expect(d.action).toBe("replan");
  });

  it("login_required → need_user_input with credentials type", () => {
    const d = handleStepError(step, { type: "login_required", message: "login wall" }, 0, task_id);
    expect(d.action).toBe("need_user_input");
    expect(d.request?.type).toBe("credentials");
    expect(d.request?.message).toBeTruthy();
  });

  it("captcha → need_user_input with captcha type", () => {
    const d = handleStepError(step, { type: "captcha", message: "captcha detected" }, 0, task_id);
    expect(d.action).toBe("need_user_input");
    expect(d.request?.type).toBe("captcha");
    expect(d.request?.message).toBeTruthy();
  });

  it("timeout + retry_count=0 → retry with 3000ms", () => {
    const d = handleStepError(step, { type: "timeout", message: "timed out" }, 0, task_id);
    expect(d.action).toBe("retry");
    expect(d.delay_ms).toBe(3000);
  });

  it("timeout + retry_count=1 → retry with 3000ms", () => {
    const d = handleStepError(step, { type: "timeout", message: "timed out" }, 1, task_id);
    expect(d.action).toBe("retry");
    expect(d.delay_ms).toBe(3000);
  });

  it("timeout + retry_count=2 → fail with step_id in reason", () => {
    const d = handleStepError(step, { type: "timeout", message: "timed out" }, 2, task_id);
    expect(d.action).toBe("fail");
    expect(d.reason).toContain(step.step_id);
  });
});
