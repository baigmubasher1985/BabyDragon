/**
 * F10B — Discover and hydrate durable BabyDragon report packages
 * from Downloads/BabyDragon/Reports (native list + text read).
 */

import {
  hydrateSessionFromReportPackage,
  hydrateSessionFromFccPackage,
  hydrateSessionFromOoklaPackage,
} from "./unifiedFieldReportExport.js";
import { resolveScenarioKey, scenarioDisplayName } from "./scenarioReportModel.js";

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function pickFile(files = [], matcher) {
  return (files || []).find((file) => matcher(String(file.fileName || "").toLowerCase())) || null;
}

export function classifyPackageKind(pkg = {}) {
  if (pkg.hasFccEvidenceJson || pickFile(pkg.files, (n) => n.includes("fcc_evidence") && n.endsWith(".json"))) {
    return "fcc";
  }
  if (pkg.hasOoklaEvidence || pickFile(pkg.files, (n) => n.includes("ookla_evidence") && n.endsWith(".csv"))) {
    return "ookla";
  }
  if (pkg.hasIperfJson || pickFile(pkg.files, (n) => n.includes("iperf3") && n.endsWith(".json"))) {
    return "iperf3";
  }
  if (pkg.hasThpIterations || pickFile(pkg.files, (n) => n.includes("thp_iterations"))) {
    return "data";
  }
  if (pkg.hasReportJson || pickFile(pkg.files, (n) => n.endsWith("report.json"))) {
    return "data";
  }
  return "unknown";
}

export async function listSavedReportPackages(BabyDragonRfKpi) {
  if (typeof BabyDragonRfKpi?.listReportPackages !== "function") {
    return { ok: false, packages: [], message: "Native listReportPackages unavailable." };
  }
  const response = await BabyDragonRfKpi.listReportPackages();
  const packages = Array.isArray(response?.packages) ? response.packages : [];
  return {
    ok: Boolean(response?.ok),
    packages: packages.map((pkg) => ({
      ...pkg,
      kind: classifyPackageKind(pkg),
    })),
    message: response?.message || null,
  };
}

async function readTextFile(BabyDragonRfKpi, file) {
  if (!file) return null;
  if (typeof BabyDragonRfKpi?.readReportTextFile !== "function") {
    throw new Error("Native readReportTextFile unavailable.");
  }
  const response = await BabyDragonRfKpi.readReportTextFile({
    uri: file.uri || null,
    path: file.path || null,
    fileName: file.fileName || null,
  });
  if (!response?.ok) {
    throw new Error(response?.message || `Unable to read ${file.fileName || "report file"}`);
  }
  return response.content || "";
}

/**
 * Hydrate one discovered package into a session-like object for F10 unified aggregation.
 */
export async function hydrateDiscoveredPackage(BabyDragonRfKpi, pkg = {}) {
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  const kind = pkg.kind || classifyPackageKind(pkg);
  const sourcePackage = pkg.packageId || null;

  if (kind === "fcc") {
    const evidenceFile = pickFile(files, (n) => n.includes("fcc_evidence") && n.endsWith(".json"));
    const metaFile = pickFile(files, (n) => n.includes("fcc_import_metadata") && n.endsWith(".json"));
    const evidenceJson = evidenceFile ? JSON.parse(await readTextFile(BabyDragonRfKpi, evidenceFile)) : null;
    const metadataJson = metaFile ? JSON.parse(await readTextFile(BabyDragonRfKpi, metaFile)) : null;
    const session = hydrateSessionFromFccPackage({
      evidenceJson,
      metadataJson,
      sourcePackage,
    });
    return { ok: true, kind, session, sourcePackage, packageId: pkg.packageId, modifiedAtMs: pkg.modifiedAtMs || null };
  }

  const reportFile = pickFile(files, (n) => n.endsWith("report.json"));
  const rfFile = pickFile(files, (n) => n.includes("rf_gps_trace") && n.endsWith(".csv"));
  if (!reportFile) {
    return { ok: false, kind, sourcePackage, message: "Package missing Report.json", packageId: pkg.packageId };
  }
  const reportJson = JSON.parse(await readTextFile(BabyDragonRfKpi, reportFile));
  const rfGpsTraceCsv = rfFile ? await readTextFile(BabyDragonRfKpi, rfFile) : "";

  if (kind === "ookla") {
    const ooklaFile = pickFile(files, (n) => n.includes("ookla_evidence") && n.endsWith(".csv"));
    const ooklaCsv = ooklaFile ? await readTextFile(BabyDragonRfKpi, ooklaFile) : "";
    const session = hydrateSessionFromOoklaPackage({
      reportJson,
      rfGpsTraceCsv,
      ooklaEvidenceCsv: ooklaCsv,
      sourcePackage,
    });
    return { ok: true, kind, session, sourcePackage, packageId: pkg.packageId, modifiedAtMs: pkg.modifiedAtMs || null };
  }

  const session = hydrateSessionFromReportPackage({
    reportJson,
    rfGpsTraceCsv,
    sourcePackage,
  });
  return { ok: true, kind, session, sourcePackage, packageId: pkg.packageId, modifiedAtMs: pkg.modifiedAtMs || null };
}

