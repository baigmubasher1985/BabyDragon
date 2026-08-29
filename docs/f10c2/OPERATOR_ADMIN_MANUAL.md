# BabyDragon / NetField-360 — Operator and Admin Manual

**Owner:** MobbiTech Global LLC
**Canonical operational manual.** Technical contracts remain in the other `docs/f10c2/` files.
**Never paste passwords, tokens, or database URLs into this document or into chat.**

Last updated: 2026-08-28 (CR1-E)

---

## 1. Environment definitions

| Environment | What it is | Who uses it |
|-------------|------------|-------------|
| Local | Your computer running the web app. Mock data unless a live flag is set. | Developers |
| Disposable | Temporary validation database `babydragon-f10c2-disposable`. Evidence only. | Historical CR1 proof |
| Permanent development/staging | Durable, production-like database. **Not created until the owner names and authorizes it.** | All continued APK, dashboard, ingest, QC, and reporting work |
| Production | Live customer system. Isolated. Prefix denied in this program. | Authorized releases only |
| Customer-hosted / on-prem | Same product, customer’s PostgreSQL/Supabase and storage | After a reviewed deployment |

If someone asks you to “just use production for testing,” refuse.

## 2. Login and role behavior

- Open the web app. Enter email and password. Password is hidden; use **Show** only when you need to check what you typed.
- **Admin** and **super_admin** see the Admin Command Center (projects, Field Results, Acceptance Criteria, QC Review).
- **Field Engineer (FE)** sees My Routes / assigned work. FE does not get the admin Field Results navigator.
- Inactive accounts cannot work. Role checks in the browser are convenience only; the database still enforces permissions.
- Login credentials live in environment-variable **names** such as `F10C2_DISPOSABLE_ADMIN_EMAIL`. Never commit the values.

## 3. Admin navigation

Sidebar groups:

- **Dashboard Overview**
- **Project Management** — Create Project, Assign Task, Task Tracking, **Acceptance Criteria**
- **Route Management**
- **Field Operations** — Live FE Map, Task Timeline, FE Updates / Photos, **Field Results**
- **QC & Reports** — **QC Review**, Reports
- **User Management**
- **Logout**

Expand a group, then open the page. Density and Theme sit in the top bar (labeled **DENSITY** and **THEME**).

## 4. FE navigation and logout

- FE **Logout** stays visible in the top bar while you scroll.
- **Do not click Sync Now** unless a supervisor has authorized a real upload. A protected offline item must never be forced up.
- Pending Sync count is informational. Zero pending does not mean you should sync “just to check.”

## 5. Field Results workflow

1. Admin → Field Operations → **Field Results**.
2. Search by report, task, or grid. Filter by project, market, FE, scenario, dates.
3. Default columns: Report, Task / Grid, FE, Scenario, Started, Duration, Iterations, Upload, Acceptance, QC, View.
4. Open **View** for a result.
5. **Overview** shows the operational picture: verdicts, averages, GPS summary, downloadable artifacts.
6. **Advanced Technical Details** holds secondary identifiers and iteration rows. UUIDs belong here, not in the default table.
7. **Open in QC Review** carries the task/report into QC. You do not save QC from Field Results.
8. Missing evidence reads **N/A**, **Not collected**, **Not uploaded**, **Incomplete**, or **Unavailable** — never a fake zero.

Physical proof run currently used in validation:

- Report `F10C2-P4BU-E2E_Data_RF_Report_20260825_164751`
- Iteration 1 download 6.009 Mbps; average download 34.474 Mbps; average upload 53.565 Mbps
- GPS 44 valid / 0 invalid

Do not rewrite those historical numbers.

## 6. GPS driven-route behavior

- The map is the real driven route from the stored unified report, loaded through a short-lived signed download. It is not a decorative line.
- Expect a Start marker, sample counts, and Fit Route.
- Neighborhood-scale clusters can look small; that is a display issue, not missing data.
- If GPS was never collected, the page says so. It does not invent a track.

## 7. Acceptance Criteria

Admin → Project Management → **Acceptance Criteria**.

### Create a named rule

1. Enter a **Rule Name** and optional short description.
2. **Data Throughput**
   - Turn on **Require Download**. Enter minimum DL Mbps and required passing DL iterations.
   - Turn on **Require Upload**. Enter minimum UL Mbps and required passing UL iterations.
3. **Voice Calls**
   - Turn on **Require MO** and/or **Require MT**. Enter required successful calls.
4. Helpers explain the rule in plain language, for example: “DL passes when 20 completed iterations each reach at least 10 Mbps.”
5. Only **completed** iterations that meet the threshold count as passes. Missing evidence is Incomplete, not a fail-by-zero.
6. **Save Rule**. Completed historical results keep the rule that was in force when they finished.

### Assign to open tasks

- Each open task shows **Current Criteria** (the live resolver result).
- Choose a saved rule and **Change Assignment**. Confirm. The name in Current Criteria must match after a refresh.
- **Bulk assignment:** select several open tasks, choose one rule, **Assign to Selected**, confirm.
- A task-specific assignment beats project and tenant defaults. Historical snapshots stay immutable.
- Inactive rules do not appear for new assignments. Prefer **Deactivate** over delete so audit history remains readable.
- On disposable, SQL **216** (`set_acceptance_profile_active`, admin/super_admin SECURITY DEFINER) is applied. Deactivate persists after refresh. Do not use ad-hoc SQL to force status.
- Open tasks with an inactive assignment fall back to the next active criterion and show:
  - Assigned criterion: [rule name] — Inactive
  - Effective criterion: [fallback rule]
