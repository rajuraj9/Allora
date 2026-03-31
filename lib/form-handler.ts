// ============================================================
// lib/form-handler.ts
// Form detection, field classification, and fill planning
// ============================================================

import type { FormField, FormSchema, FormFillPlan, MemoryContext } from "./types";

// ----------------------------------------------------------------
// Sensitive field detection
// ----------------------------------------------------------------

const SENSITIVE_LABEL_PATTERNS = [
  "card number",
  "cvv",
  "social security",
  "passport",
  "payment",
  "credit",
];

const SENSITIVE_NAME_PATTERNS = [
  "card",
  "cvv",
  "ssn",
  "passport",
  "payment",
  "password",
];

/**
 * Returns true if the field is considered sensitive and requires
 * explicit user confirmation before being filled.
 */
export function isSensitiveField(field: FormField): boolean {
  if (field.type === "password") return true;

  const labelLower = field.label.toLowerCase();
  if (SENSITIVE_LABEL_PATTERNS.some((p) => labelLower.includes(p))) return true;

  const nameLower = field.name.toLowerCase();
  if (SENSITIVE_NAME_PATTERNS.some((p) => nameLower.includes(p))) return true;

  return false;
}

// ----------------------------------------------------------------
// Form fill plan builder
// ----------------------------------------------------------------

/**
 * Partitions all form fields into three disjoint sets:
 * - auto_fill: matched from memory (user_profile or extracted_data)
 * - needs_user_input: required fields with no memory match
 * - requires_confirmation: sensitive fields (never auto-filled)
 *
 * Optional non-required fields with no match are silently skipped.
 */
export function buildFormFillPlan(
  form_schema: FormSchema,
  memory_context: MemoryContext
): FormFillPlan {
  const auto_fill: Record<string, string> = {};
  const needs_user_input: FormField[] = [];
  const requires_confirmation: FormField[] = [];

  for (const field of form_schema.fields) {
    if (isSensitiveField(field)) {
      requires_confirmation.push(field);
      continue;
    }

    const profile = memory_context.user_profile as unknown as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(profile, field.name)) {
      const profileValue = profile[field.name];
      if (profileValue !== undefined && profileValue !== null) {
        auto_fill[field.name] = String(profileValue);
        continue;
      }
    }

    if (Object.prototype.hasOwnProperty.call(memory_context.extracted_data, field.name)) {
      const extractedValue = memory_context.extracted_data[field.name];
      if (extractedValue !== undefined && extractedValue !== null) {
        auto_fill[field.name] = String(extractedValue);
        continue;
      }
    }

    if (field.required) {
      needs_user_input.push(field);
    }
    // optional fields with no match are silently skipped
  }

  return { auto_fill, needs_user_input, requires_confirmation };
}
