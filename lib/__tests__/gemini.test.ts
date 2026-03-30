// ============================================================
// lib/__tests__/gemini.test.ts
// Property-based tests for the Gemini Adapter
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import {
  buildPlannerPrompt,
  planTask,
  evaluateStep,
  decideOption,
} from "../gemini";
import type {
  MemoryContext,
  AgentStep,
  StepResult,
  PageState,
  ExtractedOption,
} from "../types";
import type { OpenAI } from "openai";

// ----------------------------------------------------------------
// Sensitive field patterns (mirrors gemini.ts)
// ----------------------------------------------------------------
const SENSITIVE_PATTERNS = [
  "password",
  "payment",
  "card",
  "cvv",
  "ssn",
  "passport",
  "identity",
  "secret",
  "token",
  "credit",
];

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

const agentStepArb: fc.Arbitrary<AgentStep> = fc.record({
  step_id: fc.string({ minLength: 1, maxLength: 20 }),
  action_type: actionTypeArb,
  target: fc.string({ minLength: 1, maxLength: 100 }),
  expected_output: fc.string({ minLength: 1, maxLength: 100 }),
  fallback_strategy: fc.string({ minLength: 1, maxLength: 100 }),
});

const pageStateArb: fc.Arbitrary<PageState> = fc.record({
  url: fc.webUrl(),
  title: fc.string({ minLength: 1, maxLength: 50 }),
  forms_detected: fc.constant([]),
});

const stepResultArb: fc.Arbitrary<StepResult> = fc.record({
  success: fc.boolean(),
  page_state: pageStateArb,
  extracted_data: fc.option(fc.dictionary(fc.string(), fc.string()), {
    nil: undefined,
  }),
});

/** Generates a MemoryContext with sensitive fields in the user_profile */
const memoryContextWithSensitiveArb: fc.Arbitrary<MemoryContext> = fc
  .record({
    user_id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 30 }),
    email: fc.emailAddress(),
  })
  .chain((base) =>
    fc
      .array(
        fc.tuple(
          fc.constantFrom(...SENSITIVE_PATTERNS).chain((pattern) =>
            fc
              .tuple(
                fc.string({ minLength: 0, maxLength: 5 }),
                fc.string({ minLength: 0, maxLength: 5 })
              )
              .map(([pre, suf]) => `${pre}${pattern}${suf}`)
          ),
          // Sensitive values must be non-trivial (length > 2) so the test is meaningful
          fc.string({ minLength: 3, maxLength: 20 })
        ),
        { minLength: 1, maxLength: 5 }
      )
      .map((sensitiveEntries) => {
        const sensitiveFields: Record<string, string> = {};
        for (const [k, v] of sensitiveEntries) sensitiveFields[k] = v;

        return {
          user_profile: { ...base, ...sensitiveFields },
          session_state: {
            task_id: "task-1",
            current_step_index: 0,
            retry_counts: {},
          },
          extracted_data: {},
          step_history: [],
        } satisfies MemoryContext;
      })
  );

/** Generates a minimal valid MemoryContext */
const minimalMemoryContextArb: fc.Arbitrary<MemoryContext> = fc.record({
  user_profile: fc.record({
    user_id: fc.uuid(),
    name: fc.option(fc.string({ minLength: 1, maxLength: 30 }), {
      nil: undefined,
    }),
    email: fc.option(fc.emailAddress(), { nil: undefined }),
  }),
  session_state: fc.record({
    task_id: fc.uuid(),
    current_step_index: fc.nat(9),
    retry_counts: fc.constant({}),
  }),
  extracted_data: fc.constant({}),
  step_history: fc.constant([]),
});

// ----------------------------------------------------------------
// Mock Gemini client factory
// ----------------------------------------------------------------

function makeMockGeminiClient(responseText: string): OpenAI {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content: responseText } }],
  });
  return {
    chat: { completions: { create } },
  } as unknown as OpenAI;
}

function makeStepsJson(count: number): string {
  const steps: AgentStep[] = Array.from({ length: count }, (_, i) => ({
    step_id: `step_${i + 1}`,
    action_type: "open",
    target: `https://example.com/step${i + 1}`,
    expected_output: "Page loaded",
    fallback_strategy: "Retry",
  }));
  return JSON.stringify(steps);
}

// ----------------------------------------------------------------
// Property 8: buildPlannerPrompt never contains sensitive data
// Validates: Requirements 11.3
// ----------------------------------------------------------------

