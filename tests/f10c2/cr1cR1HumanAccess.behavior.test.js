/**
 * F10C2 CR1-C-R1 — FE logout, login polish, truthful FE map empty-state.
 * 19 focused items. No live disposable traffic. Source + pure helpers only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { sanitizeLoginError, LOGIN_ERROR_FALLBACK } from '../../src/auth/sanitizeLoginError.js'
import {
  FE_MAP_NO_GEOMETRY_COPY,
  FE_MAP_NO_ROUTE_COPY,
  FE_MAP_TILES_UNAVAILABLE,
  canFitValidBounds,
  countRouteLineFeatures,
  hasValidGridGeometry,
  hasValidRouteGeometry,
  resolveFeMapRenderState,
} from '../../src/components/maps/feMapRenderState.js'
import { computeTaskLevelQcOutcome, TASK_FAIL_REASONS } from '../../src/fieldResults/qc/taskLevelQcOutcome.js'

const ROOT = process.cwd()

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

const GRID = {
  type: 'Polygon',
  coordinates: [
    [
      [-96.8, 32.7],
      [-96.7, 32.7],
      [-96.7, 32.8],
      [-96.8, 32.8],
      [-96.8, 32.7],
    ],
  ],
}

const ROUTE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [-96.8, 32.7],
          [-96.75, 32.75],
          [-96.7, 32.8],
        ],
      },
    },
  ],
}

describe('f10c2 cr1-c-r1 — 19 human-access items', () => {
  const app = read('src/App.jsx')
  const appCss = read('src/App.css')
  const fe = read('src/FEDashboard.jsx')
  const routes = read('src/pages/FERoutes.jsx')
  const mobileMap = read('src/mobile/MobileRouteView.jsx')
  const dash = read('src/AdminDashboard.jsx')

  it('1. FE Logout is visible in the persistent desktop FE header', () => {
    expect(fe).toContain('className="fe-topbar"')
    expect(fe).toContain('className="fe-logout-btn"')
    expect(fe).toContain('Logout')
    expect(fe).toContain('aria-label="Logout"')
    expect(fe).toContain('onClick={onLogout}')
  })

  it('2. Logout stays in the header for My Tasks and My Routes', () => {
    const headerAt = fe.indexOf('className="fe-topbar"')
    const tasksAt = fe.indexOf('My Tasks')
    const routesAt = fe.indexOf('My Routes')
    expect(headerAt).toBeGreaterThan(-1)
    expect(headerAt).toBeLessThan(tasksAt)
    expect(headerAt).toBeLessThan(routesAt)
    expect(fe).toContain('activeTab === "tasks"')
    expect(fe).toContain('activeTab === "routes"')
    expect(fe).toContain('<FERoutes />')
  })

  it('3. FE header is sticky so Logout remains reachable after scroll', () => {
    expect(fe).toContain('position: sticky')
    expect(fe).toContain('z-index: 50')
    expect(fe).toContain('.fe-topbar')
    expect(fe).toContain('.fe-logout-btn')
  })

  it('4. Logout calls centralized signOut once and does not add a competing FE signOut', () => {
    expect(app).toContain('await supabase.auth.signOut()')
    expect(app.split('supabase.auth.signOut()').length - 1).toBe(1)
    expect(fe).not.toContain('supabase.auth.signOut')
    expect(fe).toContain('onClick={onLogout}')
    expect(app).toContain('clearCachedAuth()')
  })

  it('5. Logout preserves offline queue and does not sync or clear field storage', () => {
    const logoutFn = app.slice(app.indexOf('async function handleLogout()'), app.indexOf('if (!user)'))
    expect(logoutFn).toContain('supabase.auth.signOut()')
    expect(logoutFn).not.toContain('syncOfflineQueue')
    expect(logoutFn).not.toContain('Sync Now')
    expect(logoutFn).not.toContain('localStorage.clear')
    expect(logoutFn).not.toContain('indexedDB')
    expect(logoutFn).not.toContain('syncPendingOfflineActions')
    expect(fe).toContain('Pending Sync:')
    expect(fe).toContain('syncPendingOfflineActions')
  })

  it('6. Browser Back after logout is guarded against restoring protected FE content', () => {
    expect(app).toContain('popstate')
    expect(app).toContain('pageshow')
    expect(app).toContain('rejectStaleAuthenticatedView')
    expect(app).toContain('history.replaceState')
    expect(app).toContain('babydragonAuth')
  })

  it('7. Login layout has centered card, labels, and logo → title → subtitle order', () => {
    expect(app).toContain('className="login-page"')
    expect(app).toContain('className="login-card"')
    expect(app).toContain('className="login-logo"')
    expect(app).toContain('BabyDragon')
    expect(app).toContain('RF Drive Test Management Platform')
    expect(app).toContain('htmlFor="bd-login-email"')
    expect(app).toContain('htmlFor="bd-login-password"')
    expect(app).toContain('>Email</label>')
    expect(app).toContain('>Password</label>')
    expect(appCss).toContain('place-items: center')
    expect(appCss).toContain('max-width: 420px')
    const logoAt = app.indexOf('className="login-logo"')
    const titleAt = app.indexOf('<h1>BabyDragon</h1>')
    const subtitleAt = app.indexOf('RF Drive Test Management Platform')
    const emailAt = app.indexOf('htmlFor="bd-login-email"')
    const passwordAt = app.indexOf('htmlFor="bd-login-password"')
    const submitAt = app.indexOf('className="login-submit"')
    expect(logoAt).toBeLessThan(titleAt)
    expect(titleAt).toBeLessThan(subtitleAt)
    expect(subtitleAt).toBeLessThan(emailAt)
    expect(emailAt).toBeLessThan(passwordAt)
    expect(passwordAt).toBeLessThan(submitAt)
  })

  it('8. Login loading/disabled and sanitized error states exist', () => {
    expect(app).toContain('loginBusy')
    expect(app).toContain('Signing in...')
    expect(app).toContain('disabled={loginBusy}')
    expect(app).toContain('sanitizeLoginError')
    expect(app).toContain('className="login-error"')
    expect(sanitizeLoginError({ message: 'Invalid login credentials' })).toBe('Invalid email or password.')
    expect(sanitizeLoginError({ message: 'Email not confirmed' })).toBe(
      'This account is inactive. Contact an administrator.'
    )
    expect(sanitizeLoginError({ message: 'Failed to fetch' })).toBe(
      'Network error. Check your connection and try again.'
    )
    expect(sanitizeLoginError({ message: 'No role found for this user.' })).toBe(
      'This account is not authorized for BabyDragon.'
    )
    expect(app).not.toContain('alert(error.message)')
  })

  it('9. Login never renders raw Supabase/JWT/internal auth details', () => {
    expect(sanitizeLoginError({ message: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb' })).toBe(
      LOGIN_ERROR_FALLBACK
    )
    expect(sanitizeLoginError({ message: 'JWT expired at supabase.co/auth/v1' })).toBe(LOGIN_ERROR_FALLBACK)
    expect(app).not.toContain('error.message}')
    expect(read('src/mobile/MobileApp.jsx')).toContain('sanitizeLoginError')
  })

  it('10. Map with valid route geometry renders the route map mode', () => {
    expect(hasValidRouteGeometry(ROUTE)).toBe(true)
    const state = resolveFeMapRenderState({
      selected: true,
      hasRouteGeometry: true,
      hasGridGeometry: true,
      hasNavigationDestination: true,
      tilesFailed: false,
      gridLabel: 'JOS-001',
      gridId: 'grid-1',
    })
    expect(state.mode).toBe('route_map')
    expect(state.showMap).toBe(true)
    expect(state.drawRoute).toBe(true)
    expect(state.drawGrid).toBe(true)
    expect(state.fitBounds).toBe(true)
    expect(state.routeCount).toBe(1)
    expect(routes).toContain('bd-fe-basemap')
    expect(routes).toContain('MapInvalidateSize')
  })

  it('11. Grid without route uses the truthful empty-state copy', () => {
    expect(hasValidGridGeometry(GRID)).toBe(true)
    const state = resolveFeMapRenderState({
      selected: true,
      hasRouteGeometry: false,
      hasGridGeometry: true,
      hasNavigationDestination: true,
      tilesFailed: false,
      gridLabel: 'JOS-001',
      gridId: 'grid-1',
    })
    expect(state.mode).toBe('grid_only_empty')
    expect(state.showMap).toBe(false)
    expect(state.drawRoute).toBe(false)
    expect(state.routeCount).toBe(0)
    expect(state.emptyMessage).toBe(FE_MAP_NO_ROUTE_COPY)
    expect(state.showNavigate).toBe(true)
    expect(state.showViewGridBoundary).toBe(true)
    expect(routes).toContain('FE_MAP_NO_ROUTE_COPY')
    expect(mobileMap).toContain('FE_MAP_NO_ROUTE_COPY')
    expect(read('src/components/maps/feMapRenderState.js')).toContain('No route has been created for this assigned grid.')
  })

  it('12. No-geometry assigned grid does not render a map', () => {
    const state = resolveFeMapRenderState({
      selected: true,
      hasRouteGeometry: false,
      hasGridGeometry: false,
      hasNavigationDestination: false,
    })
    expect(state.mode).toBe('no_geometry')
    expect(state.showMap).toBe(false)
    expect(state.emptyMessage).toBe(FE_MAP_NO_GEOMETRY_COPY)
    expect(hasValidGridGeometry(null)).toBe(false)
    expect(hasValidRouteGeometry(null)).toBe(false)
  })

  it('13. Tile failure hides the map and keeps metadata + retry', () => {
    const state = resolveFeMapRenderState({
      selected: true,
      hasRouteGeometry: true,
      hasGridGeometry: true,
      tilesFailed: true,
      gridLabel: 'JOS-001',
      gridId: 'grid-1',
    })
    expect(state.mode).toBe('tile_failure')
    expect(state.showMap).toBe(false)
    expect(state.emptyMessage).toBe(FE_MAP_TILES_UNAVAILABLE)
    expect(state.showRetry).toBe(true)
    expect(state.routeCount).toBe(1)
    expect(routes).toContain('Retry Map')
    expect(routes).toContain('TileLoadGuard')
  })

  it('14. Retry Map remounts the basemap after tile failure', () => {
    expect(routes).toContain('setTileRetryKey')
    expect(routes).toContain('Retry Map')
    expect(mobileMap).toContain('Retry Map')
    expect(read('src/components/maps/BasemapTileGuard.jsx')).toContain('tileerror')
    expect(read('src/components/maps/BasemapTileGuard.jsx')).toContain('tileload')
  })

  it('15. Fit bounds only runs when valid geometry exists', () => {
    expect(canFitValidBounds([])).toBe(false)
    expect(canFitValidBounds([null])).toBe(false)
    expect(canFitValidBounds([GRID])).toBe(true)
    expect(routes).toContain('bounds.isValid()')
    expect(routes).toContain('map.fitBounds')
    expect(mobileMap).toContain('bounds.isValid()')
  })

  it('16. Grid-only empty state never invents a route line or route count', () => {
    expect(countRouteLineFeatures(ROUTE)).toBe(1)
    expect(countRouteLineFeatures(null)).toBe(0)
    const viewed = resolveFeMapRenderState({
      selected: true,
      hasRouteGeometry: false,
      hasGridGeometry: true,
      viewGridBoundary: true,
    })
    expect(viewed.mode).toBe('grid_boundary_map')
    expect(viewed.drawRoute).toBe(false)
    expect(viewed.routeCount).toBe(0)
    expect(routes).toContain('mapRenderState.drawRoute')
    expect(mobileMap).toContain('mapRenderState.drawRoute')
  })

  it('17. Login and FE logout keep contrast in light and dark themes', () => {
    expect(appCss).toContain('@media (prefers-color-scheme: light)')
    expect(appCss).toContain('.login-field label')
    expect(appCss).toContain('.login-error')
    expect(fe).toContain('.fe-page.theme-day .fe-logout-btn')
    expect(fe).toContain('linear-gradient(135deg, #dc2626, #f97316)')
    expect(fe).toContain('theme-${themeMode}')
  })

  it('18. CR1-C Field Results remains under Field Operations, not QC & Reports', () => {
    const ops = dash.indexOf('title: "Field Operations"')
    const qc = dash.indexOf('title: "QC & Reports"')
    const field = dash.indexOf('{ id: "fieldResults"')
    expect(field).toBeGreaterThan(ops)
    expect(field).toBeLessThan(qc)
    expect(dash.split('{ id: "fieldResults"').length - 1).toBe(1)
    expect(read('src/fieldResults/components/FieldResultsPage.jsx')).toContain('Field Operations')
  })

  it('19. Existing task-level QC PASS/FAIL behavior remains fail-closed', () => {
    const pass = computeTaskLevelQcOutcome({
      task: { id: 'task-e2e', name: 'F10C2-P4BU-E2E' },
      project: { name: 'F10C2-P4BU-E2E' },
      runs: [
        { id: 'http', task_id: 'task-e2e', scenario_type: 'native_http', acceptance_verdict: 'PASS', upload_state: 'uploaded', processing_state: 'ready' },
        { id: 'iperf', task_id: 'task-e2e', scenario_type: 'iperf3', acceptance_verdict: 'PASS', upload_state: 'uploaded', processing_state: 'ready' },
      ],
    })
    expect(pass.computed).toBe('PASS')
    const fail = computeTaskLevelQcOutcome({
      task: { id: 'task-e2e', name: 'F10C2-P4BU-E2E' },
      project: { name: 'F10C2-P4BU-E2E' },
      runs: [
        { id: 'http', task_id: 'task-e2e', scenario_type: 'native_http', acceptance_verdict: 'PASS', upload_state: 'uploaded', processing_state: 'ready' },
        { id: 'iperf', task_id: 'task-e2e', scenario_type: 'iperf3', acceptance_verdict: 'FAIL', upload_state: 'uploaded', processing_state: 'ready' },
      ],
    })
    expect(fail.computed).toBe('FAIL')
    expect(fail.reason).toBe(TASK_FAIL_REASONS.THRESHOLD_FAILURE)
    const missing = computeTaskLevelQcOutcome({
      task: { id: 't1', name: 'Unknown task' },
      project: { name: 'Unknown' },
      runs: [],
    })
    expect(missing.computed).toBe('FAIL')
    expect(missing.reason).toBe(TASK_FAIL_REASONS.MISSING_REQUIRED)
  })
})
