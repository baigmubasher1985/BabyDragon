/**
 * F10C2 CR1-C — task-level computed QC outcome (pure).
 * Does not rewrite per-run acceptance snapshots. Fail closed when
 * required-scenario configuration is not persisted.
 */

import { scenarioLabel } from "../models/fieldResultTypes.js";

export const TASK_FAIL_REASONS = Object.freeze({
  MISSING_REQUIRED: "Missing required scenario",
  UPLOAD_INCOMPLETE: "Upload incomplete",
  PROCESSING_PENDING: "Processing pending",
  ACCEPTANCE_INCOMPLETE: "Acceptance incomplete",
  THRESHOLD_FAILURE: "Threshold failure",
});

export const F10C2_P4BU_E2E_REQUIRED_SCENARIOS = Object.freeze(["native_http", "iperf3"]);

export const F10C2_P4BU_E2E_OPTIONAL_SCENARIOS = Object.freeze([
  "voice_mo",
  "voice_mt",
  "ftp",
  "ookla_app",
  "fcc_app",
  "rf_data",
  "combined",
]);

const KNOWN_SCENARIOS = new Set([
  "native_http",
  "ftp",
  "iperf3",
  "ookla",
  "ookla_app",
  "fcc",
  "fcc_app",
  "rf_data",
  "rf_only",
  "voice_mo",
  "voice_mt",
  "combined",
  "unified_field_report",
]);

const SCENARIO_ALIASES = Object.freeze({
  http: "native_http",
  nativehttp: "native_http",
  "native http": "native_http",
  "native-http": "native_http",
  iperf: "iperf3",
  "iperf-3": "iperf3",
  ookla: "ookla_app",
  fcc: "fcc_app",
  rf: "rf_data",
  "rf-only": "rf_data",
  rf_only: "rf_data",
  mo: "voice_mo",
  "voice-mo": "voice_mo",
  mt: "voice_mt",
  "voice-mt": "voice_mt",
});

function clean(value) {
  return String(value || "").trim().toLowerCase();
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

export function normalizeScenarioKey(value) {
  const raw = clean(value).replace(/_/g, "-");
  const spaced = raw.replace(/[\s_]+/g, " ");
  const compact = raw.replace(/[\s_-]/g, "");
  if (SCENARIO_ALIASES[spaced]) return SCENARIO_ALIASES[spaced];
  if (SCENARIO_ALIASES[compact]) return SCENARIO_ALIASES[compact];
  if (SCENARIO_ALIASES[raw]) return SCENARIO_ALIASES[raw];
  const underscored = clean(value).replace(/[-\s]+/g, "_");
  if (KNOWN_SCENARIOS.has(underscored)) return underscored === "ookla" ? "ookla_app" : underscored === "fcc" ? "fcc_app" : underscored;
  return underscored || null;
}

function parseScenarioList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return unique(raw.map((item) => {
      if (typeof item === "string") return normalizeScenarioKey(item);
      if (item && typeof item === "object") {
        if (item.required === false || item.optional === true) return null;
        return normalizeScenarioKey(item.scenario_type || item.type || item.key || item.id || item.name);
      }
      return null;
    }));
  }
  if (typeof raw === "object") {
    const required = raw.required || raw.required_scenarios || raw.scenarios;
    if (required) return parseScenarioList(required);
  }
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return [];
    if (text.startsWith("[") || text.startsWith("{")) {
      try {
        return parseScenarioList(JSON.parse(text));
      } catch {
        /* fall through to delimited parse */
      }
    }
    return unique(text.split(/[,;/|]+/).map((part) => normalizeScenarioKey(part)).filter((key) => KNOWN_SCENARIOS.has(key)));
  }
  return [];
}

export function isF10C2P4BuE2ETask(task = {}, project = {}) {
  const blob = [
    task.target_name,
    task.name,
    task.title,
    task.grid_name,
    task.notes,
    project.name,
    task.test_type,
    task.testing_type,
    project.testing_type,
  ].map((value) => String(value || "")).join(" ");
  return /F10C2-P4BU-E2E/i.test(blob);
}

/**
 * Prefer persisted task/project required-scenario config.
 * Fail closed when none exists, except the documented F10C2-P4BU-E2E overlay:
 * Native HTTP + iPerf3 required; MO/MT not required unless combined is configured.
 */
