-- ============================================================
-- 003_step_logs_unique_constraint.sql
-- Add unique constraint on (task_id, step_id) to step_logs
-- so that upsert onConflict works correctly in the agent loop.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'step_logs_task_id_step_id_unique'
  ) THEN
    ALTER TABLE step_logs
      ADD CONSTRAINT step_logs_task_id_step_id_unique
      UNIQUE (task_id, step_id);
  END IF;
END $$;

-- Add update policy for step_logs (needed for upsert)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'step_logs' AND policyname = 'step_logs: update own task logs'
  ) THEN
    CREATE POLICY "step_logs: update own task logs"
      ON step_logs FOR UPDATE
      USING (
        task_id IN (
          SELECT id FROM tasks WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;