export function buildUnifiedDraftFromSession(session = {}, extras = {}) {
  const scenarioKey = resolveScenarioKey(session);
  const startedAt = session.startedAt || null;
  const endedAt = session.endedAt || null;
  const draftId = extras.draftId
    || `${extras.packageId || session.id || "session"}-${endedAt || startedAt || Date.now()}`;
  return {
    draftId,
    scenarioKey,
    label: scenarioDisplayName(scenarioKey),
    mode: session.appRunModeLabel || session.appRunMode || "",
    direction: session.appDirectionLabel || session.appDirection || "",
    startedAt,
    endedAt,
    status: session.appTestStatus || session.status || "",
    taskLabel: session.taskLabel || null,
    grid: session.grid || null,
    session,
    sourcePackage: session.sourcePackage || extras.sourcePackage || extras.packageId || null,
    packageId: extras.packageId || null,
    selected: extras.selected !== false,
    origin: extras.origin || "saved_package",
  };
}

export function groupDraftsByTaskGrid(drafts = []) {
  const groups = new Map();
  for (const draft of drafts) {
    const task = cleanText(draft.taskLabel) || "Task unknown";
    const grid = cleanText(draft.grid) || "Grid unknown";
    const key = `${task}||${grid}`;
    if (!groups.has(key)) {
      groups.set(key, { key, task, grid, drafts: [] });
    }
    groups.get(key).drafts.push(draft);
  }
  return [...groups.values()].sort((a, b) => a.task.localeCompare(b.task) || a.grid.localeCompare(b.grid));
}

export const PACKAGE_SCOPES = {
  CURRENT_TASK: "current_task",
  UNASSIGNED: "unassigned",
  OTHER_TASKS: "other_tasks",
  ALL_DEVICE: "all_device",
};

export const PACKAGE_SCOPE_LABELS = {
  current_task: "Current Task",
  unassigned: "Unassigned / No Active Task",
  other_tasks: "Other Tasks or Grids",
  all_device: "All Device Packages",
};

const UNASSIGNED_TASK_LABELS = new Set([
  "no active task",
  "unassigned",
  "none",
]);

const UNASSIGNED_GRID_LABELS = new Set([
  "grid pending",
  "unassigned",
  "none",
]);

export function isUnassignedTaskLabel(label) {
  const text = cleanText(label);
  if (!text) return true;
  return UNASSIGNED_TASK_LABELS.has(text.toLowerCase());
}

export function isUnassignedGridLabel(label) {
  const text = cleanText(label);
  if (!text) return true;
  return UNASSIGNED_GRID_LABELS.has(text.toLowerCase());
}

export function durablePackageIdentity(draft = {}) {
  return cleanText(draft.packageId)
    || cleanText(draft.sourcePackage)
    || cleanText(draft.session?.sourcePackage)
    || cleanText(draft.session?.id)
    || cleanText(draft.session?.session_id)
    || cleanText(draft.draftId)
    || null;
}

export function dedupeDraftsByIdentity(drafts = []) {
  const seen = new Set();
  const out = [];
  for (const draft of drafts) {
    const id = durablePackageIdentity(draft);
    const key = id || JSON.stringify({
      startedAt: draft.startedAt,
      label: draft.label,
      task: draft.taskLabel,
    });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(draft);
  }
  return out;
}

export function classifyDraftScope(draft = {}, { taskLabel = null, grid = null } = {}) {
  const activeTask = cleanText(taskLabel);
  const activeGrid = cleanText(grid);
  const draftTask = cleanText(draft.taskLabel);
  const draftGrid = cleanText(draft.grid);
  const unassigned = isUnassignedTaskLabel(draftTask) && isUnassignedGridLabel(draftGrid);
  if (unassigned) return PACKAGE_SCOPES.UNASSIGNED;
  if (activeTask && !isUnassignedTaskLabel(activeTask)) {
    const sameTask = draftTask === activeTask;
    const sameGrid = !activeGrid || isUnassignedGridLabel(activeGrid) || draftGrid === activeGrid;
    if (sameTask && sameGrid) return PACKAGE_SCOPES.CURRENT_TASK;
  }
  return PACKAGE_SCOPES.OTHER_TASKS;
}

export function partitionDraftsByScope(drafts = [], context = {}) {
  const unique = dedupeDraftsByIdentity(drafts);
  const current_task = [];
  const unassigned = [];
  const other_tasks = [];
  for (const draft of unique) {
    const scope = classifyDraftScope(draft, context);
    if (scope === PACKAGE_SCOPES.CURRENT_TASK) current_task.push(draft);
    else if (scope === PACKAGE_SCOPES.UNASSIGNED) unassigned.push(draft);
    else other_tasks.push(draft);
  }
  return {
    current_task,
    unassigned,
    other_tasks,
    all_device: unique,
  };
}

