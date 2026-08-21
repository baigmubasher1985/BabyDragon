-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Optional normalized KPIs only. Full payload remains in JSON summaries / artifacts.
-- PAIR: 103_field_test_metrics
-- ROLE: FORWARD
-- CLASSIFICATION: (a) draftable / apply-candidate

BEGIN;

CREATE TABLE IF NOT EXISTS public.field_test_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.field_test_runs(id) ON DELETE CASCADE,
  metric_key text NOT NULL,
  metric_value double precision NULL,
  metric_unit text NULL,
  metric_group text NULL,
  scenario_type text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_test_metrics_run_key_unique UNIQUE (run_id, metric_key, scenario_type)
);

CREATE INDEX IF NOT EXISTS field_test_metrics_run_id_idx
  ON public.field_test_metrics (run_id);
CREATE INDEX IF NOT EXISTS field_test_metrics_key_idx
  ON public.field_test_metrics (metric_key);

COMMENT ON TABLE public.field_test_metrics IS
  'F10C2 draft: optional normalized KPI rows. Not a substitute for full report artifacts.';

COMMIT;
