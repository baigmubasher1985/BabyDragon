import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const ROOT = process.cwd()

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

describe('CR1-A compact mobile UI state', () => {
  it('keeps advanced data setup collapsed by default with Expand/Collapse', () => {
    const src = read('src/mobile/rf/MobileRfKpiCore.jsx')
    expect(src).toMatch(/const \[dataSetupOpen, setDataSetupOpen\] = useState\(false\)/)
    expect(src).toMatch(/\{dataSetupOpen \? "Collapse" : "Expand"\}/)
    expect(src).toMatch(/\{dataSetupOpen && \(/)
    expect(src).not.toMatch(/setSelectedMode\("data"\); setDataSetupOpen\(true\)/)
  })

  it('keeps Log/Report Name behind a collapsed details control', () => {
    const src = read('src/mobile/rf/MobileRfKpiCore.jsx')
    expect(src).toMatch(/<details className="bd-rf-report-name-field bd-rf-advanced-toggle">/)
    expect(src).toMatch(/<summary>Log \/ Report Name<\/summary>/)
  })

  it('restores compact bottom padding so sticky actions do not overlap', () => {
    const css = read('src/mobile/mobile.css')
    const simplified = css.match(/\.bd-rf-ux-simplified\.bd-mobile-rf-compact \{[\s\S]*?\}/)
    expect(css).toContain('padding-bottom: calc(168px + env(safe-area-inset-bottom, 0px))')
    expect(simplified?.[0]).not.toContain('520px')
  })

  it('exposes package scope tabs and association confirmation without removing engines', () => {
    const src = read('src/mobile/rf/MobileRfKpiCore.jsx')
    expect(src).toMatch(/PACKAGE_SCOPE_LABELS/)
    expect(src).toMatch(/Attach selected unassigned to current task/)
    expect(src).toMatch(/Attach unassigned packages\?/)
    expect(src).toMatch(/NativeHttpTestCard/)
    expect(src).toMatch(/FtpTestCard/)
    expect(src).toMatch(/Iperf3TestPage/)
    expect(src).toMatch(/OoklaTestCard/)
    expect(src).toMatch(/FccTestCard/)
  })
})
