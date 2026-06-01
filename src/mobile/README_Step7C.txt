BabyDragon Mobile UX Cleanup Step 7C
Unified Issue / Evidence Capture

Replace these files inside src/mobile:

1. MobileApp.jsx
2. MobileTaskDetails.jsx
3. MobileIssueReport.jsx
4. MobileRouteView.jsx
5. mobile.css

MobileNotesEvidence.jsx is included for safety/backward reference, but MobileTaskDetails no longer renders it separately.

What changed:
- Issue Reporting and Notes/Photo Evidence are now one unified panel.
- FE can submit issue type, severity, comment, photo evidence, and GPS coordinates together.
- Added two evidence buttons:
  - Add Picture
  - Take Picture
- Coordinates are captured automatically during submit.
- Photo evidence is saved into task_updates and linked with the issue text.
- Offline queue still supports issue reports and photo evidence.
- Route issue reports now allow On-Hold tasks too.

After replacing files:
npm run build
npx cap sync android
Then Run from Android Studio.
