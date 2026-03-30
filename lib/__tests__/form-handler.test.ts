// ============================================================
// lib/__tests__/form-handler.test.ts
// Property-based tests for the Form Handler
// ============================================================

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { isSensitiveField, buildFormFillPlan } from "../form-handler";
import type { FormField, FormSchema, MemoryContext } from "../types";

// ----------------------------------------------------------------
// Arbitraries
// ----------------------------------------------------------------

const fieldTypeArb = fc.constantFrom(
  "text",
  "email",
  "tel",
  "date",
  "select",
  "file",
  "password"
) as fc.Arbitrary<FormField["type"]>;

// Prototype property names that would cause false positives when used as object keys
const PROTO_KEYS = new Set([
  "constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf",
  "propertyIsEnumerable", "toLocaleString", "__proto__", "__defineGetter__",
  "__defineSetter__", "__lookupGetter__", "__lookupSetter__",
]);

/** Generates a safe (non-sensitive) field name */
const safeNameArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter(
    (s) =>
      !["card", "cvv", "ssn", "passport", "payment", "password"].some((p) =>
        s.toLowerCase().includes(p)
      ) && !PROTO_KEYS.has(s)
  );

/** Generates a safe (non-sensitive) label */
const safeLabelArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter(
    (s) =>
      !["card number", "cvv", "social security", "passport", "payment", "credit"].some((p) =>
        s.toLowerCase().includes(p)
      )
  );

/** Generates a non-password field type */
const nonPasswordTypeArb = fc.constantFrom(
  "text",
  "email",
  "tel",
  "date",
  "select",
  "file"
) as fc.Arbitrary<FormField["type"]>;

/** Generates a FormField with a safe name, safe label, and non-password type */
const safeFieldArb: fc.Arbitrary<FormField> = fc.record({
  label: safeLabelArb,
  name: safeNameArb,
  type: nonPasswordTypeArb,
  required: fc.boolean(),
});

/** Generates a FormField that is guaranteed to be sensitive */
const sensitiveFieldArb: fc.Arbitrary<FormField> = fc.oneof(
  // password type
  fc.record({
    label: safeLabelArb,
    name: safeNameArb,
    type: fc.constant("password" as FormField["type"]),
    required: fc.boolean(),
  }),
  // sensitive label
  fc.record({
    label: fc
      .tuple(
        fc.string({ minLength: 0, maxLength: 5 }),
        fc.constantFrom("card number", "cvv", "social security", "passport", "payment", "credit"),
        fc.string({ minLength: 0, maxLength: 5 })
      )
      .map(([pre, pat, suf]) => `${pre}${pat}${suf}`),
    name: safeNameArb,
    type: nonPasswordTypeArb,
    required: fc.boolean(),
  }),
  // sensitive name
  fc.record({
    label: safeLabelArb,
    name: fc
      .tuple(
        fc.string({ minLength: 0, maxLength: 5 }),
        fc.constantFrom("card", "cvv", "ssn", "passport", "payment", "password"),
        fc.string({ minLength: 0, maxLength: 5 })
      )
      .map(([pre, pat, suf]) => `${pre}${pat}${suf}`),
    type: nonPasswordTypeArb,
    required: fc.boolean(),
  })
);

/** Generates a FormSchema with a mix of safe and sensitive fields */
const formSchemaArb: fc.Arbitrary<FormSchema> = fc
  .array(fc.oneof(safeFieldArb, sensitiveFieldArb), { minLength: 1, maxLength: 10 })
  .map((fields) => ({ fields }));

/** Generates a MemoryContext with arbitrary user_profile and extracted_data */
const memoryContextArb: fc.Arbitrary<MemoryContext> = fc.record({
  user_profile: fc.record({
    user_id: fc.uuid(),
    name: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
    email: fc.option(fc.emailAddress(), { nil: undefined }),
    phone: fc.option(fc.string({ minLength: 1, maxLength: 15 }), { nil: undefined }),
  }),
  session_state: fc.record({
    task_id: fc.uuid(),
    current_step_index: fc.nat(9),
    retry_counts: fc.constant({}),
  }),
  extracted_data: fc.dictionary(
    safeNameArb,
    fc.string({ minLength: 1, maxLength: 20 })
  ),
  step_history: fc.constant([]),
});

// ----------------------------------------------------------------
// Property A — Partition completeness
// Validates: Requirements 8.1, 8.2, 8.3, 8.4
// ----------------------------------------------------------------

