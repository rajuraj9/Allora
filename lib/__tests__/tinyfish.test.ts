// ============================================================
// lib/__tests__/tinyfish.test.ts
// Property-based tests for the TinyFish Adapter
// ============================================================

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { executeStep } from "../tinyfish";
import type { AgentStep } from "../types";

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

const sessionIdArb = fc.string({ minLength: 1, maxLength: 36 });

// ----------------------------------------------------------------
// Mock fetch helpers
// ----------------------------------------------------------------

function makeSuccessFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      extracted_data: { key: "value" },
      page_state: {
        url: "https://example.com",
        title: "Example",
        forms_detected: [],
      },
      ...overrides,
    }),
  });
}

function makeErrorFetch(
  status: number,
  body: Record<string, unknown> = {}
) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({
      error: { code: "element_not_found", message: "Element not found" },
      page_state: {
        url: "https://example.com",
        title: "Example",
        forms_detected: [],
      },
      ...body,
    }),
  });
}

function makeNetworkErrorFetch(message = "Network failure") {
  return vi.fn().mockRejectedValue(new Error(message));
}

// ----------------------------------------------------------------
// Property: executeStep always returns a StepResult with required fields
// Validates: Requirements 5.1, 5.2
// ----------------------------------------------------------------

describe("Property: executeStep always returns a StepResult with all required fields", () => {
  it("success response always has success=true and page_state", async () => {
    await fc.assert(
      fc.asyncProperty(sessionIdArb, agentStepArb, async (session_id, step) => {
        const mockFetch = makeSuccessFetch();
        const result = await executeStep(session_id, step, mockFetch as unknown as typeof fetch);

        expect(typeof result.success).toBe("boolean");
        expect(result.success).toBe(true);
        expect(result.page_state).toBeDefined();
      }),
      { numRuns: 50 }
    );
  });

  it("error response always has success=false, error, and page_state", async () => {
    await fc.assert(
      fc.asyncProperty(sessionIdArb, agentStepArb, async (session_id, step) => {
        const mockFetch = makeErrorFetch(400);
        const result = await executeStep(session_id, step, mockFetch as unknown as typeof fetch);

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.page_state).toBeDefined();
      }),
      { numRuns: 50 }
    );
  });

  it("network error always returns success=false with page_state", async () => {
    await fc.assert(
      fc.asyncProperty(sessionIdArb, agentStepArb, async (session_id, step) => {
        const mockFetch = makeNetworkErrorFetch();
        const result = await executeStep(session_id, step, mockFetch as unknown as typeof fetch);

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.page_state).toBeDefined();
      }),
      { numRuns: 50 }
    );
  });
});

// ----------------------------------------------------------------
// Property: page_state always has url, title, forms_detected
// ----------------------------------------------------------------

describe("Property: page_state always has url, title, forms_detected fields", () => {
  it("success response page_state has all required fields", async () => {
    await fc.assert(
      fc.asyncProperty(sessionIdArb, agentStepArb, async (session_id, step) => {
        const mockFetch = makeSuccessFetch();
        const result = await executeStep(session_id, step, mockFetch as unknown as typeof fetch);

        expect(result.page_state).toHaveProperty("url");
        expect(result.page_state).toHaveProperty("title");
        expect(result.page_state).toHaveProperty("forms_detected");
        expect(Array.isArray(result.page_state.forms_detected)).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  it("network error page_state has all required fields", async () => {
    await fc.assert(
      fc.asyncProperty(sessionIdArb, agentStepArb, async (session_id, step) => {
        const mockFetch = makeNetworkErrorFetch();
        const result = await executeStep(session_id, step, mockFetch as unknown as typeof fetch);

        expect(result.page_state).toHaveProperty("url");
        expect(result.page_state).toHaveProperty("title");
        expect(result.page_state).toHaveProperty("forms_detected");
        expect(Array.isArray(result.page_state.forms_detected)).toBe(true);
      }),
      { numRuns: 50 }
    );
  });
});

// ----------------------------------------------------------------
// BrowserError mapping unit tests
// ----------------------------------------------------------------

describe("BrowserError mapping", () => {
  const cases: Array<{ desc: string; code: string; expectedType: string }> = [
    { desc: "element_not_found code", code: "element_not_found", expectedType: "element_not_found" },
    { desc: "selector error", code: "selector_error", expectedType: "element_not_found" },
    { desc: "timeout", code: "timeout", expectedType: "timeout" },
    { desc: "login required", code: "login_required", expectedType: "login_required" },
    { desc: "auth error", code: "auth_error", expectedType: "login_required" },
    { desc: "401 in message", code: "401", expectedType: "login_required" },
    { desc: "captcha", code: "captcha", expectedType: "captcha" },
    { desc: "navigation error", code: "navigation_failed", expectedType: "navigation_failed" },
    { desc: "net:: error", code: "net::ERR_CONNECTION_REFUSED", expectedType: "navigation_failed" },
    { desc: "ERR_ prefix", code: "ERR_NETWORK", expectedType: "navigation_failed" },
    { desc: "unknown error defaults to element_not_found", code: "some_random_error", expectedType: "element_not_found" },
  ];

  for (const { desc, code, expectedType } of cases) {
    it(`maps "${desc}" to type "${expectedType}"`, async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: { code, message: code },
          page_state: { url: "", title: "", forms_detected: [] },
        }),
      });

      const step: AgentStep = {
        step_id: "step_1",
        action_type: "click",
        target: "#btn",
        expected_output: "clicked",
        fallback_strategy: "retry",
      };

      const result = await executeStep("session-1", step, mockFetch as unknown as typeof fetch);
      expect(result.error?.type).toBe(expectedType);
    });
  }
});