describe("Property 8: buildPlannerPrompt never contains sensitive data", () => {
  it("prompt does not contain sensitive key-value pairs from user_profile", () => {
    fc.assert(
      fc.property(
        memoryContextWithSensitiveArb,
        fc.string({ minLength: 1, maxLength: 200 }),
        (memory_context, goal) => {
          const prompt = buildPlannerPrompt(goal, memory_context);

          // The core security property: sensitive keys must not appear in the
          // profile JSON section of the prompt (i.e., they are excluded from
          // the sanitized profile). We check that the JSON-serialized key is
          // absent from the prompt.
          for (const key of Object.keys(memory_context.user_profile)) {
            const lowerKey = key.toLowerCase();
            const isSensitive = SENSITIVE_PATTERNS.some((p) =>
              lowerKey.includes(p)
            );
            if (isSensitive) {
              // The key should not appear as a JSON property name in the prompt
              expect(prompt).not.toContain(`"${key}"`);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("prompt does not contain any of the sensitive key names", () => {
    fc.assert(
      fc.property(
        memoryContextWithSensitiveArb,
        fc.string({ minLength: 1, maxLength: 200 }),
        (memory_context, goal) => {
          const prompt = buildPlannerPrompt(goal, memory_context);

          for (const [key] of Object.entries(memory_context.user_profile)) {
            const lowerKey = key.toLowerCase();
            const isSensitive = SENSITIVE_PATTERNS.some((p) =>
              lowerKey.includes(p)
            );
            if (isSensitive) {
              // The key itself should not appear in the prompt
              expect(prompt.toLowerCase()).not.toContain(lowerKey);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("prompt always includes the goal", () => {
    fc.assert(
      fc.property(
        minimalMemoryContextArb,
        fc.string({ minLength: 1, maxLength: 200 }),
        (memory_context, goal) => {
          const prompt = buildPlannerPrompt(goal, memory_context);
          expect(prompt).toContain(goal);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ----------------------------------------------------------------
// Property 5: planTask always returns 1–10 steps for any valid goal
// Validates: Requirements 2.1, 3.5
// ----------------------------------------------------------------

describe("Property 5: planTask always returns 1–10 steps for any valid goal", () => {
  it("returns between 1 and 10 steps for any step count in that range", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        minimalMemoryContextArb,
        fc.integer({ min: 1, max: 10 }),
        async (goal, memory_context, stepCount) => {
          const mockClient = makeMockGeminiClient(makeStepsJson(stepCount));
          const response = await planTask(goal, memory_context, 10, mockClient);

          expect(response.steps.length).toBeGreaterThanOrEqual(1);
          expect(response.steps.length).toBeLessThanOrEqual(10);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("each returned step has all required fields", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        minimalMemoryContextArb,
        fc.integer({ min: 1, max: 10 }),
        async (goal, memory_context, stepCount) => {
          const mockClient = makeMockGeminiClient(makeStepsJson(stepCount));
          const response = await planTask(goal, memory_context, 10, mockClient);

          for (const step of response.steps) {
            expect(step.step_id).toBeTruthy();
            expect(step.action_type).toBeTruthy();
            expect(step.target).toBeTruthy();
            expect(step.expected_output).toBeTruthy();
            expect(step.fallback_strategy).toBeTruthy();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("retries once on invalid JSON and throws planner_error if retry also fails", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "not valid json {{" } }],
    });
    const badClient = {
      chat: { completions: { create } },
    } as unknown as OpenAI;

    await expect(
      planTask("some goal", {
        user_profile: { user_id: "u1" },
        session_state: { task_id: "t1", current_step_index: 0, retry_counts: {} },
        extracted_data: {},
        step_history: [],
      }, 10, badClient)
    ).rejects.toThrow("planner_error");

    // Should have been called twice (initial + retry)
    expect(create).toHaveBeenCalledTimes(2);
  });
});

// ----------------------------------------------------------------
// Property: evaluateStep always returns a valid decision enum value
// Validates: Requirements 5.1, 5.2
// ----------------------------------------------------------------

const VALID_DECISIONS = [
  "continue",
  "retry",
  "replan",
  "need_user_input",
  "complete",
  "fail",
] as const;

describe("evaluateStep always returns a valid decision enum value", () => {
  it("returns one of the six valid decisions for any mocked response", async () => {
    await fc.assert(
      fc.asyncProperty(
        agentStepArb,
        stepResultArb,
        fc.array(agentStepArb, { minLength: 0, maxLength: 5 }),
        fc.nat(3),
        fc.constantFrom(...VALID_DECISIONS),
        async (step, result, remaining, retry_count, decision) => {
          const responseObj = {
            decision,
            reasoning: "test reasoning",
          };
          const mockClient = makeMockGeminiClient(JSON.stringify(responseObj));
          const response = await evaluateStep(
            step,
            result,
            remaining,
            retry_count,
            mockClient
          );

          expect(VALID_DECISIONS).toContain(response.decision);
          expect(typeof response.reasoning).toBe("string");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("throws when Gemini returns an invalid decision value", async () => {
    const mockClient = makeMockGeminiClient(
      JSON.stringify({ decision: "invalid_decision", reasoning: "oops" })
    );

    const step: AgentStep = {
      step_id: "step_1",
      action_type: "open",
      target: "https://example.com",
      expected_output: "loaded",
      fallback_strategy: "retry",
    };
    const result: StepResult = {
      success: true,
      page_state: { url: "https://example.com", title: "Test", forms_detected: [] },
    };

    await expect(
      evaluateStep(step, result, [], 0, mockClient)
    ).rejects.toThrow();
  });
});

// ----------------------------------------------------------------
// Unit tests for decideOption
// ----------------------------------------------------------------

describe("decideOption", () => {
  it("returns the selected option and reasoning from Gemini response", async () => {
    const options: ExtractedOption[] = [
      { label: "Option A", value: "a" },
      { label: "Option B", value: "b" },
    ];
    const selected = options[0];
    const mockClient = makeMockGeminiClient(
      JSON.stringify({ selected, reasoning: "Option A is best" })
    );

    const response = await decideOption(options, "cheapest", mockClient);
    expect(response.selected).toEqual(selected);
    expect(response.reasoning).toBe("Option A is best");
  });

  it("throws when response is missing selected field", async () => {
    const mockClient = makeMockGeminiClient(
      JSON.stringify({ reasoning: "no selection" })
    );
    await expect(
      decideOption([{ label: "A", value: "a" }], "criteria", mockClient)
    ).rejects.toThrow();
  });
});