export function resolveRequiredScenarios({ task = {}, project = {} } = {}) {
  const persistedSources = [
    task.required_scenarios,
    task.required_scenario_types,
    task.scenario_requirements,
    task.acceptance_requirements,
    task.test_scope,
    project.required_scenarios,
    project.required_scenario_types,
    project.scenario_requirements,
  ];
  for (const source of persistedSources) {
    const required = parseScenarioList(source);
    if (required.length > 0) {
      return {
        ok: true,
        required,
        optional: [],
        source: "persisted_config",
        failClosed: false,
      };
    }
  }

  const typeBlob = task.test_type || task.testing_type || project.testing_type || "";
  const fromType = parseScenarioList(typeBlob).filter((key) => KNOWN_SCENARIOS.has(key));
  if (fromType.length > 0) {
    return {
      ok: true,
      required: fromType,
      optional: [],
      source: "test_type",
      failClosed: false,
    };
  }

  if (isF10C2P4BuE2ETask(task, project)) {
    return {
      ok: true,
      required: [...F10C2_P4BU_E2E_REQUIRED_SCENARIOS],
      optional: [...F10C2_P4BU_E2E_OPTIONAL_SCENARIOS],
      source: "f10c2_p4bu_e2e_documented",
      failClosed: false,
      note: "Documented F10C2-P4BU-E2E required set: Native HTTP + iPerf3. MO/MT not required unless combined is configured.",
    };
  }

  return {
    ok: false,
    required: [],
    optional: [],
    source: "missing",
    failClosed: true,
    note: "Required-scenario configuration was not persisted on the task/project. Fail closed — do not invent requirements.",
  };
}

