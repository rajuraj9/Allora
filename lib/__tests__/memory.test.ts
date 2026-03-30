// ============================================================
// lib/__tests__/memory.test.ts
// Property-based and unit tests for the Memory Service
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import { loadMemoryContext, storeUserData, persistExtractedData, isSensitiveKey } from "../memory";
import type { SupabaseClient } from "@supabase/supabase-js";

// ----------------------------------------------------------------
// Sensitive field patterns (mirrors memory.ts)
// ----------------------------------------------------------------
const SENSITIVE_PATTERNS = [
  "payment",
  "card",
  "cvv",
  "ssn",
  "passport",
  "identity",
  "password",
];

// ----------------------------------------------------------------
// Mock Supabase client factory
// ----------------------------------------------------------------

function makeMockClient(overrides: {
  profileRow?: Record<string, unknown> | null;
  sessionRow?: Record<string, unknown> | null;
  stepRows?: Record<string, unknown>[] | null;
} = {}): SupabaseClient {
  const { profileRow = null, sessionRow = null, stepRows = [] } = overrides;

  const maybeSingle = (data: unknown) => ({
    data,
    error: null,
  });

  const selectChain = (data: unknown) => ({
    eq: (_col: string, _val: unknown) => ({
      maybeSingle: () => Promise.resolve(maybeSingle(data)),
      eq: (_col2: string, _val2: unknown) => ({
        maybeSingle: () => Promise.resolve(maybeSingle(data)),
        order: () => Promise.resolve({ data: stepRows, error: null }),
      }),
      order: (_col2: string, _opts: unknown) =>
        Promise.resolve({ data: stepRows, error: null }),
    }),
  });

  const upsertChain = () => Promise.resolve({ data: null, error: null });

  const from = vi.fn((table: string) => {
    if (table === "users_profile") {
      return { select: () => selectChain(profileRow), upsert: upsertChain };
    }
    if (table === "session_state") {
      return { select: () => selectChain(sessionRow), upsert: upsertChain };
    }
    if (table === "step_logs") {
      return {
        select: () => ({
          eq: (_col: string, _val: unknown) => ({
            order: (_col2: string, _opts: unknown) =>
              Promise.resolve({ data: stepRows, error: null }),
          }),
        }),
      };
    }
    return { select: () => selectChain(null), upsert: upsertChain };
  });

  return { from } as unknown as SupabaseClient;
}

// ----------------------------------------------------------------
// Arbitraries
// ----------------------------------------------------------------

/** Generates a field key that contains a sensitive pattern */
const sensitivKeyArb = fc.constantFrom(...SENSITIVE_PATTERNS).chain((pattern) =>
  fc.tuple(
    fc.string({ minLength: 0, maxLength: 5 }),
    fc.string({ minLength: 0, maxLength: 5 })
  ).map(([prefix, suffix]) => `${prefix}${pattern}${suffix}`)
);

/** Generates a safe (non-sensitive) field key */
const safeKeyArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((k) => !SENSITIVE_PATTERNS.some((p) => k.toLowerCase().includes(p)));

/** Generates a profile row that may contain sensitive fields */
const profileWithSensitiveArb = fc
  .record({
    user_id: fc.uuid(),
    name: fc.string(),
    email: fc.emailAddress(),
  })
  .chain((base) =>
    fc
      .array(
        fc.tuple(sensitivKeyArb, fc.string({ minLength: 1, maxLength: 20 })),
        { minLength: 1, maxLength: 5 }
      )
      .map((sensitiveEntries) => {
        const extra: Record<string, string> = {};
        for (const [k, v] of sensitiveEntries) extra[k] = v;
        return { ...base, ...extra };
      })
  );

// ----------------------------------------------------------------
// Property 1: Sensitive fields never appear in returned UserProfile
// Validates: Requirements 9.3, 11.2
// ----------------------------------------------------------------

