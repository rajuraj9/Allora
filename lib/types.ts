// ============================================================
// lib/types.ts
// Shared TypeScript interfaces for the Autonomous Web Agent
// ============================================================

// ----------------------------------------------------------------
// Primitive union types
// ----------------------------------------------------------------

export type ActionType =
  | "search"
  | "open"
  | "click"
  | "input"
  | "extract"
  | "select"
  | "submit"
  | "scroll"
  | "upload"
  | "wait";

export type TaskStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed";

// ----------------------------------------------------------------
// Agent Step
// ----------------------------------------------------------------

export interface AgentStep {
  /** e.g. "step_1" */
  step_id: string;
  action_type: ActionType;
  /** URL, CSS selector, keyword, or element description */
  target: string;
  input_data?: Record<string, string>;
  expected_output: string;
  fallback_strategy: string;
}

// ----------------------------------------------------------------
// Task Record  (Supabase: tasks table)
// ----------------------------------------------------------------

export interface TaskRecord {
  id: string; // uuid
  user_id: string;
  goal: string;
  status: TaskStatus;
  step_plan: AgentStep[];
  result?: TaskResult;
  failure_reason?: string;
  created_at: string;
  updated_at: string;
}

// ----------------------------------------------------------------
// Step Log  (Supabase: step_logs table)
// ----------------------------------------------------------------

export interface StepLog {
  id: string;
  task_id: string;
  step_id: string;
  action_type: ActionType;
  target: string;
  status: "pending" | "running" | "success" | "failed" | "skipped";
  result?: StepResult;
  retry_count: number;
  timestamp: string;
}

// ----------------------------------------------------------------
// Step Result
// ----------------------------------------------------------------

export interface StepResult {
  success: boolean;
  extracted_data?: Record<string, unknown>;
  error?: BrowserError;
  page_state: PageState;
}

// ----------------------------------------------------------------
// Browser Error
// ----------------------------------------------------------------

export interface BrowserError {
  type:
    | "element_not_found"
    | "timeout"
    | "login_required"
    | "captcha"
    | "navigation_failed";
  message: string;
}

// ----------------------------------------------------------------
// Page State
// ----------------------------------------------------------------

export interface PageState {
  url: string;
  title: string;
  forms_detected: FormSchema[];
  screenshot_url?: string;
}

// ----------------------------------------------------------------
// Form types
// ----------------------------------------------------------------

export interface FormField {
  label: string;
  name: string;
  type: "text" | "email" | "tel" | "date" | "select" | "file" | "password";
  required: boolean;
  options?: string[]; // for select fields
}

export interface FormSchema {
  fields: FormField[];
}

export interface FormFillPlan {
  /** Fields matched from memory — values ready to auto-fill */
  auto_fill: Record<string, string>;
  /** Required fields with no memory match — user must provide */
  needs_user_input: FormField[];
  /** Sensitive fields — require explicit user confirmation */
  requires_confirmation: FormField[];
}

// ----------------------------------------------------------------
// User Profile
// ----------------------------------------------------------------

export interface UserProfile {
  user_id: string;
  name?: string;
  email?: string;
  phone?: string;
  preferences?: Record<string, string>;
  // NOTE: payment/identity data stored encrypted, never auto-filled
}

// ----------------------------------------------------------------
// Session State
// ----------------------------------------------------------------

export interface SessionState {
  task_id: string;
  current_step_index: number;
  retry_counts: Record<string, number>;
  browser_session_id?: string;
}

// ----------------------------------------------------------------
// Memory Context
// ----------------------------------------------------------------

export interface MemoryContext {
  user_profile: UserProfile;
  session_state: SessionState;
  extracted_data: Record<string, unknown>;
  step_history: StepLog[];
}

// ----------------------------------------------------------------
// User Input Request
// ----------------------------------------------------------------

export interface UserInputRequest {
  task_id: string;
  type: "missing_fields" | "safety_confirmation" | "captcha" | "credentials";
  message: string;
  fields?: FormField[];
  /** For safety_confirmation type */
  action_summary?: string;
}

// ----------------------------------------------------------------
// Confirmation Entry
// ----------------------------------------------------------------

export interface ConfirmationEntry {
  action: string;
  confirmed_by_user: boolean;
  timestamp: string;
}

// ----------------------------------------------------------------
// Task Result
// ----------------------------------------------------------------

export interface TaskResult {
  summary: string;
  extracted_data: Record<string, unknown>;
  confirmation_log: ConfirmationEntry[];
}

// ----------------------------------------------------------------
// Agent Loop I/O
// ----------------------------------------------------------------

export interface AgentLoopInput {
  task_id: string;
  goal: string;
  user_id: string;
}

export interface AgentLoopOutput {
  status: "completed" | "failed" | "paused";
  result?: TaskResult;
  failure_reason?: string;
}

// ----------------------------------------------------------------
// Error Handling Decision
// ----------------------------------------------------------------

export interface ErrorHandlingDecision {
  action: "retry" | "replan" | "need_user_input" | "fail";
  delay_ms?: number; // present when action === "retry"
  reason?: string; // present when action === "fail"
  request?: UserInputRequest; // present when action === "need_user_input"
}

// ----------------------------------------------------------------
// Extracted Option  (for Gemini decide)
// ----------------------------------------------------------------

export interface ExtractedOption {
  label: string;
  value: string;
  metadata?: Record<string, unknown>;
}
