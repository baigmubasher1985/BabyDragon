# BabyDragon RF KPI Modular Split - Step 1F0

This step creates the RF KPI modular folder structure without changing field behavior.

Runtime path:
- `src/mobile/MobileRfKpi.jsx` is now a tiny wrapper.
- `src/mobile/rf/MobileRfKpiCore.jsx` contains the last stable Step 1E3 RF KPI runtime.

Prepared but not yet wired:
- `components/testcards/NativeHttpTestCard.jsx`
- `components/testcards/FtpTestCard.jsx`
- `components/testcards/IperfTestCard.jsx`
- `components/testcards/OoklaTestCard.jsx`
- `components/testcards/FccTestCard.jsx`
- `components/testcards/VoiceTestSetupCard.jsx`
- `config/dataTestConfig.js`

Acceptance:
1. `npm run build` passes.
2. RF KPI screen behaves the same as Step 1E3.
3. Export still saves CSV files.
4. Live RF/AVG continue updating.

No DB changes. No new permissions. No new test behavior in this step.