function runTimestamp(run) {
  const parsed = Date.parse(run?.ended_at || run?.started_at || run?.created_at || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isSupersededRun(run) {
  if (!run) return false;
  if (run.superseded === true || run.is_superseded === true) return true;
  const status = clean(run.run_status || run.processing_state);
  if (status === "superseded" || status === "replaced") return true;
  if (run.replaced_by) return true;
  return false;
}

/**
 * Latest valid non-superseded run per scenario. Earlier retries are not counted.
 */
export function pickLatestValidRunPerScenario(runs = []) {
  const byScenario = new Map();
  const sorted = [...(runs || [])].sort((a, b) => runTimestamp(b) - runTimestamp(a));
  for (const run of sorted) {
    if (isSupersededRun(run)) continue;
    const key = normalizeScenarioKey(run.scenario_type);
    if (!key) continue;
    if (!byScenario.has(key)) byScenario.set(key, run);
  }
  return byScenario;
}

function scenarioState(run) {
  if (!run) {
    return {
      status: "missing",
      reason: TASK_FAIL_REASONS.MISSING_REQUIRED,
      verdict: null,
      run: null,
    };
  }
  const upload = clean(run.upload_state);
  if (upload && upload !== "uploaded") {
    return {
      status: "incomplete",
      reason: TASK_FAIL_REASONS.UPLOAD_INCOMPLETE,
      verdict: run.acceptance_verdict || run.acceptance?.overall_verdict || null,
      run,
    };
  }
  const processing = clean(run.processing_state);
  if (processing === "pending" || processing === "processing") {
    return {
      status: "processing",
      reason: TASK_FAIL_REASONS.PROCESSING_PENDING,
      verdict: run.acceptance_verdict || run.acceptance?.overall_verdict || null,
      run,
    };
  }
  const verdict = run.acceptance_verdict || run.acceptance?.overall_verdict || null;
  if (!verdict || verdict === "NOT_EVALUATED" || verdict === "INCOMPLETE") {
    return {
      status: "incomplete",
      reason: TASK_FAIL_REASONS.ACCEPTANCE_INCOMPLETE,
      verdict: verdict || "NOT_EVALUATED",
      run,
    };
  }
  if (verdict === "FAIL") {
    return {
      status: "failed",
      reason: TASK_FAIL_REASONS.THRESHOLD_FAILURE,
      verdict,
      run,
    };
  }
  if (verdict === "PASS") {
    return {
      status: "passed",
      reason: null,
      verdict,
      run,
    };
  }
  return {
    status: "incomplete",
    reason: TASK_FAIL_REASONS.ACCEPTANCE_INCOMPLETE,
    verdict,
    run,
  };
}

function deriveRedrive(qcDecision, runs) {
  if (qcDecision === "Needs Re-drive") return "required";
  if ((runs || []).some((run) => run.redrive_needed || run.redrive_task_id)) return "linked";
  return "none";
}

function matchingTaskRuns(runs, task) {
  const taskId = task?.id;
  const names = unique([task?.target_name, task?.name, task?.title, task?.grid_name]);
  return (runs || []).filter((run) => {
    if (taskId && (run.task_id === taskId || String(run.task_id) === String(taskId))) return true;
    if (names.length && names.some((name) => clean(run.task_name) === clean(name))) return true;
    return false;
  });
}

/**
 * @returns {{
 *   computed: 'PASS'|'FAIL',
 *   reason: string|null,
 *   required_count: number,
 *   passed: number,
 *   failed: number,
 *   missing_incomplete: number,
 *   scenarios: object[],
 *   config: object,
 *   qc_decision: string|null,
 *   override: object|null,
 *   redrive_status: string,
 * }}
 */
export function computeTaskLevelQcOutcome({
  task = {},
  project = {},
  runs = [],
  qcDecision = null,
  override = null,
} = {}) {
  const config = resolveRequiredScenarios({ task, project });
  const taskRuns = matchingTaskRuns(runs, task);
  const latest = pickLatestValidRunPerScenario(taskRuns);

  if (config.failClosed || !config.ok) {
    return {
      computed: "FAIL",
      reason: TASK_FAIL_REASONS.MISSING_REQUIRED,
      required_count: 0,
      passed: 0,
      failed: 0,
      missing_incomplete: 0,
      scenarios: [],
      config,
      qc_decision: qcDecision || null,
      override: retainOverride(null, "FAIL", qcDecision, override),
      redrive_status: deriveRedrive(qcDecision, taskRuns),
    };
  }

  const scenarios = config.required.map((type) => {
    const run = latest.get(type) || latest.get(normalizeScenarioKey(type)) || null;
    const state = scenarioState(run);
    return {
      scenario_type: type,
      scenario_label: scenarioLabel(type),
      required: true,
      ...state,
    };
  });

  const passed = scenarios.filter((row) => row.status === "passed").length;
  const failed = scenarios.filter((row) => row.status === "failed").length;
  const missingIncomplete = scenarios.filter((row) => row.status !== "passed" && row.status !== "failed").length;

  let computed = "FAIL";
  let reason = TASK_FAIL_REASONS.ACCEPTANCE_INCOMPLETE;
  if (failed > 0) {
    computed = "FAIL";
    reason = TASK_FAIL_REASONS.THRESHOLD_FAILURE;
  } else if (scenarios.some((row) => row.status === "missing")) {
    computed = "FAIL";
    reason = TASK_FAIL_REASONS.MISSING_REQUIRED;
  } else if (scenarios.some((row) => row.reason === TASK_FAIL_REASONS.UPLOAD_INCOMPLETE)) {
    computed = "FAIL";
    reason = TASK_FAIL_REASONS.UPLOAD_INCOMPLETE;
  } else if (scenarios.some((row) => row.reason === TASK_FAIL_REASONS.PROCESSING_PENDING)) {
    computed = "FAIL";
    reason = TASK_FAIL_REASONS.PROCESSING_PENDING;
  } else if (missingIncomplete > 0) {
    computed = "FAIL";
    reason = TASK_FAIL_REASONS.ACCEPTANCE_INCOMPLETE;
  } else if (config.required.length > 0 && passed === config.required.length) {
    computed = "PASS";
    reason = null;
  }

  return {
    computed,
    reason,
    required_count: config.required.length,
    passed,
    failed,
    missing_incomplete: missingIncomplete,
    scenarios,
    config,
    qc_decision: qcDecision || null,
    override: retainOverride(override, computed, qcDecision, override),
    redrive_status: deriveRedrive(qcDecision, taskRuns),
  };
}

function retainOverride(explicit, computed, qcDecision, overrideInput) {
  const source = explicit || overrideInput;
  if (source && (source.override_verdict || source.verdict)) {
    return {
      computed_verdict: computed,
      override_verdict: source.override_verdict || source.verdict,
      reviewer: source.reviewer || source.reviewer_name || source.actor_id || null,
      timestamp: source.timestamp || source.created_at || source.reviewed_at || null,
      reason: source.reason || source.override_reason || null,
    };
  }
  if (!qcDecision) return null;
  const mapped = qcDecision === "QC Passed" ? "PASS" : qcDecision === "QC Failed" ? "FAIL" : qcDecision;
  if (mapped === computed || mapped === `QC ${computed === "PASS" ? "Passed" : "Failed"}`) return null;
  if (qcDecision === "QC Passed" && computed === "PASS") return null;
  if (qcDecision === "QC Failed" && computed === "FAIL") return null;
  if (qcDecision === "Waiting for Logs" || qcDecision === "Waiting for Processing") return null;
  return {
    computed_verdict: computed,
    override_verdict: qcDecision,
    reviewer: null,
    timestamp: null,
    reason: null,
    note: "Existing QC decision is displayed separately and does not rewrite computed acceptance.",
  };
}

export default {
  TASK_FAIL_REASONS,
  F10C2_P4BU_E2E_REQUIRED_SCENARIOS,
  resolveRequiredScenarios,
  pickLatestValidRunPerScenario,
  computeTaskLevelQcOutcome,
  isF10C2P4BuE2ETask,
  normalizeScenarioKey,
};
