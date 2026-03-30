# Requirements Document

## Introduction

A domain-agnostic autonomous AI agent MVP that executes real-world web tasks from natural language input. The system accepts a plain-English goal, uses Gemini to plan and reason, executes browser actions via TinyFish, persists state in Supabase, and surfaces live progress through a Vercel-hosted React frontend. The agent asks for missing data, requires confirmation before sensitive actions, and handles real-world failures gracefully through a structured retry and re-plan loop. The MVP is scoped to single tasks, max 10 steps, no parallel agents, and basic retry (1–2 times).

## Glossary

- **Agent_Loop**: The orchestration component that drives the plan → execute → evaluate cycle for a given task.
- **Task_API**: The Vercel serverless function that serves as the entry point for task submission and user interaction responses.
- **Gemini_Adapter**: The component wrapping Gemini API calls for planning, step evaluation, and decision-making.
- **TinyFish_Adapter**: The component wrapping TinyFish browser automation API for executing browser steps.
- **Memory_Service**: The Supabase-backed service that persists and retrieves user profile, session state, and step history.
- **Form_Handler**: The component that detects forms, matches fields to memory, and identifies missing or sensitive data.
- **Frontend**: The Vercel-hosted React application that displays live execution, collects user input, and shows results.
- **Planner**: The Gemini-powered sub-component that generates a structured step plan from a natural language goal.
- **Step**: A single discrete browser action within a task execution plan (e.g., click, input, extract).
- **TaskRecord**: The Supabase database record representing a task and its current status.
- **StepLog**: The Supabase database record representing the result of a single executed step.
- **UserInputRequest**: A structured pause event emitted when the agent requires data or confirmation from the user.
- **ConfirmationEntry**: A log record capturing whether a user approved or cancelled a safety-gated action.
- **FormFillPlan**: The output of the Form_Handler that partitions form fields into auto-fill, needs-user-input, and requires-confirmation sets.
- **BrowserError**: A structured error returned by TinyFish describing a browser-level failure.
- **AgentStep**: A structured representation of a single planned browser action including action type, target, input data, expected output, and fallback strategy.

---

## Requirements

### Requirement 1: Task Submission

**User Story:** As a user, I want to submit a natural language task goal, so that the agent can autonomously execute it on my behalf.

#### Acceptance Criteria

1. WHEN a user submits a goal string and user_id via POST /api/task, THE Task_API SHALL create a TaskRecord with status "pending" and return a task_id.
2. WHEN a task is created, THE Task_API SHALL trigger the Agent_Loop with the task_id, goal, and user_id.
3. IF the submitted goal is empty, THEN THE Task_API SHALL reject the request with an error response.
4. THE Task_API SHALL require an authenticated user session (Supabase Auth JWT) for all requests.

---

### Requirement 2: Task Planning

**User Story:** As a user, I want the agent to generate a structured execution plan from my goal, so that it can carry out the task step by step.

#### Acceptance Criteria

1. WHEN the Agent_Loop starts, THE Gemini_Adapter SHALL generate a step plan containing between 1 and 10 AgentStep objects.
2. WHEN generating a plan, THE Planner SHALL include for each AgentStep: a non-empty step_id, a valid action_type, a non-empty target, a non-empty expected_output, and a non-empty fallback_strategy.
3. WHEN a plan is generated, THE Agent_Loop SHALL persist the step plan to the TaskRecord in Supabase.
4. IF the Gemini API returns a response that cannot be parsed as valid AgentStep JSON, THEN THE Gemini_Adapter SHALL retry the plan request once with a more constrained prompt before failing the task.
5. IF the retry plan request also fails to parse, THEN THE Agent_Loop SHALL mark the task as failed with failure_reason "planner_error".

---

### Requirement 3: Step Execution

**User Story:** As a user, I want the agent to execute each planned step in the browser, so that real-world web actions are performed on my behalf.

#### Acceptance Criteria

1. WHEN the Agent_Loop processes a step, THE TinyFish_Adapter SHALL execute the step and return a StepResult containing success status, optional extracted_data, optional BrowserError, and page_state.
2. WHEN a step begins execution, THE Agent_Loop SHALL log the step with status "running" in Supabase.
3. WHEN a step completes, THE Agent_Loop SHALL log the StepResult to the corresponding StepLog in Supabase.
4. THE Agent_Loop SHALL execute steps sequentially, not in parallel.
5. THE Agent_Loop SHALL execute a maximum of 10 steps per task.

