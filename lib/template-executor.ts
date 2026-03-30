// ============================================================
// lib/template-executor.ts
// Template execution engine — bypasses GPT planner entirely
// ============================================================

import { getTemplateById } from "./templates";
import { executeStep } from "./tinyfish";
import { getSupabaseClient } from "./supabase";
import type { AgentStep, StepResult, TaskResult } from "./types";

const MAX_RETRIES = 2;

export async function runTemplateTask(
  task_id: string,
  user_id: string,
  template_id: string,
  inputs: Record<string, string>,
  onStreamingUrl?: (url: string) => Promise<void>
): Promise<{ status: "completed" | "failed"; result?: TaskResult; failure_reason?: string }> {
  const db = getSupabaseClient();
  const template = getTemplateById(template_id);

  if (!template) {
    return { status: "failed", failure_reason: `Unknown template: ${template_id}` };
  }

  // Build the TinyFish goal directly from template — no LLM needed
  const { url, goal } = template.buildGoal(inputs);

  const step: AgentStep = {
    step_id: "step_1",
    action_type: "open",
    target: url,
    expected_output: goal,
    fallback_strategy: "Retry with stealth browser profile",
  };

  // Mark task running
  await db.from("tasks").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", task_id);

  // Log step as running
  await db.from("step_logs").upsert(
    { task_id, step_id: "step_1", action_type: "open", target: url, status: "running", result: null, retry_count: 0, timestamp: new Date().toISOString() },
    { onConflict: "task_id,step_id" }
  );

  let result: StepResult | null = null;
  let lastError = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const onUrl = async (streaming_url: string) => {
        // Update step log with streaming URL immediately
        await db.from("step_logs")
          .update({ result: { success: true, extracted_data: { _streaming_url: streaming_url }, page_state: { url: "", title: "", forms_detected: [] } } })
          .eq("task_id", task_id).eq("step_id", "step_1");
        await onStreamingUrl?.(streaming_url);
      };

      result = await executeStep("", step, onUrl);

      if (result.success) break;

      lastError = result.error?.message ?? "Unknown error";
      console.warn(`[template-executor] attempt ${attempt + 1} failed: ${lastError}`);

      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[template-executor] attempt ${attempt + 1} threw:`, lastError);
    }
  }

  if (!result?.success) {
    await db.from("step_logs")
      .update({ status: "failed", result: { success: false, error: { message: lastError }, page_state: { url: "", title: "", forms_detected: [] } } })
      .eq("task_id", task_id).eq("step_id", "step_1");

    await db.from("tasks").update({
      status: "failed",
      failure_reason: lastError,
      updated_at: new Date().toISOString(),
    }).eq("id", task_id);

    return { status: "failed", failure_reason: lastError };
  }

  // Strip internal metadata keys before storing
  const { _streaming_url, _progress_log, ...cleanData } = (result.extracted_data ?? {}) as Record<string, unknown>;
  void _streaming_url; void _progress_log;

  await db.from("step_logs")
    .update({ status: "success", result })
    .eq("task_id", task_id).eq("step_id", "step_1");

  const taskResult: TaskResult = {
    summary: `${template.title} completed successfully.`,
    extracted_data: cleanData,
    confirmation_log: [],
  };

  await db.from("tasks").update({
    status: "completed",
    result: taskResult,
    updated_at: new Date().toISOString(),
  }).eq("id", task_id);

  // Cache successful run for analytics
  await db.from("template_runs").insert({
    template_id,
    user_id,
    task_id,
    success: true,
    created_at: new Date().toISOString(),
  }).then(() => {}); // fire and forget, table may not exist yet

  return { status: "completed", result: taskResult };
}
