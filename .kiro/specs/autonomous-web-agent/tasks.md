# Tasks

## Task List

- [x] 1. Project Setup and Data Models
  - [x] 1.1 Initialize project structure with Vercel, React frontend, and TypeScript configuration
  - [x] 1.2 Set up Supabase project with `tasks` and `step_logs` tables matching TaskRecord and StepLog schemas
  - [x] 1.3 Configure Supabase row-level security policies scoped to user_id
  - [x] 1.4 Define and export all shared TypeScript interfaces (AgentStep, TaskRecord, StepLog, StepResult, BrowserError, PageState, MemoryContext, UserProfile, SessionState, FormSchema, FormField, FormFillPlan, UserInputRequest, ConfirmationEntry, TaskResult)

- [x] 2. Memory Service
  - [x] 2.1 Implement `loadMemoryContext(user_id, task_id)` — loads user profile, session state, extracted data, and step history from Supabase; returns defaults if no prior session exists
  - [x] 2.2 Implement sensitive field exclusion in `loadMemoryContext` — payment and identity fields must never appear in the returned UserProfile
  - [x] 2.3 Implement `storeUserData(user_id, data)` — persists user-provided field values to session state
  - [x] 2.4 Implement extracted data persistence — after each step, write extracted_data to session state in Supabase
  - [x] 2.5 Write property tests for Memory Service: sensitive fields excluded from returned context, data scoped to user_id, graceful empty-session handling

- [x] 3. Form Handler
  - [x] 3.1 Implement `isSensitiveField(field)` — returns true for password, credit_card, SSN, identity field types and labels
  - [x] 3.2 Implement `buildFormFillPlan(form_schema, memory_context)` — partitions all fields into auto_fill, needs_user_input, requires_confirmation
  - [x] 3.3 Write property tests for `buildFormFillPlan`: partition completeness (every field in exactly one set), sensitive fields never in auto_fill, required unmatched fields in needs_user_input

- [x] 4. Gemini Adapter
  - [x] 4.1 Implement `buildPlannerPrompt(goal, memory_context)` — constructs prompt including goal, non-sensitive profile fields, step history summary, and JSON schema instruction
  - [x] 4.2 Implement `planTask(goal, memory_context, max_steps)` — calls Gemini API, parses response into AgentStep array, validates 1–10 steps with all required fields
  - [x] 4.3 Implement parse error retry — on invalid JSON response, retry once with a more constrained prompt before returning a planner_error
  - [x] 4.4 Implement `evaluateStep(step, result, remaining_steps, retry_count)` — calls Gemini to get EvaluateResponse with one of the six valid decisions
  - [x] 4.5 Implement `decideOption(options, criteria)` — calls Gemini to select the best option from extracted choices
  - [x] 4.6 Write property tests for Gemini Adapter: prompt never contains sensitive data, plan always returns 1–10 steps, evaluate always returns a valid decision enum value

- [x] 5. TinyFish Adapter
  - [x] 5.1 Implement `executeStep(session_id, step)` — wraps TinyFish API call and returns a StepResult with success, extracted_data, error, and page_state
  - [x] 5.2 Implement BrowserError mapping — map TinyFish error responses to the defined BrowserError types (element_not_found, timeout, login_required, captcha, navigation_failed)
  - [x] 5.3 Write property tests for TinyFish Adapter: executeStep always returns a StepResult with all required fields for any input

- [x] 6. Error Handler
  - [x] 6.1 Implement `handleStepError(step, error, retry_count, task_id)` — returns ErrorHandlingDecision based on error type and retry count
  - [x] 6.2 Ensure retry decisions include delay_ms (1000ms for element_not_found/navigation_failed, 3000ms for timeout)
  - [x] 6.3 Ensure fail decisions include a human-readable reason string
  - [x] 6.4 Write property tests for `handleStepError`: always returns a valid decision for any BrowserError type, retry decisions have delay_ms, fail decisions have reason, retry_count >= 2 triggers replan for retryable errors

