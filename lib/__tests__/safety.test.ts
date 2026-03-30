// ============================================================
// lib/__tests__/safety.test.ts
// Property-based tests for Safety Confirmation Logic
// ============================================================

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { requiresSafetyConfirmation } from "../safety";
import type { AgentStep, ActionType } from "../types";

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function makeStep(action_type: ActionType): AgentStep {
  return {
    step_id: "step_1",
    action_type,
    target: "#target",
    expected_output: "done",
    fallback_strategy: "retry",
  };
}

// ----------------------------------------------------------------
// Table-driven test covering all 10 ActionType values
// ----------------------------------------------------------------

describe("requiresSafetyConfirmation — all ActionType values", () => {
  const cases: Array<{ action_type: ActionType; expected: boolean }> = [
    { action_type: "search",  expected: false },
    { action_type: "open",    expected: false },
    { action_type: "click",   expected: false },
    { action_type: "input",   expected: false },
    { action_type: "extract", expected: false },
    { action_type: "select",  expected: false },
    { action_type: "submit",  expected: true  },
    { action_type: "scroll",  expected: false },
    { action_type: "upload",  expected: true  },
    { action_type: "wait",    expected: false },
  ];

  for (const { action_type, expected } of cases) {
    it(`"${action_type}" → ${expected}`, () => {
      expect(requiresSafetyConfirmation(makeStep(action_type))).toBe(expected);
    });
  }
});

// ----------------------------------------------------------------
// Property 10: read-only actions never require safety confirmation
// Validates: Requirements 7.6
// ----------------------------------------------------------------

describe("Property 10: read-only actions never require safety confirmation", () => {
  const readOnlyTypes = fc.constantFrom(
    "search", "open", "extract", "scroll", "wait"
  ) as fc.Arbitrary<ActionType>;

  it("returns false for all read-only action types", () => {
    fc.assert(
      fc.property(readOnlyTypes, (action_type) => {
        expect(requiresSafetyConfirmation(makeStep(action_type))).toBe(false);
      }),
      { numRuns: 200 }
    );
  });
});

// ----------------------------------------------------------------
// Property 6: safety-gated actions always require confirmation
// Validates: Requirements 7.1, 7.5
// ----------------------------------------------------------------

describe("Property: submit and upload always require safety confirmation", () => {
  const safetyGatedTypes = fc.constantFrom(
    "submit", "upload"
  ) as fc.Arbitrary<ActionType>;

  it("returns true for submit and upload", () => {
    fc.assert(
      fc.property(safetyGatedTypes, (action_type) => {
        expect(requiresSafetyConfirmation(makeStep(action_type))).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
