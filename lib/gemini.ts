// ============================================================
// lib/gemini.ts
// AI Adapter — Planner + Decision Engine (OpenAI backend)
// Drop-in replacement for the original Gemini adapter.
// All exported types and function signatures are unchanged.
// ============================================================

import OpenAI from "openai";
import type {
  AgentStep,
  ActionType,
  MemoryContext,
  StepResult,
  ExtractedOption,
  UserInputRequest,
} from "./types";

// ----------------------------------------------------------------
// Response interfaces (unchanged)
// ----------------------------------------------------------------

export interface PlanResponse {
  steps: AgentStep[];
  reasoning: string;
}

export interface EvaluateResponse {
  decision: "continue" | "retry" | "replan" | "need_user_input" | "complete" | "fail";
  revised_steps?: AgentStep[];
  user_input_request?: UserInputRequest;
  reasoning: string;
}

export interface DecideResponse {
  selected: ExtractedOption;
  reasoning: string;
}

// ----------------------------------------------------------------
// Constants
// ----------------------------------------------------------------

const MODEL = "gpt-4o-mini";

const VALID_ACTION_TYPES: ActionType[] = [
  "search", "open", "click", "input", "extract",
  "select", "submit", "scroll", "upload", "wait",
];

const VALID_DECISIONS: EvaluateResponse["decision"][] = [
  "continue", "retry", "replan", "need_user_input", "complete", "fail",
];

const SENSITIVE_PATTERNS = [
  "password", "payment", "card", "cvv", "ssn",
  "passport", "identity", "secret", "token", "credit",
];

const AGENT_STEP_SCHEMA = `{
  "step_id": "string (e.g. step_1)",
  "action_type": "one of: search | open | click | input | extract | select | submit | scroll | upload | wait",
  "target": "string (URL, CSS selector, keyword, or element description)",
  "input_data": "optional object with string values",
  "expected_output": "string",
  "fallback_strategy": "string"
}`;

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey });
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_PATTERNS.some((p) => lower.includes(p));
}

function sanitizeProfile(profile: MemoryContext["user_profile"]): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(profile)) {
    if (!isSensitiveKey(key) && value !== undefined && value !== null && typeof value === "string") {
      safe[key] = value;
    }
  }
  return safe;
}

function summariseStepHistory(history: MemoryContext["step_history"]): string {
  const last3 = history.slice(-3);
  if (last3.length === 0) return "No prior steps.";
  return last3
    .map((s) => `[${s.step_id}] ${s.action_type} on "${s.target}" → ${s.status}${
      s.result?.error ? ` (error: ${s.result.error.message})` : ""
    }`)
    .join("\n");
}

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

async function chat(client: OpenAI, systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
  });
  return response.choices[0]?.message?.content ?? "";
}

// ----------------------------------------------------------------
// Domain router — maps goal intent to the best starting URL + enriched goal
// ----------------------------------------------------------------

const DOMAIN_ROUTES: Array<{
  patterns: RegExp[];
  url: string;
  enrichGoal: (goal: string) => string;
}> = [
  {
    patterns: [/movie|film|cinema|showtime|ticket|watch.*movie/i],
    url: "https://in.bookmyshow.com/",
    enrichGoal: (goal) =>
      `On BookMyShow (https://in.bookmyshow.com/), ${goal}. ` +
      `Select the correct city, find the movie, pick a showtime and theater, and extract the available show details. Return results as JSON.`,
  },
  {
    patterns: [/restaurant|dinner|lunch|breakfast|food|eat|dine|table|reservation/i],
    url: "https://www.zomato.com/",
    enrichGoal: (goal) =>
      `On Zomato (https://www.zomato.com/), ${goal}. ` +
      `Set the correct city, search for restaurants, and return a list of top options with name, cuisine, rating, and location as JSON.`,
  },
  {
    patterns: [/hotel|stay|room|accommodation|resort/i],
    url: "https://www.makemytrip.com/hotels/",
    enrichGoal: (goal) =>
      `On MakeMyTrip Hotels (https://www.makemytrip.com/hotels/), ${goal}. ` +
      `Search for available hotels and return top options with name, price, and rating as JSON.`,
  },
  {
    patterns: [/flight|fly|airline|airport/i],
    url: "https://www.makemytrip.com/flights/",
    enrichGoal: (goal) =>
      `On MakeMyTrip Flights (https://www.makemytrip.com/flights/), ${goal}. ` +
      `Search for available flights and return options with airline, time, and price as JSON.`,
  },
  {
    patterns: [/train|railway|irctc/i],
    url: "https://www.irctc.co.in/nget/train-search",
    enrichGoal: (goal) =>
      `On IRCTC (https://www.irctc.co.in/nget/train-search), ${goal}. ` +
      `Search for trains and return available options with train name, departure time, and availability as JSON.`,
  },
  {
    patterns: [/cab|taxi|ride|ola|auto/i],
    url: "https://www.olacabs.com/",
    enrichGoal: (goal) =>
      `On Ola (https://www.olacabs.com/), ${goal}. ` +
      `Find available ride options and return them as JSON.`,
  },
  {
    patterns: [/buy|shop|order|purchase|product|price/i],
    url: "https://www.amazon.in/",
    enrichGoal: (goal) =>
      `On Amazon India (https://www.amazon.in/), ${goal}. ` +
      `Search for the product and return top results with name, price, and rating as JSON.`,
  },
];

