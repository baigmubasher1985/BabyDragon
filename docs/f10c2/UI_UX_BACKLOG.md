# BabyDragon / NetField-360 — UI/UX backlog

**Canonical backlog.** Do not spread issues across competing files.
**Do not mark a screenshot issue fixed unless the live app proves it.**

Last reviewed: 2026-08-28 (CR1-E). Evidence roots:

- `Audit Data/F10C2/CR1-D/`
- `Audit Data/F10C2/CR1-D-R1/F10C2_CR1DR1_Final_Report.txt`
- `Audit Data/F10C2/CR1-D-R2/`
- `Audit Data/F10C2/CR1-E/` (live 2026-08-28 preview `http://127.0.0.1:4183/`)

Severity: **Core blocker** · **Important before launch** · **Cosmetic** · **Future enhancement**

| ID | Page | Screenshot / evidence | Problem | Expected | Severity | Status | Dependencies | Validation |
|----|------|----------------------|---------|----------|----------|--------|--------------|------------|
| UX-01 | Acceptance Criteria | CR1-E `13_after_refresh.json`, `14_deactivate_result.json` | Previously: Deactivate did not persist (SELECT-only RLS). | Inactive rules persist as Inactive and drop out of assignment lists. | Core blocker | **Closed on disposable** after 216 + Admin UI | `set_acceptance_profile_active` applied | **CR1-D-R2 E2E Data Rule** Inactive; not selectable; `F10C2-P4BU-E2E` shows assigned inactive + effective **CR1-B disposable default** |
| UX-02 | Acceptance Criteria | CR1-D `29_acceptance_criteria.json`; CR1-D-R1 report | Operators still see synthetic/developer names (CR1-B disposable default, CR1-D synth project …). | Operator-facing library uses customer language; lab names stay in Advanced/Technical. | Important before launch | Open | Copy + optional rename UX that does not rewrite snapshots | Admin walkthrough with a non-engineer |
| UX-03 | Acceptance Criteria | CR1-D `29_acceptance_criteria.json` CREATED/UPDATED ISO timestamps; live Technical Details | Long technical timestamps and JSON-era leftovers in operator view. | Human dates; JSON only behind Technical Details. | Cosmetic | Open | CR1-D-R1 simple-rule shell (partially done) | Open Acceptance Criteria Day+Night |
| UX-04 | Acceptance Criteria | CR1-E `01_tasks_before.json` vendor `SYNTHETIC`; empty-state copy in tests | Vendor / Task / Grid can read as lab placeholders or em-dash without saying why. | Persisted names or a clear “Not set”, never a blank that looks like a bug. | Important before launch | Open | Task/project master data | Open-task table + Field Results overview |
| UX-05 | Acceptance Criteria | CR1-D-R2 `05_criteria_form.json`; live Saved Rules table | Saved Rules and open-task tables are dense; action buttons compete with Edit/Deactivate. | Consistent button alignment, spacing, and wrapping at 1366 Compact. | Cosmetic | Open | Header/table density tokens | 1366 / 1440 / 1920 Compact+Comfortable |
| UX-06 | Field Results list | CR1-D final review §4 item 7; `26_field_results_list.json` | 11-column table can horizontal-scroll at 1366. | All default columns readable without hunting, or an intentional compact column set. | Important before launch | Open | Column priority | 1366 Compact 100% zoom |
| UX-07 | Field Results detail | CR1-D remaining issues; `formatMetric` “unavailable” | Some RF/iteration cells say “unavailable” instead of N/A / Incomplete. | One missing-data vocabulary (manual §12). | Important before launch | Open | `fieldSectionEmptyCopy` | iPerf + HTTP + synthetic empty result |
| UX-08 | Field Results overview | CR1-D `27_gps_route_iperf.json`; CR1-D-R1 GPS polish | GPS cluster (~31.2 m) looks tiny at neighborhood zoom. | Route remains findable; Fit Route obvious. | Cosmetic | Open | Map bounds | Physical iPerf GPS 44/0 |
| UX-09 | Field Results | CR1-D `27_gps_route_iperf.json` TASK `—`; CR1-D overview UUID hide | Task/grid still empty or UUID-shaped on some records. | Human task/grid in Overview; ids in Advanced. | Important before launch | Partial (UUID hide in CR1-D) | Run identity mapping | Physical iPerf + HTTP details |
| UX-10 | Field Results downloads | CR1-D §6 items 12–13 | Mix of Secure download vs Not downloadable; operators may think files are missing when slots were never produced. | Slot state in plain language; no dead buttons. | Important before launch | Open | Artifact slot model | HTTP + iPerf artifact rows |
| UX-11 | QC Review | CR1-D `30_qc_review.json`; CR1-C-R1 nav | QC still reads “QC Review V1”, technical filters, and lab project names. Computed vs human decision can be missed. | QC is an operations page: computed acceptance distinct from human decision, notes, evidence, re-drive. | Important before launch | Open | CR1-D Open-in-QC context (done) | Open in QC Review from iPerf detail |
| UX-12 | Admin dashboard | CR1-D `21–25` compact shots; CR1-D-R2 `01_header_metrics.json` | Visual consistency: leftover developer kickers, mixed card density, Night/Day drift on pages not yet on semantic tokens. | Same tokens on Admin, FE, Field Results, Acceptance, QC, login. | Important before launch | Partial (CR1-D-R1 theme tokens) | `semanticTheme.css` | Toggle Day/Night on every admin group |
| UX-13 | Login | CR1-D `20_final_login_layout.json`; CR1-C-R1 `01_login_layout.json` | Login is a full-viewport 410px card in later proof; earlier 400px capture. Cosmetics (subtitle, spacing) still look template-like. | One coherent branded login at 1366–1920. | Cosmetic | Partial | `App.css` login | 1366 login screenshot vs live |
| UX-14 | Day/Night all pages | CR1-D-R1 report §1; CR1-D-R2 header night shots | Field Results/Acceptance used to stay navy in Day mode. R1 semantic tokens claimed a fix; not every page was re-proven in CR1-E. | Every page follows Day/Night without unreadable contrast. | Important before launch | Needs live re-proof | Theme class on `html`/`body` | Walk login, dashboard, FR, AC, QC, FE in both themes |
| UX-15 | Compact/Comfortable | CR1-D-R2 overlapping header (fixed); CR1-D tablet `31_tablet_stack.json` | Header overlap was fixed in R2. Tablet 768 stacks sidebar full width. Comfortable truncation was fixed; narrow wrap still needs watching. | Density controls never overlap; tablet usable. | Important before launch | Partial (desktop header PASS in R2) | `.admin-topbar-actions` | 1366/1440/1920 + 768×1024 |
| UX-16 | Mobile / tablet admin | CR1-D `31_tablet_stack.json` | Admin shell becomes a stacked block; Field Results and assignment tables are desktop-first. | Defined tablet behavior (or an honest “desktop required” message). | Important before launch | Open | Responsive IA | 768×1024 Admin FR + AC |
| UX-17 | FE dashboard | CR1-D `32_fe_logout.json`; CR1-C-R1 FE scroll | Logout sticky PASS. Sync Now remains easy to click by mistake. FE maps/routes cosmetics not fully inventoried in CR1-D-R2. | Logout always reachable; Sync Now requires confirmation; FE maps follow Day/Night. | Important before launch | Partial | Queue protection copy | FE login, scroll, do **not** click Sync Now |
| UX-18 | Missing functions from screenshots | CR1-D Acceptance still showed Clone/JSON before R1; live CR1-E still has no Clear Assignment | Operators cannot return a task to “no task-specific rule” without assigning another named rule. | Clear / inherit-default action, or documented equivalent. | Important before launch | Open | UX-01 privileged profile writes | Restore tenant fallback without creating a new task assignment |
| UX-19 | Reports | CR1-D nav Reports item; no CR1-D deep review | Reports page was not a CR1-D-R2 gate. Do not claim it is launch-ready. | Reports matches Field Results visual language and uses short-lived downloads. | Future enhancement | Open | Report pipeline | Open Reports after FR |
| UX-20 | Live FE Map / Task Timeline / Photos | CR1-D nav only | Adjacent Field Operations pages were not re-styled to the CR1-D Field Results language. | Same theme, density, and empty-state rules. | Cosmetic | Open | semantic tokens | Open each Field Operations item Day+Night |

Notes:

- CR1-D-R2 header overlap and Comfortable truncation are **not** listed as open; live R2 metrics recorded overlap=false, truncated=false. Re-check after any top-bar CSS change.
- Physical iPerf 6.009 / 34.474 / 53.565 and GPS 44/0 are **not** defects.
- Synthetic labels on disposable data are expected in the lab database; they become launch issues if they ship in operator UI on permanent staging/production.
- UX-01: SQL **216** applied on disposable. **CR1-D-R2 E2E Data Rule** is Inactive after Admin UI Deactivate. Open-task fallback shows **CR1-B disposable default**.
