/**
 * Open SYNTHETIC_F10C2_Unified_Result detail on 4175. No secrets printed.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SHOTS = path.join(ROOT, '..', 'Audit Data', 'F10C2', 'Phase 4B-U-R1', 'screenshots')
const TARGET = 'http://127.0.0.1:4175/'

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map() }
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
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
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
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`timeout ${method}`)) }
      }, 20000)
    })
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true })
    return result?.result?.value
  }
  close() { try { this.ws.close() } catch { /* ignore */ } }
}

async function main() {
  const list = await (await fetch('http://127.0.0.1:9334/json/list')).json()
  const page = (list || []).find((p) => p.type === 'page' && String(p.url || '').startsWith(TARGET))
  if (!page) throw new Error('4175_missing')
  const cdp = new Cdp(page.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Runtime.enable')
  const opened = await cdp.eval(`(function(){
    const rows = [...document.querySelectorAll('button,tr,a,div,td')];
    const hit = rows.find(el => /SYNTHETIC_F10C2_Unified_Result/.test(el.innerText||'') && (el.innerText||'').length < 800);
    if (!hit) return { ok:false };
    hit.click();
    return { ok:true, label: (hit.innerText||'').trim().slice(0,180) };
  })()`)
  console.log(JSON.stringify({ opened }))
  await new Promise((r) => setTimeout(r, 2500))
  const detail = await cdp.eval(`({ text: (document.body.innerText||'').slice(0,3000) })`)
  console.log(JSON.stringify({ detail: detail?.text }))
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.mkdirSync(SHOTS, { recursive: true })
  fs.writeFileSync(path.join(SHOTS, '11_web_4175_result_detail.png'), Buffer.from(shot.data, 'base64'))
  console.log('screenshot 11')
  const qc = await cdp.eval(`(function(){
    const tab = [...document.querySelectorAll('button,a')].find(el => /QC Workspace/i.test(el.innerText||''));
    if (tab) tab.click();
    return { ok: Boolean(tab) };
  })()`)
  console.log(JSON.stringify({ qc }))
  await new Promise((r) => setTimeout(r, 1200))
  const qcShot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(SHOTS, '12_web_4175_qc_workspace.png'), Buffer.from(qcShot.data, 'base64'))
  console.log('screenshot 12')
  const qcText = await cdp.eval(`({ text: (document.body.innerText||'').slice(0,2000) })`)
  console.log(JSON.stringify({ qcText: qcText?.text }))
  cdp.close()
}

main().catch((error) => {
  console.error(String(error.message || error).slice(0, 400))
  process.exit(1)
})
