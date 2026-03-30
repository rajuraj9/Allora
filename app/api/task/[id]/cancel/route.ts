// ============================================================
// app/api/task/[id]/cancel/route.ts
// POST /api/task/:id/cancel — stop a running task
// ============================================================

import { NextResponse } from "next/server";
import { validateJWT } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateJWT(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: task_id } = await params;
  const db = getSupabaseClient();

  // Verify ownership
  const { data: task } = await db
    .from("tasks")
    .select("id, status")
    .eq("id", task_id)
    .eq("user_id", auth.user_id)
    .single();

  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (task.status !== "running" && task.status !== "pending") {
    return NextResponse.json({ error: "Task is not running" }, { status: 400 });
  }

  // Mark task as failed/cancelled
  await db.from("tasks").update({
    status: "failed",
    failure_reason: "Cancelled by user",
    updated_at: new Date().toISOString(),
  }).eq("id", task_id);

  // Mark any running step logs as failed too
  await db.from("step_logs").update({
    status: "failed",
  }).eq("task_id", task_id).eq("status", "running");

  return NextResponse.json({ success: true });
}
