/**
 * Load .env.disposable (never prints values). Does not load the app .env for apply.
 */
import fs from 'node:fs'
import path from 'node:path'

export function parseEnvFile(filePath) {
  const out = {}
  if (!fs.existsSync(filePath)) return out
  const text = fs.readFileSync(filePath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

export function loadDisposableEnv(cwd = process.cwd()) {
  const filePath = path.join(cwd, '.env.disposable')
  const parsed = parseEnvFile(filePath)
  const merged = { ...parsed, ...process.env }
  return {
    filePath,
    fileExists: fs.existsSync(filePath),
    env: merged,
  }
}

export function redactKey(value) {
  const raw = String(value || '')
  if (!raw) return '(empty)'
  return `<REDACTED len=${raw.length} prefix=${raw.slice(0, 4)}…>`
}

export default { parseEnvFile, loadDisposableEnv, redactKey }
