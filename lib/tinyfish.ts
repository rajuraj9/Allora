// ============================================================
// lib/tinyfish.ts
// TinyFish Adapter — wraps TinyFish browser automation SDK (SSE streaming)
// ============================================================

import { TinyFish, EventType, RunStatus, BrowserProfile } from "@tiny-fish/sdk";
import type { AgentStep, StepResult, BrowserError } from "./types";
import { resolveTask } from "./gemini";

// ----------------------------------------------------------------
// Translate an AgentStep into a natural-language goal + URL
// If the step target is a known domain URL, use the enriched goal from the router.
// ----------------------------------------------------------------

function stepToGoal(step: AgentStep): { url: string; goal: string } {
  const isUrl = /^https?:\/\//i.test(step.target);

  // Check if this is a domain-routed step (target is a direct URL)
  // Use the full expected_output as the goal since the planner puts the task there
  if (isUrl) {
    return { url: step.target, goal: step.expected_output };
  }

  switch (step.action_type) {
    case "search":
      return {
        url: `https://duckduckgo.com/?q=${encodeURIComponent(step.target)}`,
        goal: `Search for "${step.target}" and extract the top results. Expected: ${step.expected_output}`,
      };
    case "extract":
      return {
        url: `https://duckduckgo.com/?q=${encodeURIComponent(step.target)}`,
        goal: `Extract the following data: ${step.expected_output}. Return as JSON.`,
      };
    default:
      return {
        url: `https://duckduckgo.com/?q=${encodeURIComponent(step.target)}`,
        goal: `${step.action_type} "${step.target}". ${step.input_data ? `Input: ${JSON.stringify(step.input_data)}.` : ""} Expected: ${step.expected_output}`,
      };
  }
}

// ----------------------------------------------------------------
// executeTask — single-shot execution for domain-routed goals
// Bypasses the step-by-step planner entirely.
// ----------------------------------------------------------------

export async function executeTask(
  goal: string,
  onStreamingUrl?: (url: string) => Promise<void>,
  onProgress?: (purpose: string) => void,
): Promise<StepResult> {
  const resolved = resolveTask(goal);
  if (!resolved) {
    return {
      success: false,
      error: { type: "element_not_found", message: "No domain route found for this goal" },
      page_state: { url: "", title: "", forms_detected: [] },
    };
  }

  const fakeStep: AgentStep = {
    step_id: "task",
    action_type: "open",
    target: resolved.url,
    expected_output: resolved.tinyfishGoal,
    fallback_strategy: "retry",
  };

  return executeStep("", fakeStep, onStreamingUrl, onProgress);
}

// ----------------------------------------------------------------
// Map TinyFish failure to BrowserError
// ----------------------------------------------------------------

function mapError(message: string): BrowserError {
  const lower = message.toLowerCase();
  if (lower.includes("timeout")) return { type: "timeout", message };
  if (lower.includes("login") || lower.includes("auth") || lower.includes("401"))
    return { type: "login_required", message };
  if (lower.includes("captcha")) return { type: "captcha", message };
  if (lower.includes("navigation") || lower.includes("net::") || lower.includes("err_"))
    return { type: "navigation_failed", message };
  return { type: "element_not_found", message };
}

// ----------------------------------------------------------------
// executeStep — uses SSE streaming to capture streaming_url + progress
// ----------------------------------------------------------------

export async function executeStep(
  _session_id: string,
  step: AgentStep,
  onStreamingUrl?: (url: string) => void,
  onProgress?: (purpose: string) => void,
): Promise<StepResult> {
  const defaultPageState = { url: "", title: "", forms_detected: [] as [] };

  const apiKey = process.env.TINYFISH_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: { type: "element_not_found", message: "TINYFISH_API_KEY is not set" },
      page_state: defaultPageState,
    };
  }

  // 3-minute hard timeout per step
  const timeoutPromise = new Promise<StepResult>((resolve) =>
    setTimeout(
      () => resolve({ success: false, error: { type: "timeout", message: "Step timed out after 3 minutes" }, page_state: defaultPageState }),
      3 * 60 * 1000
    )
  );

  const stepPromise = (async (): Promise<StepResult> => {
  try {
    const client = new TinyFish({ apiKey });
    const { url, goal } = stepToGoal(step);

    console.log(`[tinyfish] streaming step ${step.step_id}: url=${url}`);
    console.log(`[tinyfish] goal: ${goal.slice(0, 120)}`);

    let streaming_url: string | undefined;
    const progress_log: string[] = [];

    const stream = await client.agent.stream(
      { url, goal, browser_profile: BrowserProfile.STEALTH },
      {
        onStreamingUrl: (e) => {
          streaming_url = e.streaming_url;
          console.log(`[tinyfish] streaming_url: ${streaming_url}`);
          onStreamingUrl?.(e.streaming_url);
        },
        onProgress: (e) => {
          progress_log.push(e.purpose);
          console.log(`[tinyfish] progress: ${e.purpose}`);
          onProgress?.(e.purpose);
        },
      }
    );

    // Drain the stream (callbacks fire during iteration)
    let finalStatus: string | undefined;
    let finalResult: unknown;
    let finalError: { message?: string } | undefined;

    for await (const event of stream) {
      if (event.type === EventType.COMPLETE) {
        const e = event as { type: string; status?: string; result?: unknown; error?: { message?: string } };
        finalStatus = e.status;
        finalResult = e.result;
        finalError = e.error;
      }
    }

    if (finalStatus === RunStatus.COMPLETED) {
      let extracted_data: Record<string, unknown> | undefined;
      const raw = finalResult;
      if (raw && typeof raw === "object") {
        extracted_data = raw as Record<string, unknown>;
      } else if (typeof raw === "string") {
        try {
          const parsed = JSON.parse(raw);
          extracted_data = typeof parsed === "object" ? parsed : { raw };
        } catch {
          extracted_data = { raw };
        }
      }

      return {
        success: true,
        extracted_data: {
          ...extracted_data,
          _streaming_url: streaming_url,
          _progress_log: progress_log,
        },
        page_state: defaultPageState,
      };
    }

    const errMsg = finalError?.message ?? `Run ended with status: ${finalStatus ?? "unknown"}`;
    return {
      success: false,
      error: mapError(errMsg),
      page_state: defaultPageState,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[tinyfish] executeStep error for ${step.step_id}:`, message);
    return {
      success: false,
      error: mapError(message),
      page_state: defaultPageState,
    };
  }
  })();

  return Promise.race([stepPromise, timeoutPromise]);
}
