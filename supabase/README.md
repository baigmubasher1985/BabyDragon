# supabase/ — Unapplied Security Scaffolding (F10C1I Phase 2)

**Status:** DRAFT / UNAPPLIED · **NO PROJECT LINK** · **NO SQL EXECUTED** · **NO EDGE DEPLOY**

## Layout

| Path | Purpose |
|------|---------|
| `config.example.toml` | Non-operational example — **no** project ref/secrets. Do **not** add active `config.toml` with project ref. |
| `drafts/forward/` | Phase 2 executable **draft** forward SQL (DO NOT RUN) |
| `drafts/rollback/` | Paired rollback drafts |
| `drafts/verification/` | SELECT-only verification drafts |
| `migrations/` | **README-only** — no executable migration SQL |
| `rollback/` / `verification/` | Legacy Phase 1 README placeholders (superseded by `drafts/`) |
| `functions/` | Undeployed Edge Function TypeScript |
| `tests/` | Disposable integration notes |
| `MIGRATION_MANIFEST.md` | Proposed ordering — no apply commands |

## Forbidden

- `supabase link` / `db push` / migration up / functions deploy / invoke  
- Creating `config.toml` with a project reference  
- Creating Storage buckets  
- Auth / Realtime mutations  
- F10C2 results schema  

## SECURITY DEFINER owner

**Unresolved** — `BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION`. See `docs/security/security-definer-owner-gate.md`.
