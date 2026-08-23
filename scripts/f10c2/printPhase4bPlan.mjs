/**
 * Print the Phase 4B disposable apply plan. Local only. No database connection.
 */
import { listPhase4bApplyPlan, assertPhase4bPlanFilesExist } from './phase4bApplyPlan.mjs'

const plan = listPhase4bApplyPlan()
const files = assertPhase4bPlanFilesExist()

console.log('F10C2 Phase 4B-S apply plan (NOT EXECUTED)')
console.log(`executable count: ${plan.stages.length}`)
for (const step of plan.stages) {
  console.log(`${String(plan.stages.indexOf(step) + 1).padStart(2, '0')}. [${step.stage}] ${step.slug}`)
}
console.log(`skipped blocked: ${plan.skipped.join(', ')}`)
console.log(`never execute: ${plan.neverExecute.join(', ')}`)
console.log('207: NEVER EXECUTE')
if (files.missing.length) {
  console.error(`MISSING FILES: ${files.missing.join(', ')}`)
  process.exitCode = 2
}
if (files.leaked207.length) {
  console.error('BLOCKED: 207 appeared in the executable list')
  process.exitCode = 2
}
console.log('RESULT: inventory only — no SQL executed')
