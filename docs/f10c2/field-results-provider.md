# Field Results Provider Boundary (F10C2 Phase 3)

## Interface

`createFieldResultsRepository()` / `getFieldResultsRepository()` expose:

| Operation | Purpose |
|-----------|---------|
| `listFieldResults(filters, pagination)` | Filtered, sorted, paginated list |
| `getFieldResult(resultId)` | Detail view model |
| `listResultArtifacts(resultId)` | Artifact descriptors |
| `getResultQcHistory(resultId)` | Append-style history |
| `saveResultQcDecision(resultId, decision, actor)` | Validated QC write (mock) |
| `createOrLinkRedrive(resultId, reason, actor)` | Re-drive linkage (mock) |
| `requestArtifactAccess(resultId, artifactId, actor)` | Mock access — no signed URLs |

Components **must not** query `field_test_*` tables directly.

## Phase 3 implementation

- Kind: **`mock`** only (`mockFieldResultsProvider.js`).
- Deterministic fixtures in `fieldResultsFixtures.js`.
- Loading / empty / error / retry / success statuses returned to UI.
- No `fetch`, no Supabase client, no service-role, no production URL.

## Future Supabase provider

Replace behind the same factory without rewriting page components. Requires separately authorized:

- Disposable/live schema apply (101–111),
- RLS proof,
- private `result-artifacts` bucket,
- ephemeral signed URL mint (never durable).

## Artifact-access boundary

- Provider returns mock descriptor + notice.
- `public_url` / `signed_url` always null in Phase 3.
- Missing / non-uploaded artifacts are not downloadable.
