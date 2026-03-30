/**
 * Component property tests
 *
 * Validates: Requirements 10.1, 10.2, 10.3
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import * as fc from "fast-check";
import UserInputForm from "@/components/UserInputForm";
import SafetyConfirmationDialog from "@/components/SafetyConfirmationDialog";
import FailureDisplay from "@/components/FailureDisplay";
import { UserInputRequest, FormField } from "@/lib/types";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const fieldTypeArb = fc.constantFrom(
  "text",
  "email",
  "tel",
  "date",
  "password"
) as fc.Arbitrary<FormField["type"]>;

const formFieldArb: fc.Arbitrary<FormField> = fc.record({
  label: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
  name: fc
    .string({ minLength: 1, maxLength: 20 })
    .filter((s) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(s)),
  type: fieldTypeArb,
  required: fc.boolean(),
});

function uniqueFieldsArb(min = 1, max = 6): fc.Arbitrary<FormField[]> {
  return fc
    .array(formFieldArb, { minLength: min, maxLength: max })
    .filter((fields) => {
      const names = fields.map((f) => f.name);
      return new Set(names).size === names.length;
    });
}

function missingFieldsRequestArb(): fc.Arbitrary<UserInputRequest> {
  return uniqueFieldsArb(1, 5).map((fields) => ({
    task_id: "task-123",
    type: "missing_fields" as const,
    message: "Please provide the following fields",
    fields,
  }));
}

// ---------------------------------------------------------------------------
// Property: UserInputForm renders all fields from UserInputRequest
// Validates: Requirements 10.1
// ---------------------------------------------------------------------------

describe("UserInputForm", () => {
  afterEach(() => cleanup());

  it("renders all fields from UserInputRequest", () => {
    fc.assert(
      fc.property(missingFieldsRequestArb(), (request) => {
        const { container, unmount } = render(
          <UserInputForm request={request} onSubmit={vi.fn()} />
        );

        for (const field of request.fields ?? []) {
          // Each field label should appear in the document
          const allLabels = Array.from(container.querySelectorAll("label"));
          const found = allLabels.some((el) =>
            el.textContent?.includes(field.label)
          );
          expect(found, `Expected label "${field.label}" to be rendered`).toBe(true);
        }

        unmount();
      }),
      { numRuns: 20 }
    );
  });

  it("shows required indicator (*) for required fields", () => {
    const request: UserInputRequest = {
      task_id: "t1",
      type: "missing_fields",
      message: "Fill in",
      fields: [
        { label: "Email", name: "email", type: "email", required: true },
        { label: "Phone", name: "phone", type: "tel", required: false },
      ],
    };
    render(<UserInputForm request={request} onSubmit={vi.fn()} />);
    // The required asterisk should be present
    const stars = screen.getAllByText("*");
    expect(stars.length).toBeGreaterThanOrEqual(1);
  });

  it("calls onSubmit with field values on form submission", () => {
    const onSubmit = vi.fn();
    const request: UserInputRequest = {
      task_id: "t1",
      type: "missing_fields",
      message: "Fill in",
      fields: [{ label: "Name", name: "name", type: "text", required: true }],
    };
    render(<UserInputForm request={request} onSubmit={onSubmit} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Alice" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith({ name: "Alice" });
  });
});

// ---------------------------------------------------------------------------
// Property: SafetyConfirmationDialog renders action_summary
// Validates: Requirements 10.2
// ---------------------------------------------------------------------------

describe("SafetyConfirmationDialog", () => {
  afterEach(() => cleanup());

  it("renders action_summary from UserInputRequest", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        (summary) => {
          const request: UserInputRequest = {
            task_id: "task-abc",
            type: "safety_confirmation",
            message: "Confirm this action",
            action_summary: summary,
          };
          const { container, unmount } = render(
            <SafetyConfirmationDialog request={request} onConfirm={vi.fn()} />
          );
          // Check that the action_summary text appears somewhere in the rendered output
          const found = container.textContent?.includes(summary.trim()) ?? false;
          expect(found, `Expected action_summary "${summary}" to be rendered`).toBe(true);
          unmount();
        }
      ),
      { numRuns: 20 }
    );
  });

  it("calls onConfirm(true) when Approve is clicked", () => {
    const onConfirm = vi.fn();
    const request: UserInputRequest = {
      task_id: "t1",
      type: "safety_confirmation",
      message: "Confirm?",
      action_summary: "Submit payment form",
    };
    render(<SafetyConfirmationDialog request={request} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it("calls onConfirm(false) when Cancel is clicked", () => {
    const onConfirm = vi.fn();
    const request: UserInputRequest = {
      task_id: "t1",
      type: "safety_confirmation",
      message: "Confirm?",
      action_summary: "Submit payment form",
    };
    render(<SafetyConfirmationDialog request={request} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });
});

// ---------------------------------------------------------------------------
// Property: FailureDisplay renders failure_reason
// Validates: Requirements 10.3
// ---------------------------------------------------------------------------

describe("FailureDisplay", () => {
  afterEach(() => cleanup());

  it("renders failure_reason string", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 300 }).filter((s) => s.trim().length > 0),
        (reason) => {
          const { container, unmount } = render(
            <FailureDisplay failure_reason={reason} onRetry={vi.fn()} />
          );
          const found = container.textContent?.includes(reason.trim()) ?? false;
          expect(found, `Expected failure_reason "${reason}" to be rendered`).toBe(true);
          unmount();
        }
      ),
      { numRuns: 20 }
    );
  });

  it("calls onRetry when Try Again is clicked", () => {
    const onRetry = vi.fn();
    render(
      <FailureDisplay failure_reason="Something went wrong" onRetry={onRetry} />
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
