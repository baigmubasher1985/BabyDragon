# Field Results Dashboard (F10C2 Phase 3)

**Operator manual (login, roles, Field Results, GPS, Acceptance Criteria, QC, theme, density, deployment):** [OPERATOR_ADMIN_MANUAL.md](./OPERATOR_ADMIN_MANUAL.md). This file remains the Field Results information-architecture note.

**Status:** Live disposable dashboard exists under Field Operations when `VITE_F10C2_FIELD_RESULTS_PROVIDER=supabase`. Mock remains the source default.
**Production is not a valid target.**

## Information architecture

| Surface | Role | Notes |
|---------|------|-------|
| Admin → QC & Reports → **Field Results** | admin / super_admin | List + detail + QC workspace |
| QC Review V1 → Open Field Results | admin | Additive link; task QC unchanged |
| FE Dashboard | fe | **No** Field Results admin nav |

## Views

1. **List** — filters, search, sort, pagination, badges; summarized RF/data only (no raw traces).
2. **Detail tabs** — Overview, Test Summary, RF, GPS/Route, Events, Scenario Details, Artifacts, QC Workspace.
3. **QC Workspace** — human decisions, notes, missing evidence, re-drive link, append-only history.

## Scenario labels

Native HTTP · FTP · iPerf3 · OOKLA · FCC · RF Only

## Compatibility

Preserves Login, Admin/FE dashboards, My Tasks, Projects, Grids, Routes, Cell files, task updates, checklist, issues, QC Review V1, task-level `qc_reviews`, mobile RF/exports, Phase 2 Sync-tab upload UX, offline queues, `task-photos`.

## Performance

- Summarized fixtures only (no full RF/GPS traces in React state).
- Paginated list.
- No new charting dependency.
- Bounded event timelines.

## Known limitations

- Mock provider only; future Supabase provider not implemented.
- Artifact “Mock access” is development UX — not Storage signed URLs.
- Client role checks are UX only; Phase 1 RLS/RPC mandatory before production.
