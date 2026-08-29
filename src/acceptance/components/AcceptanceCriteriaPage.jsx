/**
 * CR1-D-R1 — admin Pass/Fail Criteria + open-task assignment.
 * Versioning and assignment resolution stay internal.
 */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { isFieldResultsSupabaseProviderEnabled } from "../../lib/f10c2FeatureFlags.js";
import { canMutateAcceptanceProfile } from "../permissions.js";
import { createAcceptanceProfilesRepository } from "../profiles/acceptanceProfilesRepository.js";
import { replaceActiveTaskAssignments } from "../profileManagement.js";
import {
  DATA_THROUGHPUT_NOTE,
  countAssignedTasks,
  currentCriteriaName,
  deactivateAssignmentWarning,
  dlIterationPassCopy,
  emptySimpleRuleForm,
  formFromProfile,
  isOpenTask,
  isReusableSavedRule,
  persistedFeName,
  persistedVendorName,
  previewDeactivateImpact,
  REPLACE_INACTIVE_ASSIGNMENT_COPY,
  ruleCompatibility,
  sanitizeAssignmentError,
  sanitizeProfileStatusError,
  summarizeSimpleRule,
  taskAssignmentFromLibrary,
  taskDisplayName,
  taskTestType,
  ulIterationPassCopy,
  validateSimpleRule,
} from "../simpleRuleUx.js";
import { scenarioLabel } from "../../fieldResults/models/fieldResultTypes.js";
import "../../fieldResults/components/FieldResults.css";
import "./AcceptanceCriteria.css";

function projectFor(task, projects = []) {
  return task.projects || projects.find((p) => String(p.id) === String(task.project_id)) || {};
}

