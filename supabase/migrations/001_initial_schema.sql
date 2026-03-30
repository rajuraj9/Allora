-- ============================================================
-- 001_initial_schema.sql
-- Initial schema for the Autonomous Web Agent
-- ============================================================

-- ----------------------------------------------------------------
-- users_profile table
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users_profile (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT,
  email       TEXT,
  phone       TEXT,
  preferences JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- tasks table  (matches TaskRecord interface)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','running','paused','completed','failed')),
  step_plan      JSONB NOT NULL DEFAULT '[]'::jsonb,
  result         JSONB,
  failure_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- step_logs table  (matches StepLog interface)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS step_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step_id      TEXT NOT NULL,
  action_type  TEXT NOT NULL
                 CHECK (action_type IN (
                   'search','open','click','input','extract',
                   'select','submit','scroll','upload','wait'
                 )),
  target       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','running','success','failed','skipped')),
  result       JSONB,
  retry_count  INTEGER NOT NULL DEFAULT 0,
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- session_state table
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS session_state (
  task_id             UUID PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  current_step_index  INTEGER NOT NULL DEFAULT 0,
  retry_counts        JSONB NOT NULL DEFAULT '{}'::jsonb,
  browser_session_id  TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- Indexes for common query patterns
-- ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tasks_user_id     ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_step_logs_task_id ON step_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_session_user_id   ON session_state(user_id);

-- ----------------------------------------------------------------
-- updated_at auto-update trigger helper
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_profile_updated_at
  BEFORE UPDATE ON users_profile
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_session_state_updated_at
  BEFORE UPDATE ON session_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ================================================================
-- Row-Level Security (RLS)
-- ================================================================

-- Enable RLS on all tables
ALTER TABLE users_profile  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE step_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_state   ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- users_profile policies
-- ----------------------------------------------------------------
CREATE POLICY "users_profile: select own row"
  ON users_profile FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users_profile: update own row"
  ON users_profile FOR UPDATE
  USING (user_id = auth.uid());

-- ----------------------------------------------------------------
-- tasks policies
-- ----------------------------------------------------------------
CREATE POLICY "tasks: select own rows"
  ON tasks FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "tasks: insert own rows"
  ON tasks FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "tasks: update own rows"
  ON tasks FOR UPDATE
  USING (user_id = auth.uid());

-- ----------------------------------------------------------------
-- step_logs policies
-- ----------------------------------------------------------------
CREATE POLICY "step_logs: select own task logs"
  ON step_logs FOR SELECT
  USING (
    task_id IN (
      SELECT id FROM tasks WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "step_logs: insert own task logs"
  ON step_logs FOR INSERT
  WITH CHECK (
    task_id IN (
      SELECT id FROM tasks WHERE user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------
-- session_state policies
-- ----------------------------------------------------------------
CREATE POLICY "session_state: select own rows"
  ON session_state FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "session_state: insert own rows"
  ON session_state FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "session_state: update own rows"
  ON session_state FOR UPDATE
  USING (user_id = auth.uid());
