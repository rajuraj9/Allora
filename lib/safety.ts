// ============================================================
// lib/safety.ts
// Safety Confirmation Logic
// ============================================================

import type { AgentStep } from "./types";

const SAFETY_GATED: ReadonlySet<string> = new Set(["submit", "upload"]);

export function requiresSafetyConfirmation(step: AgentStep): boolean {
  return SAFETY_GATED.has(step.action_type);
}