export default function AcceptanceCriteriaPage({
  user,
  role,
  projects = [],
  tasks = [],
  fieldEngineers = [],
  forceMock = false,
}) {
  const actorRole = role || user?.appRole || user?.profileRole || "admin";
  const canEdit = canMutateAcceptanceProfile(actorRole);
  const repository = useMemo(
    () => createAcceptanceProfilesRepository({
      kind: forceMock ? "mock" : (isFieldResultsSupabaseProviderEnabled() ? "supabase" : "mock"),
      supabase: forceMock ? undefined : supabase,
    }),
    [forceMock],
  );

  const [profiles, setProfiles] = useState([]);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState(() => emptySimpleRuleForm());
  const [editingId, setEditingId] = useState(null);
  const [taskQuery, setTaskQuery] = useState({
    search: "",
    project: "",
    vendor: "",
    testType: "",
    assignment: "",
  });
  const [selectedTaskIds, setSelectedTaskIds] = useState(() => new Set());
  const [taskRulePick, setTaskRulePick] = useState({});
  const [confirmBulk, setConfirmBulk] = useState(null);
  const [confirmRow, setConfirmRow] = useState(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [techOpen, setTechOpen] = useState({});

  async function refresh() {
    const res = await repository.listProfiles();
    if (res.ok) setProfiles(res.profiles || []);
    else setNotice(res.message || "Unable to load saved rules.");
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const res = await repository.listProfiles();
      if (cancelled) return;
      if (res.ok) setProfiles(res.profiles || []);
      else setNotice(res.message || "Unable to load saved rules.");
    })();
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const savedRules = useMemo(
    () => (profiles || []).filter((p) => isReusableSavedRule(p)),
    [profiles],
  );
  const activeRules = savedRules.filter((p) => p.is_active !== false);

  const openTasks = useMemo(
    () => (tasks || []).filter((t) => isOpenTask(t)),
    [tasks],
  );

  const filteredTasks = useMemo(() => {
    return openTasks.filter((task) => {
      const project = projectFor(task, projects);
      const vendor = persistedVendorName(task, project);
      const testType = taskTestType(task, project);
      const current = currentCriteriaName(task, profiles, project);
      if (taskQuery.project && String(task.project_id) !== String(taskQuery.project) && project.name !== taskQuery.project) {
        return false;
      }
      if (taskQuery.vendor && vendor !== taskQuery.vendor) return false;
      if (taskQuery.testType && testType !== taskQuery.testType && scenarioLabel(testType) !== taskQuery.testType) {
        return false;
      }
      if (taskQuery.assignment === "assigned" && current.name === "None") return false;
      if (taskQuery.assignment === "unassigned" && current.name !== "None") return false;
      if (taskQuery.search) {
        const blob = [
          project.name,
          vendor,
          task.market,
          taskDisplayName(task),
          persistedFeName(task, fieldEngineers),
          current.name,
        ].join(" ").toLowerCase();
        if (!blob.includes(taskQuery.search.toLowerCase())) return false;
      }
      return true;
    });
  }, [openTasks, projects, profiles, taskQuery, fieldEngineers]);

  const vendorOptions = useMemo(() => {
    const set = new Set();
    openTasks.forEach((t) => {
      const v = persistedVendorName(t, projectFor(t, projects));
      if (v && v !== "—") set.add(v);
    });
    return [...set].sort();
  }, [openTasks, projects]);

  const testTypeOptions = useMemo(() => {
    const set = new Set();
    openTasks.forEach((t) => {
      const v = taskTestType(t, projectFor(t, projects));
      if (v) set.add(v);
    });
    return [...set].sort();
  }, [openTasks, projects]);

  function patchForm(partial) {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  function clearForm() {
    setForm(emptySimpleRuleForm());
    setEditingId(null);
  }

  async function onSave() {
    const named = String(form.name || "").trim().toLowerCase();
    const existing = !editingId
      ? savedRules.find((p) => p.is_active !== false && String(p.name || "").trim().toLowerCase() === named)
      : null;
    const targetId = editingId || existing?.id || null;
    const check = validateSimpleRule(form, { profiles: savedRules, editingId: targetId });
    if (!check.ok) {
      setNotice(check.errors[0]);
      return;
    }
    const actor = { role: actorRole, tenantId: user?.tenant_id || user?.tenantId || null };
    const res = targetId
      ? await repository.updateRule(targetId, form, actor)
      : await repository.saveRule(form, actor);
    setNotice(res.ok
      ? (res.toast || (targetId ? "Rule updated. Previous completed results remain unchanged." : "Rule saved."))
      : sanitizeAssignmentError(res.message || res.errors?.[0] || res.code));
    if (res.ok) {
      clearForm();
      await refresh();
    }
  }

  function onEdit(profile) {
    setEditingId(profile.id);
    setForm(formFromProfile(profile));
    setNotice("");
  }

  async function applyStatus(profile, isActive) {
    const res = await repository.setActive(profile.id, isActive, { role: actorRole });
    if (!res.ok) {
      setNotice(sanitizeProfileStatusError(res.message || res.code));
      return;
    }
    if (isActive) {
      setNotice("Rule activated.");
    } else if ((res.active_assignment_count || 0) > 0 || (res.deactivated_assignment_count || 0) > 0) {
      setNotice("Rule deactivated. Open tasks now use the next active criterion — replace the inactive assignment.");
    } else {
      setNotice("Rule deactivated.");
    }
    setConfirmDeactivate(null);
    await refresh();
  }

  async function onToggleActive(profile) {
    const activating = profile.is_active === false;
    if (!activating) {
      const impact = previewDeactivateImpact(profile, profiles);
      if (impact.requiresConfirm) {
        setConfirmDeactivate({ profile, assignedCount: impact.assignedCount, warning: impact.warning });
        return;
      }
    }
    await applyStatus(profile, activating);
  }

  function actor() {
    return { role: actorRole, tenantId: user?.tenant_id || user?.tenantId || null };
  }

  function requestAssignOne(task, ruleId) {
    if (assigning) return;
    const rule = activeRules.find((p) => p.id === ruleId);
    if (!rule || !ruleId) {
      setNotice("Select a saved rule first.");
      return;
    }
    const compat = ruleCompatibility(rule, taskTestType(task, projectFor(task, projects)));
    if (!compat.ok) {
      setNotice(compat.message);
      return;
    }
    setConfirmRow({ rule, task });
  }

  async function assignOne(task, rule) {
    if (assigning) return;
    setAssigning(true);
    try {
      const res = await repository.assignToTasks(rule.id, [task], actor());
      setNotice(res.ok
        ? `Assigned “${rule.name}” to ${taskDisplayName(task)}.`
        : sanitizeAssignmentError(res.message || res.code));
      if (res.ok) {
        setProfiles((prev) => replaceActiveTaskAssignments(prev, taskAssignmentFromLibrary(rule, task)));
        setConfirmRow(null);
        await refresh();
        setProfiles((prev) => {
          const hit = (prev || []).some((p) => (
            String(p.scope_type) === "task"
            && String(p.scope_id) === String(task.id)
            && p.is_active !== false
            && String(p.name) === String(rule.name)
          ));
          if (hit) return prev;
          return replaceActiveTaskAssignments(prev, taskAssignmentFromLibrary(rule, task));
        });
      }
    } finally {
      setAssigning(false);
    }
  }

  async function assignBulk(rule, taskList) {
    if (assigning) return;
    for (const task of taskList) {
      const compat = ruleCompatibility(rule, taskTestType(task, projectFor(task, projects)));
      if (!compat.ok) {
        setNotice(compat.message);
        return;
      }
    }
    setAssigning(true);
    try {
      const res = await repository.assignToTasks(rule.id, taskList, actor());
      setNotice(res.ok
        ? `Assigned “${rule.name}” to ${taskList.length} selected task(s).`
        : sanitizeAssignmentError(res.message || res.code));
      if (res.ok) {
        setSelectedTaskIds(new Set());
        setConfirmBulk(null);
        setProfiles((prev) => {
          let merged = prev;
          for (const task of taskList) {
            merged = replaceActiveTaskAssignments(merged, taskAssignmentFromLibrary(rule, task));
          }
          return merged;
        });
        await refresh();
        setProfiles((prev) => {
          let merged = prev;
          for (const task of taskList) {
            const hit = (merged || []).some((p) => (
              String(p.scope_type) === "task"
              && String(p.scope_id) === String(task.id)
              && p.is_active !== false
              && String(p.name) === String(rule.name)
            ));
            if (!hit) merged = replaceActiveTaskAssignments(merged, taskAssignmentFromLibrary(rule, task));
          }
          return merged;
        });
      }
    } finally {
      setAssigning(false);
    }
  }

  const overallSummary = summarizeSimpleRule(form);
  const namedExistingId = editingId || savedRules.find((p) => (
    p.is_active !== false
    && String(p.name || "").trim().toLowerCase() === String(form.name || "").trim().toLowerCase()
  ))?.id || null;
  const liveErrors = validateSimpleRule(form, { profiles: savedRules, editingId: namedExistingId });

  if (!canEdit) {
    return (
      <div className="bd-acc-page">
        <p role="status">Acceptance Criteria is available to admin and super_admin only.</p>
      </div>
    );
  }

  return (
    <div className="bd-acc-page">
      <div className="bd-acc-header">
        <p className="bd-acc-kicker">Project Management</p>
        <h2>Acceptance Criteria</h2>
      </div>
      {notice && <div className="bd-acc-banner" role="status">{notice}</div>}

      <section className="bd-acc-panel" aria-labelledby="bd-acc-top-title">
        <h2 id="bd-acc-top-title">Pass/Fail Criteria</h2>
        <p className="bd-acc-subtitle">Create simple reusable rules and assign them to field tasks.</p>

        <div className="bd-acc-form-block" id="bd-acc-form">
        <div className="bd-acc-form-grid">
          <label>
            Rule Name
            <input
              value={form.name}
              onChange={(e) => patchForm({ name: e.target.value })}
              placeholder="Standard Data Test"
            />
          </label>
          <label className="bd-acc-span-2">
            Short Description (optional)
            <input
              value={form.description}
              onChange={(e) => patchForm({ description: e.target.value })}
              placeholder="Typical data throughput rule"
            />
          </label>
        </div>

        <fieldset className="bd-acc-fieldset">
          <legend>Data Throughput</legend>
          <p className="bd-acc-note">{DATA_THROUGHPUT_NOTE}</p>
          <div className="bd-acc-req-row">
            <label className="bd-acc-check">
              <input type="checkbox" checked={form.requireDl} onChange={(e) => patchForm({ requireDl: e.target.checked })} />
              Require Download
            </label>
            {form.requireDl && (
              <>
                <label className="bd-acc-num">
                  Minimum DL Mbps
                  <input type="number" min="0" step="0.1" value={form.dlMinMbps} onChange={(e) => patchForm({ dlMinMbps: e.target.value })} />
                </label>
                <label className="bd-acc-num">
                  Required Passing DL Iterations
                  <input type="number" min="1" step="1" value={form.dlPassingCount} onChange={(e) => patchForm({ dlPassingCount: e.target.value })} />
                </label>
                <p className="bd-acc-inline-help">{dlIterationPassCopy(form.dlMinMbps, form.dlPassingCount)}</p>
              </>
            )}
          </div>
          <div className="bd-acc-req-row">
            <label className="bd-acc-check">
              <input type="checkbox" checked={form.requireUl} onChange={(e) => patchForm({ requireUl: e.target.checked })} />
              Require Upload
            </label>
            {form.requireUl && (
              <>
                <label className="bd-acc-num">
                  Minimum UL Mbps
                  <input type="number" min="0" step="0.1" value={form.ulMinMbps} onChange={(e) => patchForm({ ulMinMbps: e.target.value })} />
                </label>
                <label className="bd-acc-num">
                  Required Passing UL Iterations
                  <input type="number" min="1" step="1" value={form.ulPassingCount} onChange={(e) => patchForm({ ulPassingCount: e.target.value })} />
                </label>
                <p className="bd-acc-inline-help">{ulIterationPassCopy(form.ulMinMbps, form.ulPassingCount)}</p>
              </>
            )}
          </div>
        </fieldset>

        <fieldset className="bd-acc-fieldset">
          <legend>Voice Calls</legend>
          <div className="bd-acc-req-row">
            <label className="bd-acc-check">
              <input type="checkbox" checked={form.requireMo} onChange={(e) => patchForm({ requireMo: e.target.checked })} />
              Require MO
            </label>
            {form.requireMo && (
              <label className="bd-acc-num">
                Required Successful MO Calls
                <input type="number" min="1" step="1" value={form.moSuccessCount} onChange={(e) => patchForm({ moSuccessCount: e.target.value })} />
              </label>
            )}
            <label className="bd-acc-check">
              <input type="checkbox" checked={form.requireMt} onChange={(e) => patchForm({ requireMt: e.target.checked })} />
              Require MT
            </label>
            {form.requireMt && (
              <label className="bd-acc-num">
                Required Successful MT Calls
                <input type="number" min="1" step="1" value={form.mtSuccessCount} onChange={(e) => patchForm({ mtSuccessCount: e.target.value })} />
              </label>
            )}
          </div>
        </fieldset>

        <p className="bd-acc-summary" aria-live="polite">
          <strong>Summary:</strong> {overallSummary}
        </p>
        {!liveErrors.ok && form.name && (
          <ul className="bd-acc-errors">{liveErrors.errors.map((err) => <li key={err}>{err}</li>)}</ul>
        )}
        <div className="bdfr-filter-actions">
          {editingId ? (
            <>
              <button type="button" className="bdfr-btn" onClick={onSave}>Save Updated Rule</button>
              <button type="button" className="bdfr-btn bdfr-btn-secondary" onClick={clearForm}>Cancel Edit</button>
            </>
          ) : (
            <>
              <button type="button" className="bdfr-btn" onClick={onSave}>Save Rule</button>
              <button type="button" className="bdfr-btn bdfr-btn-secondary" onClick={clearForm}>Clear Form</button>
            </>
          )}
        </div>
        </div>

        <div id="bd-acc-saved-rules-wrap">
        <h3 id="bd-acc-saved-rules">Saved Rules</h3>
        <div className="bdfr-table-wrap">
          <table className="bdfr-table">
            <thead>
              <tr>
                <th>Rule Name</th>
                <th>Simple Summary</th>
                <th>Assigned Tasks</th>
                <th>Status</th>
                <th>Edit</th>
                <th>Activate/Deactivate</th>
              </tr>
            </thead>
            <tbody>
              {savedRules.length === 0 && (
                <tr><td colSpan={6}>No saved rules yet.</td></tr>
              )}
              {savedRules.map((rule) => (
                <tr key={rule.id}>
                  <td><strong>{rule.name}</strong></td>
                  <td>{summarizeSimpleRule(rule)}</td>
                  <td>{countAssignedTasks(rule, profiles)}</td>
                  <td>{rule.is_active === false ? "Inactive" : "Active"}</td>
                  <td>
                    <button type="button" className="bdfr-link" onClick={() => onEdit(rule)}>Edit Rule</button>
                  </td>
                  <td>
                    <button type="button" className="bdfr-btn bdfr-btn-secondary" onClick={() => onToggleActive(rule)}>
                      {rule.is_active === false ? "Activate" : "Deactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      </section>

      <section className="bd-acc-panel" id="bd-acc-open-tasks" aria-labelledby="bd-acc-bottom-title">
        <h2 id="bd-acc-bottom-title">Assign Criteria to Open Tasks</h2>
        <div className="bdfr-filters" role="search" aria-label="Open task filters">
          <label>
            Search
            <input value={taskQuery.search} onChange={(e) => setTaskQuery({ ...taskQuery, search: e.target.value })} placeholder="Project, vendor, task, or grid" />
          </label>
          <label>
            Project
            <select value={taskQuery.project} onChange={(e) => setTaskQuery({ ...taskQuery, project: e.target.value })}>
              <option value="">All</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>
            Vendor
            <select value={taskQuery.vendor} onChange={(e) => setTaskQuery({ ...taskQuery, vendor: e.target.value })}>
              <option value="">All</option>
              {vendorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label>
            Test Type
            <select value={taskQuery.testType} onChange={(e) => setTaskQuery({ ...taskQuery, testType: e.target.value })}>
              <option value="">All</option>
              {testTypeOptions.map((t) => <option key={t} value={t}>{scenarioLabel(t)}</option>)}
            </select>
          </label>
          <label>
            Assignment
            <select value={taskQuery.assignment} onChange={(e) => setTaskQuery({ ...taskQuery, assignment: e.target.value })}>
              <option value="">All</option>
              <option value="assigned">Assigned</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </label>
        </div>

        {selectedTaskIds.size > 0 && (
          <div className="bd-acc-bulk">
            <span>{selectedTaskIds.size} selected</span>
            <select
              aria-label="Bulk rule"
              value={taskRulePick.bulk || ""}
              onChange={(e) => setTaskRulePick({ ...taskRulePick, bulk: e.target.value })}
            >
              <option value="">Select criteria</option>
              {activeRules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <button
              type="button"
              className="bdfr-btn"
              disabled={assigning || !taskRulePick.bulk}
              onClick={() => {
                const rule = activeRules.find((p) => p.id === taskRulePick.bulk);
                if (!rule) {
                  setNotice("Select a saved rule first.");
                  return;
                }
                const list = filteredTasks.filter((t) => selectedTaskIds.has(t.id));
                setConfirmBulk({ rule, list });
              }}
            >
              Assign to Selected
            </button>
          </div>
        )}

        {confirmBulk && (
          <div className="bd-acc-confirm" role="dialog" aria-modal="true" aria-labelledby="bd-acc-bulk-confirm">
            <p id="bd-acc-bulk-confirm">Assign “{confirmBulk.rule.name}” to {confirmBulk.list.length} selected task(s)?</p>
            <button
              type="button"
              className="bdfr-btn"
              disabled={assigning}
              onClick={() => assignBulk(confirmBulk.rule, confirmBulk.list)}
            >
              {assigning ? "Assigning…" : "Confirm"}
            </button>
            <button type="button" className="bdfr-btn bdfr-btn-secondary" disabled={assigning} onClick={() => setConfirmBulk(null)}>Cancel</button>
          </div>
        )}

        {confirmDeactivate && (
          <div className="bd-acc-confirm" role="dialog" aria-modal="true" aria-labelledby="bd-acc-deactivate-confirm">
            <p id="bd-acc-deactivate-confirm">
              {confirmDeactivate.warning || deactivateAssignmentWarning(confirmDeactivate.assignedCount)}
            </p>
            <button
              type="button"
              className="bdfr-btn"
              onClick={() => applyStatus(confirmDeactivate.profile, false)}
            >
              Deactivate
            </button>
            <button type="button" className="bdfr-btn bdfr-btn-secondary" onClick={() => setConfirmDeactivate(null)}>Cancel</button>
          </div>
        )}

        {confirmRow && (
          <div className="bd-acc-confirm" role="dialog" aria-modal="true" aria-labelledby="bd-acc-row-confirm">
            <p id="bd-acc-row-confirm">
              {currentCriteriaName(confirmRow.task, profiles, projectFor(confirmRow.task, projects)).name === "None"
                ? `Assign “${confirmRow.rule.name}” to ${taskDisplayName(confirmRow.task)}?`
                : `Change assignment of ${taskDisplayName(confirmRow.task)} to “${confirmRow.rule.name}”?`}
            </p>
            <button
              type="button"
              className="bdfr-btn"
              disabled={assigning}
              onClick={() => assignOne(confirmRow.task, confirmRow.rule)}
            >
              {assigning ? "Assigning…" : "Confirm"}
            </button>
            <button type="button" className="bdfr-btn bdfr-btn-secondary" disabled={assigning} onClick={() => setConfirmRow(null)}>Cancel</button>
          </div>
        )}

        <div className="bdfr-table-wrap">
          <table className="bdfr-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all visible tasks"
                    checked={filteredTasks.length > 0 && filteredTasks.every((t) => selectedTaskIds.has(t.id))}
                    onChange={(e) => {
                      const next = new Set(selectedTaskIds);
                      filteredTasks.forEach((t) => (e.target.checked ? next.add(t.id) : next.delete(t.id)));
                      setSelectedTaskIds(next);
                    }}
                  />
                </th>
                <th>Project Name</th>
                <th>Vendor Name</th>
                <th>Market</th>
                <th>Task Name / Grid</th>
                <th>Assigned FE</th>
                <th>Test Type</th>
                <th>Current Criteria</th>
                <th>Select Criteria</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.length === 0 && (
                <tr><td colSpan={10}>No open tasks match the current filters.</td></tr>
              )}
              {filteredTasks.map((task) => {
                const project = projectFor(task, projects);
                const current = currentCriteriaName(task, profiles, project);
                const pick = taskRulePick[task.id] || "";
                const testType = taskTestType(task, project);
                return (
                  <tr key={task.id} data-task-id={task.id} data-task-name={taskDisplayName(task)}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${taskDisplayName(task)}`}
                        checked={selectedTaskIds.has(task.id)}
                        onChange={(e) => {
                          const next = new Set(selectedTaskIds);
                          if (e.target.checked) next.add(task.id);
                          else next.delete(task.id);
                          setSelectedTaskIds(next);
                        }}
                      />
                    </td>
                    <td>{project.name || "—"}</td>
                    <td>{persistedVendorName(task, project)}</td>
                    <td>{task.market || project.market || "—"}</td>
                    <td>{taskDisplayName(task)}</td>
                    <td>{persistedFeName(task, fieldEngineers)}</td>
                    <td>{testType ? scenarioLabel(testType) : "—"}</td>
                    <td data-current-criteria={current.name} data-assigned-inactive={current.inactiveAssigned ? 'true' : 'false'}>
                      {current.inactiveAssigned ? (
                        <>
                          <div>Assigned criterion: {current.assignedName} — Inactive</div>
                          <div>Effective criterion: {current.name}</div>
                        </>
                      ) : current.name}
                      {current.inactiveAssigned && (
                        <div className="bdfr-id-sub">{REPLACE_INACTIVE_ASSIGNMENT_COPY}</div>
                      )}
                      {current.taskSpecific && !current.inactiveAssigned && (
                        <div className="bdfr-id-sub">This task has a task-specific criterion.</div>
                      )}
                      {current.taskSpecific && (
                        <details
                          className="bd-acc-tech"
                          open={Boolean(techOpen[task.id])}
                          onToggle={(e) => setTechOpen({ ...techOpen, [task.id]: e.target.open })}
                        >
                          <summary>Technical Details</summary>
                          <p>Assignment is stored against this task. Completed results keep the rule that was in effect when they finished.</p>
                        </details>
                      )}
                    </td>
                    <td>
                      <select
                        aria-label={`Select criteria for ${taskDisplayName(task)}`}
                        value={pick}
                        onChange={(e) => setTaskRulePick({ ...taskRulePick, [task.id]: e.target.value })}
                      >
                        <option value="">Select criteria</option>
                        {activeRules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="bdfr-btn bdfr-btn-secondary"
                        disabled={assigning || !pick}
                        onClick={() => requestAssignOne(task, pick)}
                      >
                        {current.name === "None" ? "Assign" : "Change Assignment"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