export function resolveTask(goal: string): { url: string; tinyfishGoal: string } | null {
  for (const route of DOMAIN_ROUTES) {
    if (route.patterns.some((p) => p.test(goal))) {
      return { url: route.url, tinyfishGoal: route.enrichGoal(goal) };
    }
  }
  return null;
}

// ----------------------------------------------------------------
// buildPlannerPrompt
// ----------------------------------------------------------------

export function buildPlannerPrompt(goal: string, memory_context: MemoryContext, max_steps = 4): string {
  const safeProfile = sanitizeProfile(memory_context.user_profile);
  const profileStr = Object.keys(safeProfile).length > 0
    ? JSON.stringify(safeProfile, null, 2)
    : "(no profile data available)";
  const stepHistorySummary = summariseStepHistory(memory_context.step_history);
  const domain = resolveTask(goal);

  const domainHint = domain
    ? `\n## Direct URL\nStart at: ${domain.url}\nDo NOT use search engines. Go directly to this URL.\n`
    : "";

  return `You are an autonomous web agent planner. Produce a step-by-step plan to accomplish the user's goal.

## Goal
${goal}

## Available User Profile (non-sensitive fields only)
${profileStr}

## Recent Step History (last 3 steps)
${stepHistorySummary}
${domainHint}
## Instructions
- Output ONLY a valid JSON array of AgentStep objects. No markdown, no explanation, no extra text.
- Each step must conform exactly to this schema:
${AGENT_STEP_SCHEMA}
- Produce 1–2 steps maximum. Each step is a full browser session — combine as much as possible into one step.
- For "open" steps, set target to the full URL and put the COMPLETE task description in expected_output.
- Do NOT plan search steps if a direct URL is provided above.

## Output format
Return ONLY a raw JSON array starting with [ and ending with ].`;
}

// ----------------------------------------------------------------
// Validation
// ----------------------------------------------------------------

function validateSteps(steps: unknown[], max_steps: number): AgentStep[] {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > max_steps) {
    throw new Error(`Expected 1–${max_steps} steps, got ${Array.isArray(steps) ? steps.length : "non-array"}`);
  }
  for (const step of steps) {
    if (!step || typeof step !== "object") throw new Error("Step is not an object");
    const s = step as Record<string, unknown>;
    if (!s.step_id || typeof s.step_id !== "string") throw new Error("Missing step_id");
    if (!VALID_ACTION_TYPES.includes(s.action_type as ActionType))
      throw new Error(`Invalid action_type: ${s.action_type}`);
    if (!s.target || typeof s.target !== "string") throw new Error(`Missing target in ${s.step_id}`);
    if (!s.expected_output || typeof s.expected_output !== "string")
      throw new Error(`Missing expected_output in ${s.step_id}`);
    if (!s.fallback_strategy || typeof s.fallback_strategy !== "string")
      throw new Error(`Missing fallback_strategy in ${s.step_id}`);
  }
  return steps as AgentStep[];
}

// ----------------------------------------------------------------
// planTask
// ----------------------------------------------------------------