---

### Requirement 4: Step Evaluation and Re-planning

**User Story:** As a user, I want the agent to intelligently decide what to do after each step, so that it can adapt to unexpected results and complete the task.

#### Acceptance Criteria

1. WHEN a step completes, THE Gemini_Adapter SHALL evaluate the StepResult and return one of: "continue", "retry", "replan", "need_user_input", "complete", or "fail".
2. WHEN the evaluation decision is "continue", THE Agent_Loop SHALL advance to the next step.
3. WHEN the evaluation decision is "complete", THE Agent_Loop SHALL build the TaskResult and mark the task as "completed".
4. WHEN the evaluation decision is "fail", THE Agent_Loop SHALL mark the task as "failed" with the reasoning as failure_reason.
5. WHEN the evaluation decision is "replan", THE Agent_Loop SHALL request a new plan from the Gemini_Adapter using the current memory context and restart from step index 0.

---

### Requirement 5: Retry Logic

**User Story:** As a user, I want the agent to retry failed steps before giving up, so that transient errors do not unnecessarily abort my task.

#### Acceptance Criteria

1. WHEN a step fails with error type "element_not_found" or "navigation_failed" and retry_count is less than 2, THE Agent_Loop SHALL retry the step after a 1000ms delay.
2. WHEN a step fails with error type "timeout" and retry_count is less than 2, THE Agent_Loop SHALL retry the step after a 3000ms delay.
3. WHEN retry_count for a step reaches 2, THE Agent_Loop SHALL trigger a re-plan instead of retrying again.
4. THE Agent_Loop SHALL maintain the invariant that retry_count for any step never exceeds 3 before a re-plan is triggered.

---

### Requirement 6: User Input Collection

**User Story:** As a user, I want the agent to pause and ask me for missing information, so that it can complete tasks that require data I haven't provided upfront.

#### Acceptance Criteria

1. WHEN the Agent_Loop determines user input is required, THE Agent_Loop SHALL set the task status to "paused" and emit a UserInputRequest event to the Frontend.
2. WHEN a task is paused for user input, THE Frontend SHALL display the UserInputRequest message and input fields to the user.
3. WHEN the user submits a response via POST /api/task/:id/respond, THE Task_API SHALL resume the Agent_Loop with the provided field values.
4. WHEN the Agent_Loop resumes with user-provided data, THE Memory_Service SHALL store the provided data in the user's profile or session state.
5. WHEN the Agent_Loop resumes after user input, THE Agent_Loop SHALL set the task status back to "running" and retry the current step with the new data.
6. IF a login wall is detected by TinyFish, THEN THE Agent_Loop SHALL pause and emit a UserInputRequest with type "credentials".
7. IF a CAPTCHA is detected by TinyFish, THEN THE Agent_Loop SHALL pause and emit a UserInputRequest with type "captcha" asking the user to solve it manually.

---

### Requirement 7: Safety Confirmation

**User Story:** As a user, I want the agent to ask for my explicit approval before performing sensitive actions, so that I remain in control of consequential operations.

#### Acceptance Criteria

1. WHEN a step involves payment, form submission, email sending, or file upload, THE Agent_Loop SHALL pause and emit a UserInputRequest with type "safety_confirmation" before executing the step.
2. WHEN a safety confirmation is required, THE Frontend SHALL display the action summary to the user and collect an approve or cancel response.
3. WHEN the user approves via POST /api/task/:id/confirm, THE Agent_Loop SHALL record a ConfirmationEntry with confirmed_by_user true and proceed with step execution.
4. WHEN the user cancels via POST /api/task/:id/confirm, THE Agent_Loop SHALL record a ConfirmationEntry with confirmed_by_user false and mark the task as "failed" with failure_reason "user_cancelled".
5. THE Agent_Loop SHALL never execute a safety-gated step without a preceding ConfirmationEntry with confirmed_by_user true.
6. THE requiresSafetyConfirmation function SHALL return false for read-only actions: search, open, extract, and scroll.

---

### Requirement 8: Form Handling

