-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 104_field_test_qc_reviews
-- ROLE: VERIFICATION
-- NOTE: Confirms field_test_qc_reviews exists without mutating qc_reviews.

SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('field_test_qc_reviews', 'qc_reviews')
ORDER BY c.relname;
