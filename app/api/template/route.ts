// ============================================================
// app/api/template/route.ts
// POST /api/template — run a template task (no LLM planning)
// ============================================================

import { NextResponse } from "next/server";
import { validateJWT } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { getTemplateById } from "@/lib/templates";
import { runTemplateTask } from "@/lib/template-executor";

export async function POST(request: Request) {
  const auth = await validateJWT(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { user_id } = auth;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { template_id, inputs } = body as { template_id?: string; inputs?: Record<string, string> };

  if (!template_id) return NextResponse.json({ error: "template_id required" }, { status: 400 });

  const template = getTemplateById(template_id);
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  // Validate required fields
  const missing = template.fields.filter((f) => f.required && !inputs?.[f.key]);
  if (missing.length > 0) {
    return NextResponse.json({ error: `Missing required fields: ${missing.map((f) => f.label).join(", ")}` }, { status: 400 });
  }

  const db = getSupabaseClient();

  // Create task record
  const { data: task, error } = await db.from("tasks").insert({
    user_id,
    goal: `[Template: ${template.title}] ${Object.values(inputs ?? {}).join(", ")}`,
    status: "pending",
    step_plan: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).select("id").single();

  if (error || !task) {
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }

  const task_id: string = task.id;

  // Fire and forget — no LLM, goes straight to TinyFish
  setImmediate(() => {
    runTemplateTask(task_id, user_id, template_id, inputs ?? {}).catch((err) => {
      console.error("[template-executor] unhandled:", err);
    });
  });

  return NextResponse.json({ task_id, status: "pending", template_id }, { status: 201 });
}
