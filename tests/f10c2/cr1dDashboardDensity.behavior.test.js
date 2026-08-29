/**
 * F10C2 CR1-D — dashboard density + login polish (items 1–8).
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  DASHBOARD_DENSITY_COMPACT,
  DASHBOARD_DENSITY_COMFORTABLE,
  DASHBOARD_DENSITY_STORAGE_KEY,
  normalizeDashboardDensity,
  persistDashboardDensity,
  readStoredDashboardDensity,
} from '../../src/lib/dashboardDensity.js'

const ROOT = process.cwd()
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

describe('f10c2 cr1-d — dashboard density and login (1-8)', () => {
  const appCss = read('src/App.css')
  const app = read('src/App.jsx')
  const dash = read('src/AdminDashboard.jsx')
  const fe = read('src/FEDashboard.jsx')

  it('1. density tokens exist and CSS never uses transform scale or document zoom', () => {
    expect(dash).toContain('--bd-density-sidebar')
    expect(dash).toContain('--bd-density-font-body')
    expect(dash).toContain('--bd-density-font-label')
    expect(appCss).toContain('--bd-density-font-body')
    expect(dash).not.toMatch(/transform:\s*scale\(/)
    const loginCss = appCss.slice(appCss.indexOf('.login-page'), appCss.indexOf('.admin-shell'))
    expect(loginCss).not.toMatch(/transform:\s*scale\(/)
    expect(dash).not.toContain('document.body.style.zoom')
    expect(fe).not.toContain('document.body.style.zoom')
  })

  it('2. Compact is the default desktop density and Comfortable is selectable', () => {
    expect(normalizeDashboardDensity(undefined)).toBe(DASHBOARD_DENSITY_COMPACT)
    expect(normalizeDashboardDensity('comfortable')).toBe(DASHBOARD_DENSITY_COMFORTABLE)
    expect(dash).toContain('data-bd-density={density}')
    expect(dash).toContain('density-toggle')
    expect(read('src/lib/dashboardDensity.js')).toContain('Comfortable')
    expect(fe).toContain('data-bd-density={density}')
  })

  it('3. density persists in localStorage and is not tenant business data', () => {
    expect(DASHBOARD_DENSITY_STORAGE_KEY).toBe('bd-dashboard-density')
    const store = {}
    globalThis.window = {
      localStorage: {
        getItem: (k) => store[k] ?? null,
        setItem: (k, v) => { store[k] = String(v) },
      },
    }
    persistDashboardDensity('comfortable')
    expect(store[DASHBOARD_DENSITY_STORAGE_KEY]).toBe('comfortable')
    expect(readStoredDashboardDensity()).toBe('comfortable')
    expect(dash).not.toContain('projects.density')
    expect(dash).not.toContain('tenant_density')
  })

  it('4. compact sidebar/header use density CSS variables instead of a 210px lock', () => {
    expect(dash).toContain('width: var(--bd-density-sidebar)')
    expect(dash).toContain('[data-bd-density="compact"]')
    expect(dash).toContain('[data-bd-density="comfortable"]')
    expect(dash).toContain('--bd-density-sidebar: 196px')
    expect(dash).toContain('--bd-density-sidebar: 240px')
  })

  it('5. compact body/label fonts stay readable (>=14px body, >=12px labels)', () => {
    expect(dash).toContain('--bd-density-font-body: 14px')
    expect(dash).toContain('--bd-density-font-label: 12px')
    expect(read('src/fieldResults/components/FieldResults.css')).toContain('font-size: 12px')
  })

  it('6. login page is a full-viewport background without a 1126px #root gutter', () => {
    expect(appCss).toContain('#root')
    expect(appCss).toContain('width: 100% !important')
    expect(appCss).toContain('max-width: none !important')
    expect(appCss).toContain('border-inline: none !important')
    expect(appCss).toContain('min-height: 100dvh')
    expect(appCss).toContain('place-items: center')
    expect(appCss).toContain('max-width: 420px')
    expect(appCss).toContain('min-width: min(380px')
    expect(read('src/index.css')).toContain('width: 1126px')
  })

  it('7. password is hidden by default and Show/Hide never defaults to Show', () => {
    expect(app).toContain('const [showPassword, setShowPassword] = useState(false)')
    expect(app).toContain('type={showPassword ? "text" : "password"}')
    expect(app).toContain('{showPassword ? "Hide" : "Show"}')
    expect(app).toContain('autoComplete="current-password"')
  })

  it('8. login light and dark backgrounds are coherent full-viewport gradients', () => {
    expect(appCss).toContain('radial-gradient(circle at top, #12345a, #07111f 55%)')
    expect(appCss).toContain('radial-gradient(circle at top, #dbeafe, #eef4ff 55%)')
    expect(app).toContain('className="login-page"')
    expect(app).toContain('className="login-card"')
    expect(app).toContain('sanitizeLoginError')
  })
})