- [x] 7. Safety Confirmation Logic
  - [x] 7.1 Implement `requiresSafetyConfirmation(step)` — returns true for payment, form submission, email sending, file upload; false for search, open, extract, scroll
  - [x] 7.2 Write property tests for `requiresSafetyConfirmation`: returns false for all read-only action types, returns true for all write/submit action types

- [x] 8. Agent Loop
  - [x] 8.1 Implement the main `runAgentLoop(task_id, goal, user_id)` function following the pseudocode: load memory, plan, execute steps sequentially, evaluate after each step
  - [x] 8.2 Implement safety confirmation gate — pause task, emit UserInputRequest with type "safety_confirmation", await user response before executing gated step
  - [x] 8.3 Implement user input pause/resume — set task to "paused", emit UserInputRequest, resume with provided data without advancing step index
  - [x] 8.4 Implement retry logic — retry step with appropriate delay based on error type; trigger replan when retry_count reaches 2
  - [x] 8.5 Implement replan logic — request new plan from Gemini with current memory context, reset step_index to 0 and retry_counts to empty
  - [x] 8.6 Implement task completion — build TaskResult with summary and extracted_data, update task status to "completed"
  - [x] 8.7 Implement task failure — set status to "failed" with non-empty human-readable failure_reason for all failure paths
  - [x] 8.8 Implement ConfirmationEntry logging — record every safety confirmation decision (approved or cancelled) with timestamp
  - [x] 8.9 Write property tests for Agent Loop: retry_count invariant never exceeds 3, completed tasks have all steps logged, failed tasks always have non-empty failure_reason, safety-gated steps always have a prior ConfirmationEntry

- [x] 9. Task API (Vercel Functions)
  - [x] 9.1 Implement POST /api/task — validate non-empty goal, require JWT auth, create TaskRecord with status "pending", trigger Agent_Loop, return task_id
  - [x] 9.2 Implement POST /api/task/:id/respond — validate JWT, route user field values to paused Agent_Loop
  - [x] 9.3 Implement POST /api/task/:id/confirm — validate JWT, route user confirmation (true/false) to paused Agent_Loop
  - [x] 9.4 Implement GET /api/task/:id/status — return task status, all StepLog entries, TaskResult if completed, and pending UserInputRequest if any
  - [x] 9.5 Implement JWT authentication middleware — reject all requests without a valid Supabase Auth JWT
  - [x] 9.6 Implement rate limiting on POST /api/task
  - [x] 9.7 Write tests for Task API: unauthenticated requests rejected, empty goal rejected, status response contains all required fields

- [x] 10. Frontend (React)
  - [x] 10.1 Implement TaskInput component — text input for goal submission, calls POST /api/task on submit
  - [x] 10.2 Implement ExecutionView component — displays live step log, current task status, and TaskResult on completion
  - [x] 10.3 Implement StepLogItem component — renders a single step log entry with action type, target, status, and result
  - [x] 10.4 Implement UserInputForm component — renders UserInputRequest fields for missing data collection and submits to POST /api/task/:id/respond
  - [x] 10.5 Implement SafetyConfirmationDialog component — displays action summary and approve/cancel buttons, submits to POST /api/task/:id/confirm
  - [x] 10.6 Implement FailureDisplay component — renders failure_reason when task status is "failed"
  - [x] 10.7 Set up Supabase Realtime subscription in ExecutionView to receive live step log updates
  - [x] 10.8 Write property tests for Frontend components: UserInputForm renders all fields from UserInputRequest, SafetyConfirmationDialog renders action summary, FailureDisplay renders failure_reason

- [x] 11. Integration and End-to-End Testing
  - [x] 11.1 Write integration test: full happy-path task flow with mock TinyFish and mock Gemini (submit → plan → execute 3 steps → complete)
  - [x] 11.2 Write integration test: user input pause/resume flow — task pauses, user provides data, task resumes and completes
  - [x] 11.3 Write integration test: safety confirmation gate — step does not execute until confirmed === true
  - [x] 11.4 Write integration test: retry and replan flow — step fails twice, replan is triggered, task completes with new plan
  - [x] 11.5 Write integration test: user cancellation at safety confirmation — task fails with failure_reason "user_cancelled", no further browser actions taken
