# F10C2 Phase 4A — Multi-tenant storage architecture

**Status:** Local contracts and drafts only. **No database or production action.**  
**No real Supabase apply, Storage mutation, or Kubernetes deploy.**

BabyDragon is cloud-first and **storage-neutral**. One codebase supports four deployment modes.

## Deployment modes

| Mode | Application / API | Metadata | Raw artifacts |
|------|-------------------|----------|---------------|
| MobbiTech SaaS | MobbiTech cloud | MobbiTech | MobbiTech private storage |
| Hybrid customer storage | MobbiTech cloud | Full or minimized by policy | Customer-controlled storage |
| Customer-hosted data plane | Customer API/worker | Customer DB | Customer storage; raw evidence stays inside customer infrastructure |
| Fully private / on-prem | Customer Kubernetes/containers | Customer | Customer; no mandatory operational exchange with MobbiTech |

## Control plane vs data plane

**Control plane:** tenant configuration, licensing, feature flags, storage-connector configuration, deployment configuration, non-sensitive health.

**Customer data plane:** tasks, field-test sessions, RF/GPS, data-test results, logs/reports, screenshots, QC decisions, re-drive records.

A tenant policy decides whether metadata, normalized summaries, or raw evidence may leave the customer environment.

## ArtifactStorageProvider

Canonical workflow talks only to `src/storage` (`createUploadPlan`, `confirmUpload`, `createAuthorizedReadAccess`, …). It does not import S3, Graph, Drive, or permanent public URLs.

| Provider | Phase 4A status |
|----------|-----------------|
| `mock` | Full deterministic implementation |
| `supabase` | Reference implementation (session JWT, `upsert: false`, `createSignedUrl`, no `getPublicUrl`) |
| S3 / MinIO / Azure / HTTPS / SFTP / OneDrive / SharePoint / Drive / local FS | Fail-closed stubs |

Durable identity is `object_key` + optional `provider_object_id`. Signed URLs are short-lived access only.

## Mobile upload plan

1. APK authenticates with the configured API.  
2. APK submits a validated manifest and stable idempotency key.  
3. Server evaluates tenant storage policy.  
4. Server returns a short-lived upload plan (no connector secrets).  
5. APK uploads with scoped authorization.  
6. APK reports object identity, size, and checksum.  
7. Server verifies package completeness.  
8. The existing `field_test_result_submit` queue reaches uploaded only after required artifacts confirm.

The APK never embeds service-role, S3, Azure, Graph, Google, SFTP, or database secrets.

## Dashboard / QC

Field Results still consume logical artifact records through the repository. Authorized download is requested at open time. Missing evidence stays missing. QC and re-drive do not depend on the storage provider.

## Schema drafts

Unapplied drafts live in `supabase/drafts/f10c2/phase4a/` (201–207). They are **not** in the Phase 4 disposable apply list. Tenant columns are **nullable**. 207 is documentation-only RLS assumptions.

Phase 4A-R1 adds same-tenant composite foreign keys, RESTRICT tenant deletion, persisted artifact-type policy selection, bound idempotency, and destination buckets derived from the storage connection. The `secret_reference` regex CHECK is defense-in-depth only.

## Customer worker

`src/processing/customerWorkerContract.js` is the Phase 4A boundary. Full worker implementation is Phase 4D. Customer-worker mode must not transfer raw evidence to MobbiTech.