describe("Property A: partition completeness", () => {
  it("every required field appears in exactly one of the three sets, and the sets are disjoint", () => {
    fc.assert(
      fc.property(formSchemaArb, memoryContextArb, (form_schema, memory_context) => {
        const plan = buildFormFillPlan(form_schema, memory_context);

        const autoFillNames = new Set(Object.keys(plan.auto_fill));
        const needsInputNames = new Set(plan.needs_user_input.map((f) => f.name));
        const confirmationNames = new Set(plan.requires_confirmation.map((f) => f.name));

        // Disjointness: no name appears in more than one set
        for (const name of autoFillNames) {
          expect(needsInputNames.has(name)).toBe(false);
          expect(confirmationNames.has(name)).toBe(false);
        }
        for (const name of needsInputNames) {
          expect(autoFillNames.has(name)).toBe(false);
          expect(confirmationNames.has(name)).toBe(false);
        }
        for (const name of confirmationNames) {
          expect(autoFillNames.has(name)).toBe(false);
          expect(needsInputNames.has(name)).toBe(false);
        }

        // Every required field must appear in exactly one set
        for (const field of form_schema.fields) {
          if (!field.required) continue;
          const inAutoFill = autoFillNames.has(field.name);
          const inNeedsInput = needsInputNames.has(field.name);
          const inConfirmation = confirmationNames.has(field.name);
          const count = [inAutoFill, inNeedsInput, inConfirmation].filter(Boolean).length;
          expect(count).toBe(1);
        }
      }),
      { numRuns: 200 }
    );
  });
});

// ----------------------------------------------------------------
// Property B — Sensitive fields never in auto_fill
// Validates: Requirements 8.5, 7.5, 11.4
// ----------------------------------------------------------------

describe("Property B: sensitive fields never appear in auto_fill", () => {
  it("no sensitive field name ever appears as a key in auto_fill", () => {
    fc.assert(
      fc.property(formSchemaArb, memoryContextArb, (form_schema, memory_context) => {
        const plan = buildFormFillPlan(form_schema, memory_context);
        const autoFillNames = new Set(Object.keys(plan.auto_fill));

        for (const field of form_schema.fields) {
          if (isSensitiveField(field)) {
            expect(autoFillNames.has(field.name)).toBe(false);
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  it("a schema with only sensitive fields produces an empty auto_fill", () => {
    fc.assert(
      fc.property(
        fc.array(sensitiveFieldArb, { minLength: 1, maxLength: 8 }).map((fields) => ({ fields })),
        memoryContextArb,
        (form_schema, memory_context) => {
          const plan = buildFormFillPlan(form_schema, memory_context);
          expect(Object.keys(plan.auto_fill)).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ----------------------------------------------------------------
// Property C — Required unmatched fields in needs_user_input
// Validates: Requirements 8.2, 8.3
// ----------------------------------------------------------------

describe("Property C: required unmatched non-sensitive fields appear in needs_user_input", () => {
  it("a required safe field with no memory match always ends up in needs_user_input", () => {
    fc.assert(
      fc.property(
        // Build a schema where every field is safe, required, and has a unique name
        fc
          .array(
            fc.record({
              label: safeLabelArb,
              name: safeNameArb,
              type: nonPasswordTypeArb,
              required: fc.constant(true),
            }),
            { minLength: 1, maxLength: 8 }
          )
          .map((fields) => {
            // Deduplicate by name to avoid ambiguity
            const seen = new Set<string>();
            return { fields: fields.filter((f) => (seen.has(f.name) ? false : seen.add(f.name) && true)) };
          }),
        (form_schema) => {
          // Use an empty memory context so nothing matches
          const emptyMemory: MemoryContext = {
            user_profile: { user_id: "u1" },
            session_state: { task_id: "t1", current_step_index: 0, retry_counts: {} },
            extracted_data: {},
            step_history: [],
          };

          const plan = buildFormFillPlan(form_schema, emptyMemory);
          const needsInputNames = new Set(plan.needs_user_input.map((f) => f.name));

          for (const field of form_schema.fields) {
            // All fields are safe and required with no memory match
            expect(needsInputNames.has(field.name)).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("a required safe field matched in user_profile goes to auto_fill, not needs_user_input", () => {
    fc.assert(
      fc.property(
        fc.record({
          label: safeLabelArb,
          name: safeNameArb,
          type: nonPasswordTypeArb,
          required: fc.constant(true),
        }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (field, value) => {
          const form_schema: FormSchema = { fields: [field] };
          const memory: MemoryContext = {
            user_profile: { user_id: "u1", [field.name]: value } as MemoryContext["user_profile"],
            session_state: { task_id: "t1", current_step_index: 0, retry_counts: {} },
            extracted_data: {},
            step_history: [],
          };

          const plan = buildFormFillPlan(form_schema, memory);
          expect(plan.auto_fill[field.name]).toBe(value);
          expect(plan.needs_user_input.map((f) => f.name)).not.toContain(field.name);
        }
      ),
      { numRuns: 200 }
    );
  });
});
