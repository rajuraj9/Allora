// ============================================================
// lib/__tests__/api.test.ts
// Tests for Task API routes
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// ----------------------------------------------------------------
// Mock Supabase client
// ----------------------------------------------------------------

const mockSingle = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();

// Build a chainable mock that supports .from().select/insert/update.eq().single()
function buildChain(terminal: () => unknown) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.single = vi.fn(terminal);
  // Allow awaiting the chain directly (for non-.single() calls)
  chain.then = undefined; // not a thenable by default
  return chain;
}

// We'll configure per-test via mockSupabaseFrom
let supabaseFromImpl: (table: string) => unknown = () => buildChain(() => ({ data: null, error: null }));

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({
    from: (table: string) => supabaseFromImpl(table),
  }),
}));

// ----------------------------------------------------------------
// Mock auth
// ----------------------------------------------------------------

let authResult: { user_id: string } | null = null;

vi.mock("@/lib/auth", () => ({
  validateJWT: vi.fn(async () => authResult),
}));

// ----------------------------------------------------------------
// Mock agent loop (fire-and-forget — don't actually run)
// ----------------------------------------------------------------

vi.mock("@/lib/agent-loop", () => ({
  runAgentLoop: vi.fn(async () => ({ status: "completed" })),
}));

// ----------------------------------------------------------------
// Import routes AFTER mocks are set up
// ----------------------------------------------------------------

