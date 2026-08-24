/**
 * Drive 4175 preview only. Expand Field Results. Never prints secrets.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnvFile } from './loadDisposableEnv.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SHOTS = path.join(ROOT, '..', 'Audit Data', 'F10C2', 'Phase 4B-U-R1', 'screenshots')
const PORT = 9334
const TARGET = 'http://127.0.0.1:4175/'

function redact(text) {
  return String(text || '').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt-redacted]')
}

class Cdp {
  constructor(url) {
    this.url = url
    this.id = 0
    this.pending = new Map()
  }
  async open() {
    this.ws = new WebSocket(this.url)
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve)
      this.ws.addEventListener('error', reject)
    })
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(redact(JSON.stringify(msg.error))))
        else resolve(msg.result)
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`cdp_timeout ${method}`))
        }
      }, 30000)
    })
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true })
    if (result?.exceptionDetails) {
      throw new Error(redact(String(result.exceptionDetails?.exception?.description || result.exceptionDetails.text).slice(0, 400)))
    }
    return result?.result?.value
  }
  close() { try { this.ws.close() } catch { /* ignore */ } }
}

async function screenshot(cdp, name) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.mkdirSync(SHOTS, { recursive: true })
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(shot.data, 'base64'))
  console.log(`screenshot ${name}`)
}

async function main() {
  const env = parseEnvFile(path.join(ROOT, '.env.disposable'))
  const email = env.F10C2_DISPOSABLE_ADMIN_EMAIL
  const password = env.F10C2_DISPOSABLE_ADMIN_PASSWORD
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  const list = await res.json()
  const page = (list || []).find((p) => p.type === 'page' && String(p.url || '').startsWith(TARGET))
  if (!page) throw new Error('4175_page_missing')
  const cdp = new Cdp(page.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  const href = await cdp.eval(`location.href`)
  console.log(`href=${href}`)

  const needsLogin = await cdp.eval(`!!document.querySelector('input[type="password"], input[placeholder="Email"]')`)
  console.log(`needs_login=${needsLogin}`)
  if (needsLogin) {
    await screenshot(cdp, '08_web_4175_login.png')
    await cdp.eval(`(function(){
      const email = ${JSON.stringify(email)};
      const password = ${JSON.stringify(password)};
      const inputs = [...document.querySelectorAll('input')];
      const emailInput = inputs.find(i => i.placeholder === 'Email') || inputs[0];
      const passInput = inputs.find(i => i.type === 'password');
      const proto = HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc.set.call(emailInput, email);
      emailInput.dispatchEvent(new Event('input', { bubbles: true }));
      desc.set.call(passInput, password);
      passInput.dispatchEvent(new Event('input', { bubbles: true }));
      const form = emailInput.closest('form');
      if (form && form.requestSubmit) form.requestSubmit();
      else document.querySelector('button[type="submit"]').click();
      return true;
    })()`)
    console.log('login_submitted_4175')
    await new Promise((r) => setTimeout(r, 8000))
  }
  const after = await cdp.eval(`({ text: (document.body.innerText||'').slice(0,800) })`)
  console.log(JSON.stringify({ after: after?.text }))
  await screenshot(cdp, '09_web_4175_after_login.png')

  await cdp.eval(`(function(){
    const buttons = [...document.querySelectorAll('button')];
    const group = buttons.find(el => /QC & Reports/i.test(el.innerText||'') && (el.innerText||'').length < 40);
    if (group) group.click();
    return true;
  })()`)
  await new Promise((r) => setTimeout(r, 500))
  await cdp.eval(`(function(){
    const nav = [...document.querySelectorAll('button')].find(el => /Field Results/i.test(el.innerText||'') && (el.innerText||'').replace(/\\s+/g,' ').trim().length < 30);
    if (nav) nav.click();
    return !!nav;
  })()`)
  await new Promise((r) => setTimeout(r, 3000))
  await screenshot(cdp, '10_web_4175_field_results.png')
  const fr = await cdp.eval(`({ text: (document.body.innerText||'').slice(0,4000) })`)
  console.log(JSON.stringify({ fieldResults: fr?.text }))
  const flags = await cdp.eval(`({
    live: /disposable Supabase provider/i.test(document.body.innerText||''),
    mock: /Not live Supabase/i.test(document.body.innerText||''),
    phase4: /F10C2 PHASE 4/i.test(document.body.innerText||''),
    synth: /SYNTHETIC_F10C2/i.test(document.body.innerText||''),
    p4bu: /F10C2-P4BU/i.test(document.body.innerText||''),
  })`)
  console.log(JSON.stringify({ flags }))
  cdp.close()
}

main().catch((error) => {
  console.error(`LIVE_FR_FAILED ${redact(error.message || error).slice(0, 400)}`)
  process.exit(1)
})
