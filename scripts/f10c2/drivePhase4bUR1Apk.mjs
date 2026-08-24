/**
 * F10C2 Phase 4B-U-R1 APK WebView CDP helper. Never prints passwords/JWTs/tokens.
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseEnvFile } from './loadDisposableEnv.mjs'

const REPO = path.resolve('C:/Users/Mubasher/Desktop/Mubasher/BabyDragon/babydragon')
const SHOTS = path.join(REPO, '..', 'Audit Data', 'F10C2', 'Phase 4B-U-R1', 'screenshots')

function redact(text) {
  return String(text || '')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt-redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://[redacted]')
}

async function discoverWs() {
  const port = process.env.F10C2_WV_PORT || '9222'
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  const list = await res.json()
  const page = (list || []).find((p) => p.type === 'page' && p.webSocketDebuggerUrl)
  if (!page) throw new Error('webview_page_not_found')
  return page.webSocketDebuggerUrl
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
    this.consoleLines = []
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.method === 'Runtime.consoleAPICalled') {
        const args = (msg.params?.args || []).map((a) => redact(String(a.value ?? a.description ?? ''))).join(' ')
        this.consoleLines.push(`${msg.params?.type || 'log'} ${args}`.slice(0, 300))
      }
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
      const desc = result.exceptionDetails?.exception?.description
        || result.exceptionDetails?.text
        || 'eval_exception'
      throw new Error(redact(String(desc).slice(0, 400)))
    }
    return result?.result?.value
  }
  close() {
    try { this.ws?.close() } catch { /* ignore */ }
  }
}

function interestingSnippet(text) {
  return redact(String(text || '')).slice(0, 2500)
}

async function screenshot(cdp, name) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.mkdirSync(SHOTS, { recursive: true })
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(shot.data, 'base64'))
  console.log(`screenshot ${name}`)
}

const cmd = process.argv[2] || 'probe'
const WS_URL = process.env.F10C2_WV_WS || await discoverWs()
const cdp = new Cdp(WS_URL)
await cdp.open()
await cdp.send('Runtime.enable')

if (cmd === 'probe') {
  const envHost = await cdp.eval(`(function(){
    const href = location.href;
    const html = document.documentElement.innerHTML || '';
    const m = html.match(/https:\\/\\/[a-z0-9.-]+\\.supabase\\.co/gi) || [];
    const unique = [];
    for (let i = 0; i < m.length; i++) {
      try { unique.push(new URL(m[i]).hostname.toLowerCase()); } catch (e) {}
    }
    const text = (document.body.innerText || '').slice(0, 4000);
    return { href, uniqueHosts: Array.from(new Set(unique)), hasMyTasks: /My Tasks/i.test(text), hasP4bu: /F10C2-P4BU-E2E/i.test(text), snippet: text.slice(0, 1800) };
  })()`)
  envHost.snippet = interestingSnippet(envHost.snippet)
  console.log(JSON.stringify(envHost, null, 2))
}

if (cmd === 'login-fe') {
  const env = parseEnvFile(path.join(REPO, '.env.disposable'))
  const email = env.F10C2_DISPOSABLE_FE_EMAIL || 'fe.synthetic.f10c2@invalid.test'
  const password = env.F10C2_DISPOSABLE_FE_PASSWORD || ''
  if (!password) throw new Error('fe_password_missing')
  console.log(`login_email=${email}`)
  console.log(`password_len=${password.length}`)
  const result = await cdp.eval(`(async function(){
    const email = ${JSON.stringify(email)};
    const password = ${JSON.stringify(password)};
    const inputs = [...document.querySelectorAll('input')];
    const emailInput = inputs.find(i => i.type === 'email') || inputs[0];
    const passInput = inputs.find(i => i.type === 'password');
    if (!emailInput || !passInput) return { ok:false, reason:'inputs_missing', inputCount: inputs.length };
    const set = (el, val) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc.set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set(emailInput, email);
    set(passInput, password);
    const form = emailInput.closest('form');
    if (form) {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      const btn = form.querySelector('button[type="submit"]');
      if (btn) btn.click();
    } else {
      const btn = [...document.querySelectorAll('button')].find(b => /^Login$/i.test((b.textContent||'').trim()));
      if (btn) btn.click();
    }
    return { ok:true, emailValueLen: emailInput.value.length };
  })()`, true)
  console.log(JSON.stringify({ ok: result?.ok, reason: result?.reason, emailValueLen: result?.emailValueLen }))
  await new Promise((r) => setTimeout(r, 8000))
  const after = await cdp.eval(`(function(){
    const text = document.body.innerText || '';
    const titles = [...document.querySelectorAll('h2,h3,strong,button,p')].map(el => (el.textContent||'').trim()).filter(Boolean).slice(0, 60);
    return {
      hasMyTasks: /My Tasks/i.test(text),
      hasRfKpi: /RF KPI/i.test(text),
      hasLogin: /FE Login/i.test(text),
      hasP4bu: /F10C2-P4BU-E2E/i.test(text),
      hasValidation: /SYNTHETIC F10C2 Validation Task/i.test(text),
      assignedMatch: /Assigned[\\s\\S]{0,40}?(\\d+)/i.exec(text)?.[1] || null,
      titles,
      snippet: text.slice(0, 2000),
    };
  })()`)
  after.snippet = interestingSnippet(after.snippet)
  console.log(JSON.stringify(after, null, 2))
}

