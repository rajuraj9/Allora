// ============================================================
// lib/memory.ts
// Memory Service — load and persist agent memory via Supabase
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryContext, UserProfile, SessionState, StepLog } from "./types";
import { getSupabaseClient } from "./supabase";

// ----------------------------------------------------------------
// Sensitive field patterns — these must never appear in returned profiles
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

/**
 * Returns true if a field key matches any sensitive pattern (case-insensitive).
 */
export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Strips sensitive keys from a plain object, returning a new object.
 */
function stripSensitiveFields<T extends Record<string, unknown>>(obj: T): T {
  const result = {} as T;
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (!isSensitiveKey(key as string)) {
      result[key] = obj[key];
    }
  }
  return result;
}

// ----------------------------------------------------------------
// Default values
// ----------------------------------------------------------------

function defaultSessionState(task_id: string): SessionState {
  return {
    task_id,
    current_step_index: 0,
    retry_counts: {},
    browser_session_id: undefined,
  };
}

function defaultMemoryContext(user_id: string, task_id: string): MemoryContext {
  return {
    user_profile: { user_id },
    session_state: defaultSessionState(task_id),
    extracted_data: {},
    step_history: [],
  };
}

// ----------------------------------------------------------------
// loadMemoryContext
// ----------------------------------------------------------------

/**
 * Loads the full MemoryContext for a given user and task from Supabase.
 * Returns safe defaults if no prior session exists. Never throws.
 *
 * Sensitive fields are stripped from the returned UserProfile.
 */
export async function loadMemoryContext(
  user_id: string,
  task_id: string,
  client?: SupabaseClient
): Promise<MemoryContext> {
  const db = client ?? getSupabaseClient();

  try {
    // Load user profile
    const { data: profileRow } = await db
      .from("users_profile")
      .select("*")
      .eq("user_id", user_id)
      .maybeSingle();

    const rawProfile: Record<string, unknown> = profileRow ?? { user_id };
    const safeProfile = stripSensitiveFields(rawProfile) as UserProfile;
    // Ensure user_id is always present
    safeProfile.user_id = user_id;

    // Load session state
    const { data: sessionRow } = await db
      .from("session_state")
      .select("*")
      .eq("task_id", task_id)
      .maybeSingle();

    let session_state: SessionState;
    let extracted_data: Record<string, unknown> = {};

    if (sessionRow) {
      session_state = {
        task_id: sessionRow.task_id,
        current_step_index: sessionRow.current_step_index ?? 0,
        retry_counts: (sessionRow.retry_counts as Record<string, number>) ?? {},
        browser_session_id: sessionRow.browser_session_id ?? undefined,
      };
      // extracted_data is stored as a separate JSONB column if present,
      // otherwise fall back to an empty object
      extracted_data =
        (sessionRow.extracted_data as Record<string, unknown>) ?? {};
    } else {
      session_state = defaultSessionState(task_id);
    }

    // Load step history
    const { data: stepRows } = await db
      .from("step_logs")
      .select("*")
      .eq("task_id", task_id)
      .order("timestamp", { ascending: true });

    const step_history: StepLog[] = (stepRows ?? []).map((row) => ({
      id: row.id,
      task_id: row.task_id,
      step_id: row.step_id,
      action_type: row.action_type,
      target: row.target,
      status: row.status,
      result: row.result ?? undefined,
      retry_count: row.retry_count,
      timestamp: row.timestamp,
    }));

    return {
      user_profile: safeProfile,
      session_state,
      extracted_data,
      step_history,
    };
  } catch {
    // Never throw — return safe defaults on any error
    return defaultMemoryContext(user_id, task_id);
  }
}

// ----------------------------------------------------------------
// storeUserData
// ----------------------------------------------------------------

/**
 * Persists user-provided field values:
 * - Non-sensitive fields are upserted into users_profile
 * - All fields are stored in session_state for the current task
 */
export async function storeUserData(
  user_id: string,
  task_id: string,
  data: Record<string, string>,
  client?: SupabaseClient
): Promise<void> {
  const db = client ?? getSupabaseClient();

  // Separate sensitive from non-sensitive
  const nonSensitive: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!isSensitiveKey(key)) {
      nonSensitive[key] = value;
    }
  }

  // Upsert non-sensitive fields into users_profile
  if (Object.keys(nonSensitive).length > 0) {
    await db
      .from("users_profile")
      .upsert({ user_id, ...nonSensitive }, { onConflict: "user_id" });
  }

  // Store all provided data into session_state (as extracted_data)
  await db.from("session_state").upsert(
    {
      task_id,
      user_id,
      extracted_data: data,
    },
    { onConflict: "task_id" }
  );
}

// ----------------------------------------------------------------
// persistExtractedData
// ----------------------------------------------------------------

/**
 * Upserts extracted_data into session_state for the given task.
 * Called after each step that produces extracted data.
 */
export async function persistExtractedData(
  task_id: string,
  user_id: string,
  extracted_data: Record<string, unknown>,
  client?: SupabaseClient
): Promise<void> {
  const db = client ?? getSupabaseClient();

  await db.from("session_state").upsert(
    {
      task_id,
      user_id,
      extracted_data,
    },
    { onConflict: "task_id" }
  );
}