export async function planTask(
  goal: string,
  memory_context: MemoryContext,
  max_steps = 10,
  _client?: OpenAI
): Promise<PlanResponse> {
  const client = _client ?? getOpenAIClient();
  const userPrompt = buildPlannerPrompt(goal, memory_context, max_steps);
  const systemPrompt = "You are a precise JSON-only web agent planner. Output only valid JSON arrays, no markdown.";

  async function attemptParse(prompt: string): Promise<AgentStep[]> {
    const raw = await chat(client, systemPrompt, prompt);
    console.log("[planner] raw response:", raw.slice(0, 500));
    const cleaned = stripMarkdownFences(raw);
    const parsed = JSON.parse(cleaned);
    return validateSteps(parsed, max_steps);
  }

  try {
    const steps = await attemptParse(userPrompt);
    return { steps, reasoning: "Plan generated successfully." };
  } catch (firstErr) {
    console.error("[planner] first attempt failed:", firstErr);
    const retryPrompt = `${userPrompt}\n\nIMPORTANT: Return ONLY a raw JSON array. Start with [ and end with ]. No markdown, no explanation.`;
    try {
      const steps = await attemptParse(retryPrompt);
      return { steps, reasoning: "Plan generated on retry." };
    } catch (retryErr) {
      console.error("[planner] retry failed:", retryErr);
      throw new Error("planner_error");
    }
  }
}

// ----------------------------------------------------------------
// evaluateStep
// ----------------------------------------------------------------

export async function evaluateStep(
  step: AgentStep,
  result: StepResult,
  remaining_steps: AgentStep[],
  retry_count: number,
  _client?: OpenAI
): Promise<EvaluateResponse> {
  const client = _client ?? getOpenAIClient();

  const userPrompt = `Assess the result of the last executed step and decide what to do next.

## Completed Step
${JSON.stringify(step, null, 2)}

## Step Result
${JSON.stringify(result, null, 2)}

## Remaining Steps (${remaining_steps.length} left)
${JSON.stringify(remaining_steps, null, 2)}

## Retry Count for this step: ${retry_count}

Respond with ONLY a valid JSON object:
{
  "decision": "<one of: continue | retry | replan | need_user_input | complete | fail>",
  "revised_steps": <optional AgentStep array if replan>,
  "user_input_request": <optional UserInputRequest if need_user_input>,
  "reasoning": "<brief explanation>"
}`;

  const raw = await chat(client, "You are a precise JSON-only web agent evaluator.", userPrompt);
  const cleaned = stripMarkdownFences(raw);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch (parseErr) {
    console.error("[evaluateStep] JSON parse failed, raw response:", raw.slice(0, 300), parseErr);
    // Retry once with a stricter prompt
    const retryPrompt = `${userPrompt}\n\nIMPORTANT: Return ONLY a raw JSON object. Start with { and end with }. No markdown, no extra text.`;
    const retryRaw = await chat(client, "You are a precise JSON-only web agent evaluator.", retryPrompt);
    const retryCleaned = stripMarkdownFences(retryRaw);
    parsed = JSON.parse(retryCleaned) as Record<string, unknown>;
  }

  if (!VALID_DECISIONS.includes(parsed.decision as EvaluateResponse["decision"])) {
    throw new Error(`Invalid decision value: ${parsed.decision}`);
  }

  return {
    decision: parsed.decision as EvaluateResponse["decision"],
    revised_steps: parsed.revised_steps as AgentStep[] | undefined,
    user_input_request: parsed.user_input_request as UserInputRequest | undefined,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
  };
}

// ----------------------------------------------------------------
// decideOption
// ----------------------------------------------------------------

export async function decideOption(
  options: ExtractedOption[],
  criteria: string,
  _client?: OpenAI
): Promise<DecideResponse> {
  const client = _client ?? getOpenAIClient();

  const userPrompt = `Select the best option based on the criteria.

## Options
${JSON.stringify(options, null, 2)}

## Criteria
${criteria}

Respond with ONLY a valid JSON object:
{
  "selected": <the full ExtractedOption object>,
  "reasoning": "<brief explanation>"
}`;

  const raw = await chat(client, "You are a precise JSON-only decision engine.", userPrompt);
  const cleaned = stripMarkdownFences(raw);
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;

  if (!parsed.selected || typeof parsed.selected !== "object") {
    throw new Error("decideOption: missing selected field");
  }

  return {
    selected: parsed.selected as ExtractedOption,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
  };
}