if (cmd === 'tasks') {
  const after = await cdp.eval(`(function(){
    const text = document.body.innerText || '';
    const taskish = [...document.querySelectorAll('h2,h3,strong,p,button,span')]
      .map(el => (el.textContent||'').trim())
      .filter(t => /task|p4bu|assigned|f10c2|grid|pending/i.test(t))
      .slice(0, 80);
    return {
      hasMyTasks: /My Tasks/i.test(text),
      hasP4bu: /F10C2-P4BU-E2E/i.test(text),
      hasOtherFeHint: /other fe|unassigned|not yours/i.test(text),
      assignedCount: /Assigned[\\s\\n]+(\\d+)/i.exec(text)?.[1] || null,
      taskish,
      snippet: text.slice(0, 2200),
    };
  })()`)
  after.snippet = interestingSnippet(after.snippet)
  console.log(JSON.stringify(after, null, 2))
}

if (cmd === 'click') {
  const needle = process.argv[3] || ''
  const clicked = await cdp.eval(`(function(){
    const needle = ${JSON.stringify(needle)};
    const els = [...document.querySelectorAll('button,a,summary,label,div,span,strong')];
    const el = els.find(e => (e.textContent||'').trim() === needle)
      || els.find(e => new RegExp(needle, 'i').test((e.textContent||'').trim()));
    if (!el) return { ok:false, reason:'not_found' };
    el.click();
    return { ok:true, tag: el.tagName, text: (el.textContent||'').trim().slice(0, 80) };
  })()`)
  console.log(JSON.stringify(clicked))
}

if (cmd === 'configure-http') {
  const configured = await cdp.eval(`(function(){
    const nativeBtn = [...document.querySelectorAll('button')].find(b => /Native Android HTTP/i.test(b.textContent||''));
    if (nativeBtn) nativeBtn.click();
    const labels = [...document.querySelectorAll('label')];
    const setInput = (spanText, value) => {
      const lab = labels.find(l => (l.querySelector('span')?.textContent||'').trim() === spanText);
      const input = lab?.querySelector('input');
      if (!input) return false;
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      desc.set.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    return {
      nativeClicked: Boolean(nativeBtn),
      duration: setInput('Duration', 5),
      warmup: setInput('Warmup', 1),
      wait: setInput('Wait', 1),
      iterations: setInput('Iterations', 3),
    };
  })()`)
  console.log(JSON.stringify(configured))
}

if (cmd === 'body') {
  const after = await cdp.eval(`(function(){
    const text = document.body.innerText || '';
    return { snippet: text.slice(0, 2500), buttons: [...document.querySelectorAll('button')].map(b => (b.textContent||'').trim()).filter(Boolean).slice(0, 40) };
  })()`)
  after.snippet = interestingSnippet(after.snippet)
  console.log(JSON.stringify(after, null, 2))
}

