/**
 * Reconnect to the 4B-U-R1 preview Chrome session and open Field Results.
 * Never prints passwords or JWTs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SHOTS = path.join(ROOT, '..', 'Audit Data', 'F10C2', 'Phase 4B-U-R1', 'screenshots')
const PORT = 9334

function redact(text) {
  return String(text || '')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt-redacted]')
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
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  const list = await res.json()
  const page = (list || []).find((p) => p.type === 'page' && p.webSocketDebuggerUrl)
  if (!page) throw new Error('chrome_page_missing')
  const cdp = new Cdp(page.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Runtime.enable')

  const expand = await cdp.eval(`(function(){
    const buttons = [...document.querySelectorAll('button')];
    const group = buttons.find(el => /^QC & Reports$/i.test((el.innerText||'').replace(/[▸▾]/g,'').trim()) || /QC & Reports/i.test(el.innerText||'') && (el.innerText||'').length < 40);
    if (group) group.click();
    return { group: group ? (group.innerText||'').trim().slice(0,40) : null };
  })()`)
  console.log(JSON.stringify({ expand }))
  await new Promise((r) => setTimeout(r, 600))

  const clicked = await cdp.eval(`(function(){
    const buttons = [...document.querySelectorAll('button')];
    const nav = buttons.find(el => /Field Results/i.test(el.innerText||'') && (el.innerText||'').replace(/\\s+/g,' ').trim().length < 30);
    if (!nav) {
      return { ok:false, sample: buttons.map(b => (b.innerText||'').trim()).filter(t => t && t.length < 40).slice(0,40) };
    }
    nav.click();
    return { ok:true, label: (nav.innerText||'').trim() };
  })()`)
  console.log(JSON.stringify(clicked))
  await new Promise((r) => setTimeout(r, 2500))
  await screenshot(cdp, '06_web_field_results_after_nav.png')
  const text = await cdp.eval(`({ text: (document.body.innerText||'').slice(0,3500) })`)
  console.log(JSON.stringify({ fieldResults: text?.text }))

  const opened = await cdp.eval(`(function(){
    const rows = [...document.querySelectorAll('button,tr,a,div,td')];
    const hit = rows.find(el => {
      const t = (el.innerText||'').trim();
      return t.length < 200 && /SYNTHETIC_F10C2|F10C2-P4BU|Unified_Result|QC_Passed|QC_Failed/i.test(t);
    });
    if (!hit) return { ok:false };
    hit.click();
    return { ok:true, label: (hit.innerText||'').trim().slice(0,120) };
  })()`)
  console.log(JSON.stringify({ opened }))
  await new Promise((r) => setTimeout(r, 2500))
  await screenshot(cdp, '07_web_field_result_detail.png')
  const detail = await cdp.eval(`({ text: (document.body.innerText||'').slice(0,3500) })`)
  console.log(JSON.stringify({ detail: detail?.text }))
  cdp.close()
}

main().catch((error) => {
  console.error(`FIELD_RESULTS_NAV_FAILED ${redact(error.message || error).slice(0, 400)}`)
  process.exit(1)
})