describe("Property 1: sensitive fields never present in returned UserProfile", () => {
  it("strips all sensitive keys from profile row regardless of casing or affixes", async () => {
    await fc.assert(
      fc.asyncProperty(profileWithSensitiveArb, fc.uuid(), async (profileRow, task_id) => {
        const client = makeMockClient({ profileRow });
        const ctx = await loadMemoryContext(profileRow.user_id, task_id, client);

        const profileKeys = Object.keys(ctx.user_profile);
        for (const key of profileKeys) {
          expect(isSensitiveKey(key)).toBe(false);
        }
      }),
      { numRuns: 200 }
    );
  });

  it("never includes any of the exact sensitive pattern keys", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.uuid(), async (user_id, task_id) => {
        const profileRow: Record<string, unknown> = { user_id };
        for (const pattern of SENSITIVE_PATTERNS) {
          profileRow[pattern] = "secret_value";
          profileRow[`user_${pattern}_data`] = "secret_value";
        }

        const client = makeMockClient({ profileRow });
        const ctx = await loadMemoryContext(user_id, task_id, client);

        for (const pattern of SENSITIVE_PATTERNS) {
          expect(ctx.user_profile).not.toHaveProperty(pattern);
          expect(ctx.user_profile).not.toHaveProperty(`user_${pattern}_data`);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ----------------------------------------------------------------
// Property 2: Data returned is always scoped to the provided user_id
// Validates: Requirements 9.5
// ----------------------------------------------------------------

describe("Property 2: returned context is scoped to the provided user_id", () => {
  it("user_profile.user_id always equals the requested user_id", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.uuid(), async (user_id, task_id) => {
        const profileRow = { user_id, name: "Alice", email: "alice@example.com" };
        const client = makeMockClient({ profileRow });
        const ctx = await loadMemoryContext(user_id, task_id, client);

        expect(ctx.user_profile.user_id).toBe(user_id);
      }),
      { numRuns: 100 }
    );
  });

  it("session_state.task_id always equals the requested task_id", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.uuid(), async (user_id, task_id) => {
        const sessionRow = {
          task_id,
          user_id,
          current_step_index: 0,
          retry_counts: {},
        };
        const client = makeMockClient({ sessionRow });
        const ctx = await loadMemoryContext(user_id, task_id, client);

        expect(ctx.session_state.task_id).toBe(task_id);
      }),
      { numRuns: 100 }
    );
  });
});

// ----------------------------------------------------------------
// Property 3: loadMemoryContext never throws even when no session exists
// Validates: Requirements 9.4
// ----------------------------------------------------------------

describe("Property 3: loadMemoryContext never throws and returns defaults when no session exists", () => {
  it("returns a valid MemoryContext with defaults when all DB rows are null", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.uuid(), async (user_id, task_id) => {
        const client = makeMockClient({
          profileRow: null,
          sessionRow: null,
          stepRows: [],
        });

        let ctx: Awaited<ReturnType<typeof loadMemoryContext>> | undefined;
        let threw = false;
        try {
          ctx = await loadMemoryContext(user_id, task_id, client);
        } catch {
          threw = true;
        }

        expect(threw).toBe(false);
        expect(ctx).toBeDefined();
        expect(ctx!.user_profile.user_id).toBe(user_id);
        expect(ctx!.session_state.task_id).toBe(task_id);
        expect(ctx!.session_state.current_step_index).toBe(0);
        expect(ctx!.extracted_data).toEqual({});
        expect(ctx!.step_history).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });

  it("returns defaults even when the Supabase client throws", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.uuid(), async (user_id, task_id) => {
        const throwingClient = {
          from: () => {
            throw new Error("network error");
          },
        } as unknown as SupabaseClient;

        let ctx: Awaited<ReturnType<typeof loadMemoryContext>> | undefined;
        let threw = false;
        try {
          ctx = await loadMemoryContext(user_id, task_id, throwingClient);
        } catch {
          threw = true;
        }

        expect(threw).toBe(false);
        expect(ctx).toBeDefined();
        expect(ctx!.user_profile.user_id).toBe(user_id);
        expect(ctx!.session_state.task_id).toBe(task_id);
      }),
      { numRuns: 50 }
    );
  });
});

// ----------------------------------------------------------------
// Unit tests for storeUserData and persistExtractedData
// ----------------------------------------------------------------

describe("storeUserData", () => {
  it("calls upsert on users_profile with non-sensitive fields only", async () => {
    const upsertSpy = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const client = {
      from: (table: string) => ({ upsert: upsertSpy }),
    } as unknown as SupabaseClient;

    await storeUserData(
      "user-1",
      "task-1",
      { name: "Alice", password: "secret", email: "a@b.com" },
      client
    );

    // Should have been called twice: once for users_profile, once for session_state
    expect(upsertSpy).toHaveBeenCalledTimes(2);

    // First call (users_profile) must not include password
    const firstCallArg = (upsertSpy.mock.calls as unknown as Record<string, unknown>[][])[0][0];
    expect(firstCallArg).not.toHaveProperty("password");
    expect(firstCallArg).toHaveProperty("name", "Alice");
    expect(firstCallArg).toHaveProperty("email", "a@b.com");
  });
});

describe("persistExtractedData", () => {
  it("upserts extracted_data into session_state", async () => {
    const upsertSpy = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const client = {
      from: (_table: string) => ({ upsert: upsertSpy }),
    } as unknown as SupabaseClient;

    const extracted = { booking_ref: "BK-001", seat: "D4" };
    await persistExtractedData("task-1", "user-1", extracted, client);

    expect(upsertSpy).toHaveBeenCalledOnce();
    const arg = (upsertSpy.mock.calls as unknown as Record<string, unknown>[][])[0][0];
    expect(arg.task_id).toBe("task-1");
    expect(arg.user_id).toBe("user-1");
    expect(arg.extracted_data).toEqual(extracted);
  });
});