- Completed results keep their snapshotted rule. The synthetic open task `F10C2-P4BU-E2E` still has its unproven assignment row; effective criterion is **CR1-B disposable default**.

## 8. QC Review

- **Computed acceptance** (pass/fail/incomplete from the rule and the measurements) is separate from the **human QC decision**.
- Human decisions include Pass, Fail, Needs Re-drive, waiting states, missing evidence. Notes are required for Fail; a re-drive reason is required for Needs Re-drive.
- Evidence stays linked to the original task. Re-drive does not erase the original result.
- QC is never auto-passed just because an upload finished.

## 9. Day / Night theme

Use **THEME** in the admin top bar. Day and Night must remain readable on login, Field Results, Acceptance Criteria, and QC. If a page stays stuck dark in Day mode, log it in the UI backlog — do not assume it is fixed without checking the real app.

## 10. Compact / Comfortable density

Use **DENSITY**. Compact is the desktop default (narrower sidebar, 14px body). Comfortable is wider. The choice is stored on this browser only. At 1366px the Field Results table may scroll sideways; that is tracked, not a reason to invent CSS zoom.

## 11. Artifact downloads and short-lived URLs

- Downloads use short-lived signed URLs. Do not bookmark them as permanent links.
- Slots that were never uploaded say **Not downloadable**.
- Durable identity is bucket + object key, never a public URL saved as the file.

## 12. Missing data

Display **N/A**, **Incomplete**, **Not collected**, **Not uploaded**, **Processing**, or **Unavailable due to [reason]**. Never render missing throughput, RF, or GPS as `0`.

## 13. Offline queue protection and Sync Now

- The device can hold failed or protected upload items.
- **Protected queue id `bd-rf-1787606300946` must never be uploaded.**
- Do not click **Sync Now** during validation unless a written authorization says so.
- Do not clear the queue to “clean up.”

## 14. Environment configuration (names only)

Copy `.env.disposable.example` → `.env.disposable` (gitignored) for disposable proof.
Copy `.env.permanent-staging.example` → `.env.permanent-staging` (gitignored) when a staging project exists.

Typical **names** (values stay in the local ignored file):

- `F10C2_DISPOSABLE_PROJECT_NAME`, `F10C2_DISPOSABLE_PROJECT_REF`, `F10C2_DISPOSABLE_CONFIRMED`
- `F10C2_DISPOSABLE_ADMIN_EMAIL`, `F10C2_DISPOSABLE_ADMIN_PASSWORD`
- `F10C2_DISPOSABLE_FE_EMAIL`, `F10C2_DISPOSABLE_FE_PASSWORD`
- `VITE_F10C2_FIELD_RESULTS_PROVIDER`, `VITE_F10C2_SERVER_SUBMIT_ENABLED`
- Permanent staging canonical names: `BABYDRAGON_STAGING_PROJECT_NAME`, `BABYDRAGON_STAGING_PROJECT_REF`, `BABYDRAGON_STAGING_SUPABASE_URL`, `BABYDRAGON_STAGING_ANON_KEY`, `BABYDRAGON_STAGING_SERVICE_ROLE_KEY`, `BABYDRAGON_STAGING_DATABASE_URL`, `BABYDRAGON_STAGING_DB_PASSWORD`, `BABYDRAGON_STAGING_ADMIN_EMAIL`, `BABYDRAGON_STAGING_ADMIN_PASSWORD`, `BABYDRAGON_STAGING_FE_EMAIL`, `BABYDRAGON_STAGING_FE_PASSWORD`
- Compatible cutover-gate aliases remain in `.env.permanent-staging.example` (`F10C2_PERMANENT_STAGING_*`)

Never put service-role keys in `VITE_` variables. Never point disposable or staging variables at production.

## 15. Permanent staging deployment procedure

1. Owner supplies environment name, project name, project ref, confirmation it is staging not production, connection method, variable names, and explicit migration authorization.
2. Follow [permanent-staging/CUTOVER_PACKAGE.md](./permanent-staging/CUTOVER_PACKAGE.md). Do not copy the disposable database blindly.
3. Apply canonical bootstrap + ordered migrations + seed (tenant + initial super_admin + optional admin only).
4. Run verification SQL and contract tests.
5. Re-upload selected physical packages only if the owner decides to.

If those identities are missing, stop. Do not create a project yourself.

## 16. Production deployment authorization gate

Production is unauthorized in this task and remains denied. A future production window requires:

- the same canonical migrations already proven on permanent staging
- a reviewed application release
- approved configuration
- explicit owner authorization

No synthetic users, projects, tasks, or E2E rules in production.

## 17. Rollback and recovery overview

- Each numbered draft has a rollback partner under `supabase/drafts/`.
- Roll back in reverse order. Do not drop unrelated databases.
- Immutable acceptance snapshots must not be rewritten to “undo” a rule change.
- Permanent staging may be reset only through an authorized recovery process, not ad-hoc deletes.

## 18. Customer-hosted deployment direction

Customers can host PostgreSQL/Supabase and choose artifact storage, but they must receive:

- the same bootstrap
- the same ordered migrations
- the same RLS/RPC grants
- the same verification suite

Do not ship a special one-off schema per customer.