**User Story:** As a user, I want the agent to intelligently fill forms using my stored profile data, so that I don't have to manually enter information the agent already knows.

#### Acceptance Criteria

1. WHEN a form is detected on a page, THE Form_Handler SHALL produce a FormFillPlan that partitions every form field into exactly one of: auto_fill, needs_user_input, or requires_confirmation.
2. WHEN a form field matches a value in the user's profile or extracted session data, THE Form_Handler SHALL place it in auto_fill.
3. WHEN a form field is identified as sensitive (password, credit card, SSN, identity), THE Form_Handler SHALL place it in requires_confirmation regardless of whether a memory match exists.
4. WHEN a required form field has no memory match and is not sensitive, THE Form_Handler SHALL place it in needs_user_input.
5. THE Form_Handler SHALL never place a sensitive field in auto_fill without a corresponding ConfirmationEntry with confirmed_by_user true.

---

### Requirement 9: Memory and State Persistence

**User Story:** As a user, I want the agent to remember context across steps within a task, so that it can make informed decisions throughout execution.

#### Acceptance Criteria

1. WHEN the Agent_Loop starts, THE Memory_Service SHALL load the user's profile, session state, extracted data, and step history from Supabase.
2. WHEN a step produces extracted data, THE Memory_Service SHALL persist the extracted data to the session state in Supabase.
3. WHEN loading memory context, THE Memory_Service SHALL exclude sensitive fields (payment, identity) from the returned UserProfile.
4. IF no prior session exists for a task, THEN THE Memory_Service SHALL return a MemoryContext with empty or default values without throwing an error.
5. THE Memory_Service SHALL scope all data access to the authenticated user_id using Supabase row-level security.

---

### Requirement 10: Task Status and Live Progress

**User Story:** As a user, I want to see live progress of my task execution, so that I know what the agent is doing and can intervene if needed.

#### Acceptance Criteria

1. WHEN a task status changes, THE Agent_Loop SHALL update the TaskRecord status in Supabase.
2. WHEN step logs are written, THE Frontend SHALL receive real-time updates via Supabase Realtime subscriptions.
3. WHEN a user polls GET /api/task/:id/status, THE Task_API SHALL return the current task status, all StepLog entries, the TaskResult if completed, and any pending UserInputRequest.
4. WHEN a task completes successfully, THE Agent_Loop SHALL set status to "completed" and populate the TaskResult with a summary and extracted_data.
5. WHEN a task fails, THE Agent_Loop SHALL set status to "failed" and populate failure_reason with a non-empty human-readable string.

---

### Requirement 11: Security and Data Protection

**User Story:** As a user, I want my sensitive data to be protected throughout task execution, so that my personal and financial information is never exposed inappropriately.

#### Acceptance Criteria

1. THE Task_API SHALL reject all requests that do not include a valid Supabase Auth JWT.
2. THE Memory_Service SHALL store sensitive user data (payment, identity) encrypted at rest in Supabase.
3. THE Gemini_Adapter SHALL never include raw passwords or payment data in any prompt sent to the Gemini API.
4. THE Agent_Loop SHALL never include sensitive field values in TinyFish step inputs without explicit user confirmation.
5. THE Agent_Loop SHALL log all actions with timestamps and user_id for audit trail purposes.
6. THE Task_API SHALL apply rate limiting on POST /api/task to prevent abuse.
7. WHEN a CAPTCHA is encountered, THE Agent_Loop SHALL always require human intervention and SHALL never attempt automated CAPTCHA solving.

---

### Requirement 12: Error Handling and Task Failure

**User Story:** As a user, I want the agent to handle unexpected errors gracefully and explain what went wrong, so that I understand the outcome and can take corrective action.

#### Acceptance Criteria

1. WHEN an unrecoverable BrowserError occurs, THE Agent_Loop SHALL mark the task as "failed" with a human-readable failure_reason.
2. WHEN a task fails, THE Frontend SHALL display the failure_reason to the user.
3. IF a step fails with an error type not covered by retry or replan logic, THEN THE Agent_Loop SHALL mark the task as "failed" with failure_reason set to the error message.
4. THE Agent_Loop SHALL always produce a non-empty failure_reason string for any task with status "failed".
5. WHEN user cancels at a safety confirmation, THE Agent_Loop SHALL stop all further browser actions and clean up the browser session.
