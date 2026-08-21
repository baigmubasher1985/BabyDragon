-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Run-level QC. Preserves existing task-level public.qc_reviews unchanged.
-- NOTE: Decisions align with QCReview.jsx vocabulary.
-- PAIR: 104_field_test_qc_reviews
-- ROLE: FORWARD
-- CLASSIFICATION: (a) draftable / apply-candidate

BEGIN;

CREATE TABLE IF NOT EXISTS public.field_test_qc_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_test_run_id uuid NOT NULL REFERENCES public.field_test_runs(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id),
  reviewer_id uuid NOT NULL REFERENCES public.profiles(id),
  qc_decision text NOT NULL
    CHECK (qc_decision IN (
      'QC Passed',
      'QC Failed',
      'Needs Re-drive',
      'Waiting for Logs',
      'Log Naming Issue',
      'Missing Evidence'
    )),
  qc_notes text NULL,
  missing_evidence text[] NULL,
  redrive_needed boolean NOT NULL DEFAULT false,
  redrive_reason text NULL,
  redrive_task_id uuid NULL REFERENCES public.tasks(id),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_test_qc_reviews_run_unique UNIQUE (field_test_run_id)
);

CREATE INDEX IF NOT EXISTS field_test_qc_reviews_task_id_idx
  ON public.field_test_qc_reviews (task_id);
CREATE INDEX IF NOT EXISTS field_test_qc_reviews_decision_idx
  ON public.field_test_qc_reviews (qc_decision);
CREATE INDEX IF NOT EXISTS field_test_qc_reviews_redrive_idx
  ON public.field_test_qc_reviews (redrive_needed)
  WHERE redrive_needed IS TRUE;

COMMENT ON TABLE public.field_test_qc_reviews IS
  'F10C2 draft: run-level QC. Does not replace task-level qc_reviews.';
COMMENT ON COLUMN public.field_test_qc_reviews.redrive_task_id IS
  'Optional linked re-drive task created after Needs Re-drive decision.';

COMMIT;
