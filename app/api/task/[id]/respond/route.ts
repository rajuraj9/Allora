// ============================================================
// app/api/task/[id]/respond/route.ts
// POST /api/task/:id/respond — provide user field values to a paused task
// ============================================================

import { NextResponse } from "next/server";
import { validateJWT } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Validate JWT
  const auth = await validateJWT(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { user_id } = auth;
  const { id: task_id } = await params;

  const db = getSupabaseClient();

  // Verify task belongs to authenticated user
  const { data: task, error: fetchError } = await db
    .from("tasks")
    .select("id, user_id, session_state")
    .eq("id", task_id)
    .eq("user_id", user_id)
    .single();

  if (fetchError || !task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const fields =
    body && typeof body === "object" && "fields" in body
      ? (body as Record<string, unknown>).fields
      : {};

  // Merge user-provided fields into session_state and clear pending_input
  const existingState =
    task.session_state && typeof task.session_state === "object"
      ? (task.session_state as Record<string, unknown>)
      : {};

  const updatedState = {
    ...existingState,
    user_provided_fields: {
      ...(existingState.user_provided_fields as Record<string, unknown> ?? {}),
      ...(fields as Record<string, unknown>),
    },
  };

  const { error: updateError } = await db
    .from("tasks")
    .update({
      pending_input: null,
      session_state: updatedState,
      updated_at: new Date().toISOString(),
    })
    .eq("id", task_id);

  if (updateError) {
    return NextResponse.json(
      { error: "Failed to update task" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
