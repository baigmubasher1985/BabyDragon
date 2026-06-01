BabyDragon Mobile UX Cleanup Step 7D
Clean Stats + Route Geometry Fix

Replace these files in:
C:\Users\Mubasher\Desktop\Mubasher\BabyDragon\babydragon\src\mobile

Files:
- MobileSyncStatus.jsx
- MobileRouteView.jsx
- mobile.css

What changed:
1. Removed duplicate top Assigned/In-Progress/On-Hold/Completed count block from My Tasks.
2. Kept the cleaner task status cards lower on the My Tasks page.
3. Routes tab now uses more robust route lookup by grid id, grid code, grid name, target name, and route-grid links.
4. Route geometry parser now normalizes route coordinates before drawing, which helps when routes are stored as lat/lng instead of lng/lat.
5. Route line is drawn stronger with a dark under-line and bright cyan route line.
6. Route page text is simplified and the map is slightly taller.

After replacing:
npm run build
npx cap sync android

Then run from Android Studio.