import { POST as postTask } from "../../app/api/task/route";
import { GET as getStatus } from "../../app/api/task/[id]/status/route";

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function makeRequest(body?: unknown, headers?: Record<string, string>): Request {
  return new Request("http://localhost/api/task", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function makeGetRequest(headers?: Record<string, string>): Request {
  return new Request("http://localhost/api/task/test-id/status", {
    method: "GET",
    headers: { ...headers },
  });
}

// ----------------------------------------------------------------
// Tests: POST /api/task
// ----------------------------------------------------------------

describe("POST /api/task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authResult = null;
  });

  it("returns 401 when no JWT is provided", async () => {
    authResult = null;

    const req = makeRequest({ goal: "Book a movie ticket" });
    const res = await postTask(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("returns 401 when JWT is invalid", async () => {
    authResult = null; // validateJWT returns null for invalid token

    const req = makeRequest(
      { goal: "Book a movie ticket" },
      { Authorization: "Bearer invalid-token" }
    );
    const res = await postTask(req);

    expect(res.status).toBe(401);
  });

  it("returns 400 when goal is empty string", async () => {
    authResult = { user_id: "user-123" };

    // Configure supabase mock (shouldn't be called for 400)
    supabaseFromImpl = () => buildChain(() => ({ data: null, error: null }));

    const req = makeRequest(
      { goal: "" },
      { Authorization: "Bearer valid-token" }
    );
    const res = await postTask(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("returns 400 when goal is whitespace only", async () => {
    authResult = { user_id: "user-123" };

    const req = makeRequest(
      { goal: "   " },
      { Authorization: "Bearer valid-token" }
    );
    const res = await postTask(req);

    expect(res.status).toBe(400);
  });

  it("returns 400 when goal is missing from body", async () => {
    authResult = { user_id: "user-123" };

    const req = makeRequest({}, { Authorization: "Bearer valid-token" });
    const res = await postTask(req);

    expect(res.status).toBe(400);
  });

  it("returns 201 with task_id and status pending on success", async () => {
    authResult = { user_id: "user-123" };

    // Configure supabase to return a task id
    supabaseFromImpl = () => {
      const chain: Record<string, unknown> = {};
      chain.insert = vi.fn(() => chain);
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.single = vi.fn(async () => ({
        data: { id: "task-abc-123" },
        error: null,
      }));
      return chain;
    };

    const req = makeRequest(
      { goal: "Book a movie ticket" },
      { Authorization: "Bearer valid-token" }
    );
    const res = await postTask(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.task_id).toBe("task-abc-123");
    expect(body.status).toBe("pending");
  });

  it("returns 429 when rate limit is exceeded", async () => {
    authResult = { user_id: "rate-limited-user" };

    // Configure supabase to always succeed
    supabaseFromImpl = () => {
      const chain: Record<string, unknown> = {};
      chain.insert = vi.fn(() => chain);
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.single = vi.fn(async () => ({
        data: { id: "task-xyz" },
        error: null,
      }));
      return chain;
    };

    // Make 11 requests — the 11th should be rate limited
    let lastResponse: Response | null = null;
    for (let i = 0; i < 11; i++) {
      const req = makeRequest(
        { goal: "Test task" },
        { Authorization: "Bearer valid-token" }
      );
      lastResponse = await postTask(req);
    }

    expect(lastResponse!.status).toBe(429);
  });
});

// ----------------------------------------------------------------
// Tests: GET /api/task/:id/status
// ----------------------------------------------------------------

describe("GET /api/task/:id/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authResult = null;
  });

  it("returns 401 when no JWT is provided", async () => {
    authResult = null;

    const req = makeGetRequest();
    const res = await getStatus(req, { params: Promise.resolve({ id: "task-123" }) });

    expect(res.status).toBe(401);
  });

  it("returns 404 when task not found or doesn't belong to user", async () => {
    authResult = { user_id: "user-123" };

    supabaseFromImpl = (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.order = vi.fn(() => chain);
      chain.single = vi.fn(async () => ({
        data: null,
        error: { message: "not found" },
      }));
      // For non-single queries (step_logs), return empty array
      chain.then = undefined;
      // Make it awaitable for step_logs query
      Object.defineProperty(chain, Symbol.toStringTag, { value: "Promise" });
      return chain;
    };

    const req = makeGetRequest({ Authorization: "Bearer valid-token" });
    const res = await getStatus(req, {
      params: Promise.resolve({ id: "nonexistent-task" }),
    });

    expect(res.status).toBe(404);
  });

  it("returns all required fields in status response", async () => {
    authResult = { user_id: "user-123" };

    const mockTask = {
      id: "task-123",
      status: "completed",
      result: {
        summary: "Task completed",
        extracted_data: { price: "29.99" },
        confirmation_log: [],
      },
      failure_reason: null,
      pending_input: null,
    };

    const mockStepLogs = [
      {
        id: "log-1",
        task_id: "task-123",
        step_id: "step_1",
        action_type: "open",
        target: "https://example.com",
        status: "success",
        result: null,
        retry_count: 0,
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];

    let callCount = 0;
    supabaseFromImpl = (table: string) => {
      if (table === "tasks") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.single = vi.fn(async () => ({ data: mockTask, error: null }));
        return chain;
      }
      // step_logs table
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.order = vi.fn(async () => ({ data: mockStepLogs, error: null }));
      return chain;
    };

    const req = makeGetRequest({ Authorization: "Bearer valid-token" });
    const res = await getStatus(req, {
      params: Promise.resolve({ id: "task-123" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Verify all required fields are present
    expect(body).toHaveProperty("task_id", "task-123");
    expect(body).toHaveProperty("status", "completed");
    expect(body).toHaveProperty("steps");
    expect(Array.isArray(body.steps)).toBe(true);
    expect(body).toHaveProperty("result");
    expect(body.result).toHaveProperty("summary");
    expect(body.result).toHaveProperty("extracted_data");
    expect(body.result).toHaveProperty("confirmation_log");
  });

  it("returns pending_input when task is paused", async () => {
    authResult = { user_id: "user-123" };

    const mockPendingInput = {
      task_id: "task-123",
      type: "missing_fields",
      message: "Please provide your phone number",
      fields: [{ label: "Phone", name: "phone", type: "tel", required: true }],
    };

    const mockTask = {
      id: "task-123",
      status: "paused",
      result: null,
      failure_reason: null,
      pending_input: mockPendingInput,
    };

    supabaseFromImpl = (table: string) => {
      if (table === "tasks") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.single = vi.fn(async () => ({ data: mockTask, error: null }));
        return chain;
      }
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.order = vi.fn(async () => ({ data: [], error: null }));
      return chain;
    };

    const req = makeGetRequest({ Authorization: "Bearer valid-token" });
    const res = await getStatus(req, {
      params: Promise.resolve({ id: "task-123" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("paused");
    expect(body.pending_input).toBeDefined();
    expect(body.pending_input.type).toBe("missing_fields");
    expect(body.pending_input.message).toBeTruthy();
  });

  it("does not include result field when task is pending", async () => {
    authResult = { user_id: "user-123" };

    const mockTask = {
      id: "task-123",
      status: "pending",
      result: null,
      failure_reason: null,
      pending_input: null,
    };

    supabaseFromImpl = (table: string) => {
      if (table === "tasks") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.single = vi.fn(async () => ({ data: mockTask, error: null }));
        return chain;
      }
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.order = vi.fn(async () => ({ data: [], error: null }));
      return chain;
    };

    const req = makeGetRequest({ Authorization: "Bearer valid-token" });
    const res = await getStatus(req, {
      params: Promise.resolve({ id: "task-123" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("pending");
    expect(body.result).toBeUndefined();
    expect(body.pending_input).toBeUndefined();
  });
});
