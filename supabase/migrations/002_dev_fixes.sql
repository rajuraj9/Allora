-- ============================================================
-- 002_dev_fixes.sql
-- Fixes for local development:
-- 1. Add missing pending_input and session_state columns to tasks
-- 2. Add extracted_data column to session_state
-- 3. Drop FK constraints on user_id so dev-local-user works
-- ============================================================

-- Add pending_input column to tasks (used by agent loop to signal paused state)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pending_input JSONB;

-- Add session_state column to tasks (used by respond/confirm routes)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS session_state JSONB DEFAULT '{}'::jsonb;

-- Add extracted_data column to session_state table
ALTER TABLE session_state ADD COLUMN IF NOT EXISTS extracted_data JSONB DEFAULT '{}'::jsonb;

-- Drop FK constraints so dev-local-user (non-auth UUID) works locally
-- In production these would be kept; for dev we relax them.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_user_id_fkey;
ALTER TABLE users_profile DROP CONSTRAINT IF EXISTS users_profile_user_id_fkey;
ALTER TABLE session_state DROP CONSTRAINT IF EXISTS session_state_user_id_fkey;
