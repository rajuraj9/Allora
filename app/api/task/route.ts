// ============================================================
// app/api/task/route.ts
// POST /api/task — create a new task and trigger the agent loop
// ============================================================

import { NextResponse } from "next/server";
import { validateJWT } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { runAgentLoop } from "@/lib/agent-loop";

// ----------------------------------------------------------------
// In-memory rate limiter: max 10 requests per minute per user
// ----------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function checkRateLimit(user_id: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(user_id);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(user_id, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

// ----------------------------------------------------------------
// POST /api/task
// ----------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const auth = await validateJWT(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { user_id } = auth;
    console.log("[POST /api/task] auth ok, user_id:", user_id);

    if (!checkRateLimit(user_id)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait before submitting another task." },
        { status: 429 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const goal =
      body && typeof body === "object" && "goal" in body
        ? (body as Record<string, unknown>).goal
        : undefined;

    if (!goal || typeof goal !== "string" || goal.trim() === "") {
      return NextResponse.json(
        { error: "goal must be a non-empty string" },
        { status: 400 }
      );
    }

    console.log("[POST /api/task] goal:", goal.trim());

    const db = getSupabaseClient();

    const { data: task, error: insertError } = await db
      .from("tasks")
      .insert({
        user_id,
        goal: goal.trim(),
        status: "pending",
        step_plan: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertError || !task) {
      console.error("[POST /api/task] Supabase insert error:", insertError?.message);
      return NextResponse.json(
        { error: "Failed to create task", detail: insertError?.message },
        { status: 500 }
      );
    }

    const task_id: string = task.id;
    console.log("[POST /api/task] task created:", task_id);

    setImmediate(() => {
      runAgentLoop({ task_id, goal: goal.trim(), user_id }).catch(async (err) => {
        console.error("[agent-loop] unhandled error:", err);
        try {
          await db
            .from("tasks")
            .update({
              status: "failed",
              failure_reason: err instanceof Error ? err.message : String(err),
              updated_at: new Date().toISOString(),
            })
            .eq("id", task_id);
        } catch (dbErr) {
          console.error("[agent-loop] failed to update task status after error:", dbErr);
        }
      });
    });

    return NextResponse.json({ task_id, status: "pending" }, { status: 201 });

  } catch (err) {
    console.error("[POST /api/task] unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: String(err) },
      { status: 500 }
    );
  }
}
