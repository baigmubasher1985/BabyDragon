/**
 * F10C2 Phase 4B-U-R1 — drive local preview admin UI.
 * Reads ignored env; never prints passwords, JWTs, or Authorization headers.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnvFile } from './loadDisposableEnv.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EVIDENCE = path.join(ROOT, '..', 'Audit Data', 'F10C2', 'Phase 4B-U-R1')
const SHOTS = path.join(EVIDENCE, 'screenshots')
const PORT = 9334
const PREVIEW = 'http://127.0.0.1:4175/'

function redact(text) {
  return String(text || '')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt-redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
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
  async eval(expression, awaitPromise = false) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
    })
    if (result?.exceptionDetails) {
      throw new Error(redact(String(result.exceptionDetails?.exception?.description || result.exceptionDetails.text).slice(0, 400)))
    }
    return result?.result?.value
  }
  close() { try { this.ws.close() } catch { /* ignore */ } }
}

async function waitJson(url, tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) return await res.json()
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`devtools_not_ready ${url}`)
}

async function screenshot(cdp, name) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.mkdirSync(SHOTS, { recursive: true })
  const dest = path.join(SHOTS, name)
  fs.writeFileSync(dest, Buffer.from(shot.data, 'base64'))
  console.log(`screenshot ${name} bytes=${Buffer.from(shot.data, 'base64').length}`)
}

async function main() {
  const env = parseEnvFile(path.join(ROOT, '.env.disposable'))
  const email = env.F10C2_DISPOSABLE_ADMIN_EMAIL
  const password = env.F10C2_DISPOSABLE_ADMIN_PASSWORD
  if (!email || !password) throw new Error('admin_creds_missing')
  console.log(`admin_email=${email}`)

  const profile = path.join(os.tmpdir(), 'f10c2-p4bur1-chrome-profile')
  fs.mkdirSync(profile, { recursive: true })
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  const chrome = spawn(chromePath, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    PREVIEW,
  ], { detached: true, stdio: 'ignore' })
  chrome.unref()
  console.log('chrome_spawned')

  const list = await waitJson(`http://127.0.0.1:${PORT}/json/list`)
  const page = (list || []).find((p) => p.type === 'page' && p.webSocketDebuggerUrl)
  if (!page) throw new Error('chrome_page_missing')
  const cdp = new Cdp(page.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await new Promise((r) => setTimeout(r, 2000))

  const loginPage = await cdp.eval(`({ title: document.title, text: (document.body.innerText||'').slice(0,400), hasEmail: !!document.querySelector('input[placeholder="Email"]') })`)
  console.log(JSON.stringify(loginPage))
  await screenshot(cdp, '01_web_admin_login.png')

  await cdp.eval(`(function(){
    const email = ${JSON.stringify(email)};
    const password = ${JSON.stringify(password)};
    const inputs = [...document.querySelectorAll('input')];
    const emailInput = inputs.find(i => i.placeholder === 'Email') || inputs[0];
    const passInput = inputs.find(i => i.type === 'password');
    const set = (el, val) => {
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      desc.set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set(emailInput, email);
    set(passInput, password);
    const form = emailInput.closest('form');
    if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
    else document.querySelector('button[type="submit"],button').click();
    return true;
  })()`)
  console.log('admin_login_submitted')
  await new Promise((r) => setTimeout(r, 8000))
  const after = await cdp.eval(`({ text: (document.body.innerText||'').slice(0,2500) })`)
  console.log(JSON.stringify({ snippet: after?.text }))
  await screenshot(cdp, '02_web_after_admin_login.png')

  const clicked = await cdp.eval(`(function(){
    const buttons = [...document.querySelectorAll('button,a,div,span')];
    const nav = buttons.find(el => /Field Results/i.test(el.textContent||'') && (el.textContent||'').trim().length < 40);
    if (!nav) return { ok:false, reason:'nav_missing', sample: buttons.map(b => (b.textContent||'').trim()).filter(Boolean).slice(0,30) };
    nav.click();
    return { ok:true, label: (nav.textContent||'').trim() };
  })()`)
  console.log(JSON.stringify(clicked))
  await new Promise((r) => setTimeout(r, 3000))
  const listText = await cdp.eval(`({ text: (document.body.innerText||'').slice(0,3000) })`)
  console.log(JSON.stringify({ fieldResults: listText?.text }))
  await screenshot(cdp, '03_web_field_results_list.png')

  const opened = await cdp.eval(`(function(){
    const rows = [...document.querySelectorAll('button,tr,a,div')];
    const hit = rows.find(el => /F10C2-P4BU|SYNTHETIC_F10C2|Unified_Result|QC_Passed|QC_Failed/i.test(el.textContent||''));
    if (!hit) return { ok:false, reason:'row_missing' };
    hit.click();
    return { ok:true, label: (hit.textContent||'').trim().slice(0,120) };
  })()`)
  console.log(JSON.stringify(opened))
  await new Promise((r) => setTimeout(r, 2500))
  await screenshot(cdp, '04_web_field_result_detail.png')
  const detail = await cdp.eval(`({ text: (document.body.innerText||'').slice(0,3500) })`)
  console.log(JSON.stringify({ detail: detail?.text }))

  const qcTab = await cdp.eval(`(function(){
    const tab = [...document.querySelectorAll('button,a')].find(el => /QC Workspace/i.test(el.textContent||''));
    if (!tab) return { ok:false };
    tab.click();
    return { ok:true };
  })()`)
  console.log(JSON.stringify({ qcTab }))
  await new Promise((r) => setTimeout(r, 1200))
  await screenshot(cdp, '05_web_qc_workspace.png')
  const qcAfter = await cdp.eval(`({ text: (document.body.innerText||'').slice(0,2500) })`)
  console.log(JSON.stringify({ qcAfter: qcAfter?.text }))

  cdp.close()
}

main().catch((error) => {
  console.error(`PREVIEW_UI_FAILED ${redact(error.message || error).slice(0, 400)}`)
  process.exit(1)
})
