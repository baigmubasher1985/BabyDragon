-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 112_result_artifacts_storage_contract
-- ROLE: VERIFICATION
-- NOTE: Expect no result-artifacts bucket until separately authorized.

SELECT name, public
FROM storage.buckets
WHERE name IN ('result-artifacts', 'operational-evidence', 'task-photos')
ORDER BY name;
