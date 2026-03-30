// ============================================================
// app/api/task/[id]/status/route.ts
// GET /api/task/:id/status — return task status, step logs, result, pending_input
// ============================================================

import { NextResponse } from "next/server";
import { validateJWT } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import type { StepLog, TaskResult, UserInputRequest } from "@/lib/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateJWT(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { user_id } = auth;
  const { id: task_id } = await params;

  const db = getSupabaseClient();

  const { data: task, error: taskError } = await db
    .from("tasks")
    .select("id, status, result, failure_reason, pending_input")
    .eq("id", task_id)
    .eq("user_id", user_id)
    .single();

  if (taskError || !task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const { data: stepLogs, error: logsError } = await db
    .from("step_logs")
    .select("*")
    .eq("task_id", task_id)
    .order("timestamp", { ascending: true });

  if (logsError) {
    return NextResponse.json({ error: "Failed to fetch step logs" }, { status: 500 });
  }

  const response: {
    task_id: string;
    status: string;
    steps: StepLog[];
    result?: TaskResult;
    pending_input?: UserInputRequest;
    failure_reason?: string;
  } = {
    task_id,
    status: task.status,
    steps: (stepLogs ?? []) as StepLog[],
  };

  if (task.result) response.result = task.result as TaskResult;
  if (task.pending_input) response.pending_input = task.pending_input as UserInputRequest;
  if (task.failure_reason) response.failure_reason = task.failure_reason as string;

  return NextResponse.json(response);
}