if (cmd === 'export-and-diag') {
  const clicked = await cdp.eval(`(function(){
    const els = [...document.querySelectorAll('button')];
    const el = els.find(e => (e.textContent||'').trim() === 'Export');
    if (!el) return { ok:false, reason:'export_missing' };
    el.click();
    return { ok:true };
  })()`)
  console.log(JSON.stringify({ clicked }))
  await new Promise((r) => setTimeout(r, 10000))
  const q = await cdp.eval(`(function(){
    let queueLen = 0, types = [], err = null;
    try {
      const raw = localStorage.getItem('babydragon_mobile_offline_queue_v1');
      const parsed = raw ? JSON.parse(raw) : [];
      queueLen = Array.isArray(parsed) ? parsed.length : -1;
      types = (Array.isArray(parsed) ? parsed : []).map((i) => i.type).slice(0, 12);
    } catch (e) { err = String(e && e.message || e).slice(0, 80); }
    let runCount = 0;
    try { runCount = Object.keys(JSON.parse(localStorage.getItem('babydragon_f10c2_client_run_ids_v1') || '{}')).length; } catch (e) {}
    const text = document.body.innerText || '';
    return {
      queueLen,
      types,
      runCount,
      err,
      hasPackageSaved: /Report Package Saved/i.test(text),
      consoleHint: /enqueue skipped/i.test(text),
    };
  })()`)
  console.log(JSON.stringify({ diag: q, consoleLines: cdp.consoleLines.slice(-30) }, null, 2))
}

if (cmd === 'diag') {
  const q = await cdp.eval(`(function(){
    let queueLen = 0, types = [], err = null;
    try {
      const raw = localStorage.getItem('babydragon_mobile_offline_queue_v1');
      const parsed = raw ? JSON.parse(raw) : [];
      queueLen = Array.isArray(parsed) ? parsed.length : -1;
      types = (Array.isArray(parsed) ? parsed : []).map((i) => i.type).slice(0, 12);
    } catch (e) { err = String(e && e.message || e).slice(0, 80); }
    let runCount = 0;
    try { runCount = Object.keys(JSON.parse(localStorage.getItem('babydragon_f10c2_client_run_ids_v1') || '{}')).length; } catch (e) {}
    const keys = Object.keys(localStorage || {}).filter((k) => /baby|queue|f10c2|offline/i.test(k));
    return { queueLen, types, runCount, keys, err };
  })()`)
  console.log(JSON.stringify(q, null, 2))
}

if (cmd === 'queue') {
  const q = await cdp.eval(`(function(){
    const keys = Object.keys(localStorage || {});
    const queueKey = keys.find(k => /queue|offline|babydragon/i.test(k)) || null;
    let items = [];
    try {
      for (const k of keys) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        if (/field_test_result_submit|client_run_id/.test(raw)) {
          const parsed = JSON.parse(raw);
          items.push({ key: k, kind: Array.isArray(parsed) ? 'array' : typeof parsed, count: Array.isArray(parsed) ? parsed.length : 1 });
        }
      }
    } catch (e) {}
    let queue = [];
    try {
      const raw = localStorage.getItem('babydragon_mobile_offline_queue_v1') || localStorage.getItem('babydragon_offline_queue_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        queue = (Array.isArray(parsed) ? parsed : []).map(item => ({
          type: item.type,
          client_run_id: item.payload?.client_run_id || item.summary?.client_run_id || null,
          package_state: item.payload?.package_state || null,
          report_name: item.payload?.report_name || item.summary?.report_name || null,
          task_id: item.payload?.task_id || item.payload?.taskContext?.taskId || null,
        }));
      }
    } catch (e) {}
    let runIds = {};
    try { runIds = JSON.parse(localStorage.getItem('babydragon_f10c2_client_run_ids_v1') || '{}'); } catch (e) {}
    return {
      storageKeys: keys.filter(k => /baby|queue|f10c2|offline/i.test(k)),
      itemsHint: items,
      queue,
      clientRunIdCount: Object.keys(runIds).length,
      clientRunIds: Object.values(runIds).map(v => v.client_run_id).filter(Boolean),
    };
  })()`)
  console.log(JSON.stringify(q, null, 2))
}

if (cmd === 'shot') {
  await screenshot(cdp, process.argv[3] || 'apk_cdp.png')
}

if (cmd === 'eval') {
  const value = await cdp.eval(process.argv[3], true)
  console.log(JSON.stringify(value, null, 2))
}

cdp.close()
process.exit(0)
