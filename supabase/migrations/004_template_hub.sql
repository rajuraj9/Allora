-- ============================================================
-- 004_template_hub.sql
-- Template Hub: custom_templates + template_runs tables
-- ============================================================

-- Custom templates created by users
CREATE TABLE IF NOT EXISTS custom_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  fields      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Analytics: track template run success rates
CREATE TABLE IF NOT EXISTS template_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id TEXT NOT NULL,
  user_id     UUID NOT NULL,
  task_id     UUID NOT NULL,
  success     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_templates_user ON custom_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_template_runs_template ON template_runs(template_id);

-- RLS
ALTER TABLE custom_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_runs    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "custom_templates: own rows"
  ON custom_templates FOR ALL USING (user_id = auth.uid());

CREATE POLICY "template_runs: own rows"
  ON template_runs FOR ALL USING (user_id = auth.uid());