export function applyScopeAutoSelection(partition = {}) {
  const mark = (list = [], selected) => list.map((draft) => ({ ...draft, selected, scope: draft.scope }));
  const current = mark(partition.current_task, true).map((d) => ({ ...d, scope: PACKAGE_SCOPES.CURRENT_TASK }));
  const unassigned = mark(partition.unassigned, false).map((d) => ({ ...d, scope: PACKAGE_SCOPES.UNASSIGNED }));
  const others = mark(partition.other_tasks, false).map((d) => ({ ...d, scope: PACKAGE_SCOPES.OTHER_TASKS }));
  return {
    current_task: current,
    unassigned,
    other_tasks: others,
    all_device: [...current, ...unassigned, ...others],
  };
}

export function draftsForScope(partition = {}, scope = PACKAGE_SCOPES.CURRENT_TASK) {
  if (scope === PACKAGE_SCOPES.ALL_DEVICE) return partition.all_device || [];
  if (scope === PACKAGE_SCOPES.UNASSIGNED) return partition.unassigned || [];
  if (scope === PACKAGE_SCOPES.OTHER_TASKS) return partition.other_tasks || [];
  return partition.current_task || [];
}

export function filterDraftsForActiveContext(drafts = [], { taskLabel = null, grid = null } = {}) {
  const partitioned = partitionDraftsByScope(drafts, { taskLabel, grid });
  const warnings = [];
  if (partitioned.unassigned.length) {
    warnings.push(`${partitioned.unassigned.length} unassigned package(s) visible but not auto-selected.`);
  }
  if (partitioned.other_tasks.length) {
    warnings.push(`${partitioned.other_tasks.length} package(s) from other task/grid visible but not auto-selected.`);
  }
  return {
    matched: partitioned.current_task,
    others: [...partitioned.unassigned, ...partitioned.other_tasks],
    unassigned: partitioned.unassigned,
    otherTasks: partitioned.other_tasks,
    all: partitioned.all_device,
    partitioned,
    warnings,
  };
}

export function buildUploadAssociation({
  packageId = null,
  sessionId = null,
  originalTask = null,
  originalGrid = null,
  currentTask = null,
  currentGrid = null,
} = {}) {
  if (isUnassignedTaskLabel(currentTask)) {
    return { ok: false, reason: "ambiguous_no_current_task" };
  }
  if (!cleanText(packageId) && !cleanText(sessionId)) {
    return { ok: false, reason: "ambiguous_missing_package_identity" };
  }
  return {
    ok: true,
    association: {
      kind: "upload_association",
      originalImmutable: true,
      packageId: cleanText(packageId),
      sessionId: cleanText(sessionId),
      originalTask: cleanText(originalTask),
      originalGrid: cleanText(originalGrid),
      associatedTask: cleanText(currentTask),
      associatedGrid: cleanText(currentGrid),
      associatedAtIso: new Date().toISOString(),
    },
  };
}

export function restoreSelectedIdentities(drafts = [], selectedIds = []) {
  const set = new Set((selectedIds || []).map((id) => String(id)));
  if (!set.size) return drafts;
  return drafts.map((draft) => {
    const id = durablePackageIdentity(draft);
    return { ...draft, selected: Boolean(id && set.has(id)) };
  });
}

export function summarizeDraftForUi(draft = {}) {
  const started = draft.startedAt ? new Date(draft.startedAt) : null;
  const timeLabel = started && !Number.isNaN(started.getTime())
    ? started.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  const status = String(draft.status || "").toLowerCase();
  const session = draft.session || {};
  const attempted = session.appAttemptedIterations;
  const completed = session.appCompletedIterations;
  const failed = session.appFailedIterations;
  let detail;
  if (draft.scenarioKey === "ookla" || /ookla/i.test(draft.label)) {
    const n = (session.appOoklaEvidenceIterations || []).length;
    detail = n ? `${n} external result${n === 1 ? "" : "s"}` : (status || "External evidence");
  } else if (draft.scenarioKey === "fcc" || /fcc/i.test(draft.label)) {
    const n = (session.appFccEvidenceIterations || []).length;
    detail = n ? `${n} external result${n === 1 ? "" : "s"}` : (status || "External evidence");
  } else if (String(session.appRunMode || "").toLowerCase() === "continuous") {
    detail = completed != null ? `${completed} Completed · Continuous` : (status || "Continuous");
  } else if (attempted != null || completed != null) {
    detail = `${completed ?? 0} / ${attempted ?? "—"} Complete${failed ? ` · ${failed} failed` : ""}`;
  } else {
    detail = status || "Saved";
  }
  return { timeLabel, detail, statusLabel: status || "saved" };
}

export default {
  listSavedReportPackages,
  hydrateDiscoveredPackage,
  buildUnifiedDraftFromSession,
  groupDraftsByTaskGrid,
  filterDraftsForActiveContext,
  summarizeDraftForUi,
  classifyPackageKind,
  PACKAGE_SCOPES,
  classifyDraftScope,
  partitionDraftsByScope,
  applyScopeAutoSelection,
  draftsForScope,
  durablePackageIdentity,
  dedupeDraftsByIdentity,
  buildUploadAssociation,
  restoreSelectedIdentities,
};
