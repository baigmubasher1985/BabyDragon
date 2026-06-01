import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const REPORT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "projects", label: "Projects" },
  { id: "tasks", label: "Tasks / QC" },
  { id: "grids", label: "Grids" },
  { id: "fe", label: "FE Activity" },
  { id: "issues", label: "Issues / Re-drive" },
  { id: "evidence", label: "Evidence / Logs" },
  { id: "routes", label: "Routes" },
];

const REPORT_BRAND = {
  logo: "🐉",
  name: "BabyDragon",
  company: "MobbiTech Global LLC",
  subtitle: "RF Drive Testing Management Platform",
};

const REPORT_PERIODS = [
  { id: "all", label: "All Time" },
  { id: "daily", label: "Daily - Today" },
  { id: "weekly", label: "Weekly - This Week" },
  { id: "monthly", label: "Monthly - This Month" },
];

const DECISION_ORDER = [
  "QC Passed",
  "QC Failed",
  "Needs Re-drive",
  "Waiting for Logs",
  "Log Naming Issue",
  "Missing Evidence",
  "Not Reviewed",
];

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function formatStatus(value) {
  const text = String(value || "Not Set").replace(/_/g, " ");
  return text.replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value) {
  if (!value) return "N/A";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "N/A";
  }
}

function shortDate(value) {
  if (!value) return "N/A";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return "N/A";
  }
}

function startOfLocalDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfLocalDay(date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function startOfLocalWeek(date) {
  const next = startOfLocalDay(date);
  const day = next.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + offset);
  return next;
}

function endOfLocalWeek(date) {
  const next = startOfLocalWeek(date);
  next.setDate(next.getDate() + 6);
  return endOfLocalDay(next);
}

function startOfLocalMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function endOfLocalMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function getReportPeriodRange(period) {
  const now = new Date();

  if (period === "daily" || period === "today") {
    return { start: startOfLocalDay(now), end: endOfLocalDay(now) };
  }

  if (period === "weekly" || period === "week") {
    return { start: startOfLocalWeek(now), end: endOfLocalWeek(now) };
  }

  if (period === "monthly" || period === "month") {
    return { start: startOfLocalMonth(now), end: endOfLocalMonth(now) };
  }

  return null;
}

function getReportPeriodLabel(period) {
  const range = getReportPeriodRange(period);
  const baseLabel = REPORT_PERIODS.find((item) => item.id === period)?.label || "All Time";

  if (!range) return baseLabel;

  return `${baseLabel} (${range.start.toLocaleDateString()} - ${range.end.toLocaleDateString()})`;
}

function getReportPeriodSuffix(period) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");

  if (period === "daily" || period === "today") return `Daily_${yyyy}${mm}${dd}`;
  if (period === "weekly" || period === "week") return `Weekly_${yyyy}${mm}${dd}`;
  if (period === "monthly" || period === "month") return `Monthly_${yyyy}${mm}`;
  return "All_Time";
}


function getDateRangeFromDashboardFilters(filters = {}) {
  const mode = filters?.dateMode || "all";
  const now = new Date();

  if (mode === "today") return { start: startOfLocalDay(now), end: endOfLocalDay(now), label: "Today", suffix: "Today" };
  if (mode === "week") return { start: startOfLocalWeek(now), end: endOfLocalWeek(now), label: "This Week", suffix: "This_Week" };
  if (mode === "month") return { start: startOfLocalMonth(now), end: endOfLocalMonth(now), label: "This Month", suffix: "This_Month" };

  if (mode === "custom") {
    const start = filters?.dateFrom ? startOfLocalDay(new Date(filters.dateFrom)) : null;
    const end = filters?.dateTo ? endOfLocalDay(new Date(filters.dateTo)) : null;

    if (start && Number.isNaN(start.getTime())) return null;
    if (end && Number.isNaN(end.getTime())) return null;

    if (start || end) {
      const labelStart = start ? start.toLocaleDateString() : "Start";
      const labelEnd = end ? end.toLocaleDateString() : "Today";
      const suffixStart = start ? start.toISOString().slice(0, 10).replace(/-/g, "") : "Start";
      const suffixEnd = end ? end.toISOString().slice(0, 10).replace(/-/g, "") : "Today";
      return {
        start,
        end,
        label: `Custom (${labelStart} - ${labelEnd})`,
        suffix: `Custom_${suffixStart}_${suffixEnd}`,
      };
    }
  }

  return null;
}

function getEffectiveReportRange(period, filters = {}) {
  return getDateRangeFromDashboardFilters(filters) || getReportPeriodRange(period);
}

function getEffectiveReportLabel(period, filters = {}) {
  const dashboardRange = getDateRangeFromDashboardFilters(filters);
  if (dashboardRange?.label) return dashboardRange.label;
  return getReportPeriodLabel(period);
}

function getEffectiveReportSuffix(period, filters = {}) {
  const dashboardRange = getDateRangeFromDashboardFilters(filters);
  if (dashboardRange?.suffix) return dashboardRange.suffix;
  return getReportPeriodSuffix(period);
}

function isTaskInEffectiveReportPeriod(task, period, filters = {}) {
  const range = getEffectiveReportRange(period, filters);
  if (!range) return true;

  const dateValue = getTaskReportDate(task);
  if (!dateValue) return false;

  const taskDate = new Date(dateValue);
  if (Number.isNaN(taskDate.getTime())) return false;

  if (range.start && taskDate < range.start) return false;
  if (range.end && taskDate > range.end) return false;
  return true;
}

function getTaskReportDate(task) {
  return (
    task.completed_at ||
    task.completed_date ||
    task.updated_at ||
    task.started_at ||
    task.start_time ||
    task.created_at ||
    task.due_date ||
    null
  );
}

function isTaskInReportPeriod(task, period) {
  const range = getReportPeriodRange(period);
  if (!range) return true;

  const dateValue = getTaskReportDate(task);
  if (!dateValue) return false;

  const taskDate = new Date(dateValue);
  if (Number.isNaN(taskDate.getTime())) return false;

  return taskDate >= range.start && taskDate <= range.end;
}

function yesNo(value) {
  return value ? "Yes" : "No";
}

function getTaskFEId(task) {
  return (
    task.assigned_to ||
    task.assigned_fe ||
    task.assigned_fe_id ||
    task.fe_id ||
    task.user_id ||
    null
  );
}

function getTaskTitle(task) {
  return (
    task.target_name ||
    task.task_name ||
    task.name ||
    task.title ||
    task.grid_name ||
    task.site_name ||
    task.cluster_name ||
    "Task"
  );
}

function getTaskMarket(task, project, grids = []) {
  return (
    task.market ||
    project?.market ||
    grids.find((grid) => grid.market)?.market ||
    "N/A"
  );
}

function getProjectName(project) {
  return project?.name || "No Project";
}

function getFEName(fe, fallbackId = "") {
  return fe?.full_name || fe?.name || fe?.email || fallbackId || "Unassigned";
}

function makeQcKey(taskId, gridId) {
  return `${taskId}__${gridId || "task"}`;
}

function isChecklistDone(row) {
  return (
    row.is_done === true ||
    row.is_checked === true ||
    row.checked === true ||
    row.completed === true ||
    row.value === true ||
    normalize(row.status) === "done" ||
    normalize(row.status) === "completed"
  );
}

function getChecklistLabel(row) {
  return (
    row.label ||
    row.item_label ||
    row.checklist_item ||
    row.title ||
    row.name ||
    "Checklist item"
  );
}

function hasPhoto(update) {
  return !!(
    update.image_url ||
    update.photo_url ||
    update.evidence_url ||
    update.file_url ||
    update.attachment_url
  );
}

function getIssueTitle(issue) {
  return issue.issue_type || issue.type || issue.category || "Issue";
}

function getDecisionClass(decision) {
  const value = String(decision || "Not Reviewed");
  if (value === "QC Passed") return "bdr-badge bdr-badge-pass";
  if (value === "QC Failed") return "bdr-badge bdr-badge-fail";
  if (value === "Needs Re-drive") return "bdr-badge bdr-badge-redrive";
  if (value === "Log Naming Issue") return "bdr-badge bdr-badge-warning";
  if (value === "Missing Evidence") return "bdr-badge bdr-badge-warning";
  if (value === "Waiting for Logs") return "bdr-badge bdr-badge-waiting";
  return "bdr-badge bdr-badge-muted";
}

function getStatusClass(status) {
  const value = normalize(status);
  if (value === "completed") return "bdr-status bdr-status-completed";
  if (value === "in_progress" || value === "in progress") return "bdr-status bdr-status-progress";
  if (value === "assigned") return "bdr-status bdr-status-assigned";
  if (value === "pending") return "bdr-status bdr-status-pending";
  return "bdr-status";
}

function csvEscape(value) {
  const safeValue = Array.isArray(value) ? value.join("; ") : value ?? "";
  const text = String(safeValue).replace(/\r?\n|\r/g, " ");
  if (/[",]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadCsv(filename, rows, columns) {
  const header = columns.map((column) => csvEscape(column.label)).join(",");
  const body = rows
    .map((row) =>
      columns
        .map((column) => csvEscape(column.get ? column.get(row) : row[column.key]))
        .join(",")
    )
    .join("\n");

  const csv = `${header}\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function getExportValue(row, column) {
  const value = column.get ? column.get(row) : row[column.key];
  if (Array.isArray(value)) return value.join("; ");
  if (value === null || value === undefined || value === false) return value === false ? "No" : "";
  if (value === true) return "Yes";
  return String(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function downloadWordHtml(filename, title, summaryRows, rows, columns, periodLabel) {
  const summaryHtml = summaryRows
    .map((item) => `
      <tr>
        <td>${escapeHtml(item.label)}</td>
        <td><strong>${escapeHtml(item.value)}</strong></td>
      </tr>
    `)
    .join("");

  const headerHtml = columns
    .map((column) => `<th>${escapeHtml(column.label)}</th>`)
    .join("");

  const bodyHtml = rows
    .map((row) => `
      <tr>
        ${columns.map((column) => `<td>${escapeHtml(getExportValue(row, column))}</td>`).join("")}
      </tr>
    `)
    .join("");

  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111827; margin: 28px; }
          .brand { display: table; width: 100%; border-bottom: 3px solid #2563eb; padding-bottom: 12px; margin-bottom: 18px; }
          .brand-left { display: table-cell; vertical-align: middle; }
          .logo { display: inline-block; width: 42px; height: 42px; border-radius: 12px; background: #dbeafe; text-align: center; line-height: 42px; font-size: 24px; margin-right: 10px; }
          .brand-name { font-size: 24px; font-weight: 800; color: #0f172a; }
          .brand-subtitle { color: #475569; font-size: 12px; margin-top: 2px; }
          .brand-right { display: table-cell; text-align: right; color: #475569; font-size: 12px; vertical-align: middle; }
          h1 { color: #0f172a; margin: 0 0 4px; }
          p { color: #475569; }
          table { width: 100%; border-collapse: collapse; margin-top: 14px; }
          th { background: #dbeafe; color: #0f172a; text-transform: uppercase; font-size: 11px; }
          td, th { border: 1px solid #cbd5e1; padding: 8px; font-size: 12px; vertical-align: top; }
          .note { font-weight: bold; color: #1e40af; }
        </style>
      </head>
      <body>
        <div class="brand">
          <div class="brand-left">
            <span class="logo">${REPORT_BRAND.logo}</span>
            <span class="brand-name">${REPORT_BRAND.name}</span>
            <div class="brand-subtitle">${REPORT_BRAND.company} | ${REPORT_BRAND.subtitle}</div>
          </div>
          <div class="brand-right">
            <div><strong>Report Period:</strong> ${escapeHtml(periodLabel || "All Time")}</div>
            <div><strong>Generated:</strong> ${escapeHtml(new Date().toLocaleString())}</div>
          </div>
        </div>
        <h1>${escapeHtml(title)}</h1>
        <p class="note">Operational report only. No RF log/KPI processing included.</p>
        <table>${summaryHtml}</table>
        <table>
          <thead><tr>${headerHtml}</tr></thead>
          <tbody>${bodyHtml || `<tr><td colspan="${columns.length}">No records found.</td></tr>`}</tbody>
        </table>
      </body>
    </html>
  `;

  const blob = new Blob([html], { type: "application/msword;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function ProgressBar({ percent }) {
  return (
    <div className="bdr-progress">
      <div style={{ width: `${Math.min(Math.max(percent || 0, 0), 100)}%` }} />
    </div>
  );
}

export default function Reports({
  user,
  filters = {},
  projects = [],
  tasks = [],
  fieldEngineers = [],
}) {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [searchText, setSearchText] = useState("");
  const [localDecisionFilter, setLocalDecisionFilter] = useState("All");
  const [reportPeriod, setReportPeriod] = useState("all");
  const [qcRows, setQcRows] = useState([]);
  const [taskGridRows, setTaskGridRows] = useState([]);
  const [checklistRows, setChecklistRows] = useState([]);
  const [issueRows, setIssueRows] = useState([]);
  const [updateRows, setUpdateRows] = useState([]);
  const [routeRows, setRouteRows] = useState([]);
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showProjectSnapshot, setShowProjectSnapshot] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  useEffect(() => {
    loadReportData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.length]);

  async function safeSelect(requestFn, fallback = []) {
    const { data, error } = await requestFn();

    if (error) {
      console.warn("Reports optional query skipped:", error.message);
      return fallback;
    }

    return data || fallback;
  }

  async function firstWorking(requestFns, fallback = []) {
    for (const fn of requestFns) {
      const { data, error } = await fn();
      if (!error) return data || fallback;
    }

    return fallback;
  }

  async function loadReportData() {
    setLoading(true);

    const taskIds = tasks.map((task) => task.id).filter(Boolean);

    if (taskIds.length === 0) {
      setQcRows([]);
      setTaskGridRows([]);
      setChecklistRows([]);
      setIssueRows([]);
      setUpdateRows([]);
      setRouteRows([]);
      setLastLoadedAt(new Date());
      setLoading(false);
      return;
    }

    const [qcData, taskGridData, checklistData, issueData, updateData, routeData] =
      await Promise.all([
        safeSelect(() => supabase.from("qc_reviews").select("*").in("task_id", taskIds)),

        firstWorking([
          () =>
            supabase
              .from("task_grids")
              .select("task_id, grid_id, grids(*)")
              .in("task_id", taskIds),
          () => supabase.from("task_grids").select("*").in("task_id", taskIds),
        ]),

        firstWorking([
          () =>
            supabase
              .from("task_checklist_items")
              .select("*")
              .in("task_id", taskIds)
              .order("item_order", { ascending: true })
              .order("created_at", { ascending: true }),
          () => supabase.from("task_checklist").select("*").in("task_id", taskIds),
          () => supabase.from("task_checklists").select("*").in("task_id", taskIds),
        ]),

        firstWorking([
          () => supabase.from("task_issue_reports").select("*").in("task_id", taskIds),
          () => supabase.from("task_issues").select("*").in("task_id", taskIds),
        ]),

        safeSelect(() =>
          supabase
            .from("task_updates")
            .select("*")
            .in("task_id", taskIds)
            .order("created_at", { ascending: false })
        ),

        firstWorking([
          () => supabase.from("saved_routes").select("*"),
          () => supabase.from("routes").select("*"),
          () => supabase.from("generated_routes").select("*"),
        ]),
      ]);

    setQcRows(qcData);
    setTaskGridRows(taskGridData);
    setChecklistRows(checklistData);
    setIssueRows(issueData);
    setUpdateRows(updateData);
    setRouteRows(routeData);
    setLastLoadedAt(new Date());
    setLoading(false);
  }

  const reportPeriodLabel = useMemo(
    () => getEffectiveReportLabel(reportPeriod, filters),
    [reportPeriod, filters]
  );

  const projectMap = useMemo(() => {
    const map = {};

    projects.forEach((project) => {
      if (project?.id) map[project.id] = project;
    });

    tasks.forEach((task) => {
      if (task?.projects?.id) map[task.projects.id] = task.projects;
    });

    return map;
  }, [projects, tasks]);

  const feMap = useMemo(() => {
    const map = {};

    fieldEngineers.forEach((fe) => {
      if (fe?.id) map[fe.id] = fe;
      if (fe?.user_id) map[fe.user_id] = fe;
    });

    return map;
  }, [fieldEngineers]);

  const taskMap = useMemo(() => {
    const map = {};
    tasks.forEach((task) => {
      if (task?.id) map[task.id] = task;
    });
    return map;
  }, [tasks]);

  const taskGridMap = useMemo(() => {
    const map = {};

    taskGridRows.forEach((row) => {
      if (!row.task_id) return;
      if (!map[row.task_id]) map[row.task_id] = [];

      map[row.task_id].push({
        id: row.grid_id || row.grids?.id || row.grid?.id || null,
        name:
          row.grids?.name ||
          row.grid?.name ||
          row.grid_name ||
          row.name ||
          row.grid_id ||
          "Assigned Grid",
        market: row.grids?.market || row.grid?.market || row.market || "",
        raw: row,
      });
    });

    return map;
  }, [taskGridRows]);

  const checklistMap = useMemo(() => {
    const map = {};
    checklistRows.forEach((row) => {
      if (!row.task_id) return;
      if (!map[row.task_id]) map[row.task_id] = [];
      map[row.task_id].push(row);
    });
    return map;
  }, [checklistRows]);

  const issueMap = useMemo(() => {
    const map = {};
    issueRows.forEach((row) => {
      if (!row.task_id) return;
      if (!map[row.task_id]) map[row.task_id] = [];
      map[row.task_id].push(row);
    });
    return map;
  }, [issueRows]);

  const updateMap = useMemo(() => {
    const map = {};
    updateRows.forEach((row) => {
      if (!row.task_id) return;
      if (!map[row.task_id]) map[row.task_id] = [];
      map[row.task_id].push(row);
    });
    return map;
  }, [updateRows]);

  const qcByTask = useMemo(() => {
    const map = {};
    qcRows.forEach((row) => {
      if (!row.task_id) return;
      if (!map[row.task_id]) map[row.task_id] = [];
      map[row.task_id].push(row);
    });
    return map;
  }, [qcRows]);

  const qcByTaskGrid = useMemo(() => {
    const map = {};
    qcRows.forEach((row) => {
      if (!row.task_id) return;
      map[makeQcKey(row.task_id, row.grid_id)] = row;
    });
    return map;
  }, [qcRows]);

  function aggregateQc(taskId, gridId = null) {
    const defaultQc = {
      qc_decision: "Not Reviewed",
      log_received: false,
      log_naming_correct: false,
      required_evidence_received: false,
      redrive_needed: false,
      qc_notes: "",
      reviewed_at: null,
      reviewer_id: null,
    };

    if (gridId) {
      return qcByTaskGrid[makeQcKey(taskId, gridId)] || defaultQc;
    }

    const rows = qcByTask[taskId] || [];
    if (rows.length === 0) return defaultQc;
    if (rows.length === 1) return rows[0];

    const decisions = rows.map((row) => row.qc_decision || "Not Reviewed");
    let qcDecision = rows[0].qc_decision || "Not Reviewed";

    const priority = [
      "Needs Re-drive",
      "QC Failed",
      "Missing Evidence",
      "Log Naming Issue",
      "Waiting for Logs",
      "Not Reviewed",
      "QC Passed",
    ];

    for (const decision of priority) {
      if (decisions.includes(decision)) {
        qcDecision = decision;
        break;
      }
    }

    return {
      ...rows[0],
      qc_decision: qcDecision,
      log_received: rows.every((row) => !!row.log_received),
      log_naming_correct: rows.every((row) => !!row.log_naming_correct),
      required_evidence_received: rows.every((row) => !!row.required_evidence_received),
      redrive_needed:
        rows.some((row) => !!row.redrive_needed) || decisions.includes("Needs Re-drive"),
      qc_notes: rows.map((row) => row.qc_notes).filter(Boolean).join(" | "),
      reviewed_at:
        rows
          .map((row) => row.reviewed_at)
          .filter(Boolean)
          .sort()
          .reverse()[0] || null,
    };
  }

  function checklistProgress(taskId) {
    const rows = checklistMap[taskId] || [];
    const total = rows.length;
    const done = rows.filter(isChecklistDone).length;
    const percent = total ? Math.round((done / total) * 100) : 0;

    return {
      done,
      total,
      percent,
      label: `${done}/${total}`,
      missing: rows.filter((row) => !isChecklistDone(row)).map(getChecklistLabel),
    };
  }

  const enrichedTasks = useMemo(() => {
    return tasks.map((task) => {
      const project = projectMap[task.project_id] || task.projects || {};
      const feId = getTaskFEId(task);
      const fe = feMap[feId] || {};
      const grids = taskGridMap[task.id] || [];
      const checklist = checklistProgress(task.id);
      const issues = issueMap[task.id] || [];
      const updates = updateMap[task.id] || [];
      const qc = aggregateQc(task.id);
      const market = getTaskMarket(task, project, grids);
      const photoCount = updates.filter(hasPhoto).length;

      return {
        ...task,
        taskTitle: getTaskTitle(task),
        project,
        projectName: getProjectName(project),
        customer: project.customer || task.customer || "N/A",
        testingType: project.testing_type || task.testing_type || task.test_type || "N/A",
        market,
        feId,
        fe,
        feName: getFEName(fe, feId),
        grids,
        gridNames: grids.map((grid) => grid.name).filter(Boolean),
        checklist,
        issues,
        updates,
        photoCount,
        qc,
        qcDecision: qc.qc_decision || "Not Reviewed",
        statusLabel: formatStatus(task.status),
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    });
  }, [tasks, projectMap, feMap, taskGridMap, checklistMap, issueMap, updateMap, qcRows]);

  const visibleTasks = useMemo(() => {
    const text = normalize(searchText);

    return enrichedTasks.filter((task) => {
      const matchProject = !filters.projectId || task.project_id === filters.projectId;
      const matchMarket = !filters.market || normalize(task.market) === normalize(filters.market);
      const matchStatus =
        !filters.status ||
        normalize(task.status) === normalize(filters.status) ||
        normalize(task.statusLabel) === normalize(filters.status);
      const matchFe = !filters.feId || task.feId === filters.feId;
      const matchDecision =
        localDecisionFilter === "All" || task.qcDecision === localDecisionFilter;
      const matchPeriod = isTaskInEffectiveReportPeriod(task, reportPeriod, filters);

      const haystack = [
        task.taskTitle,
        task.projectName,
        task.customer,
        task.market,
        task.feName,
        task.statusLabel,
        task.qcDecision,
        task.gridNames.join(" "),
      ]
        .join(" ")
        .toLowerCase();

      const matchSearch = !text || haystack.includes(text);

      return (
        matchProject &&
        matchMarket &&
        matchStatus &&
        matchFe &&
        matchDecision &&
        matchPeriod &&
        matchSearch
      );
    });
  }, [enrichedTasks, filters, searchText, localDecisionFilter, reportPeriod]);

  const visibleTaskIds = useMemo(
    () => new Set(visibleTasks.map((task) => task.id)),
    [visibleTasks]
  );

  const projectSummaryRows = useMemo(() => {
    const map = {};

    const seedProjects = projects.length ? projects : Object.values(projectMap);
    seedProjects.forEach((project) => {
      if (!project?.id) return;
      map[project.id] = {
        id: project.id,
        name: project.name || "Project",
        customer: project.customer || "N/A",
        market: project.market || "N/A",
        testingType: project.testing_type || "N/A",
        totalTasks: 0,
        assigned: 0,
        pending: 0,
        inProgress: 0,
        completed: 0,
        qcPassed: 0,
        qcFailed: 0,
        needsRedrive: 0,
        waitingLogs: 0,
        logNamingIssue: 0,
        missingEvidence: 0,
        notReviewed: 0,
        issues: 0,
        updates: 0,
        photos: 0,
        avgChecklist: 0,
        checklistPercentTotal: 0,
      };
    });

    visibleTasks.forEach((task) => {
      const projectId = task.project_id || "no-project";
      if (!map[projectId]) {
        map[projectId] = {
          id: projectId,
          name: task.projectName,
          customer: task.customer,
          market: task.market,
          testingType: task.testingType,
          totalTasks: 0,
          assigned: 0,
          pending: 0,
          inProgress: 0,
          completed: 0,
          qcPassed: 0,
          qcFailed: 0,
          needsRedrive: 0,
          waitingLogs: 0,
          logNamingIssue: 0,
          missingEvidence: 0,
          notReviewed: 0,
          issues: 0,
          updates: 0,
          photos: 0,
          avgChecklist: 0,
          checklistPercentTotal: 0,
        };
      }

      const row = map[projectId];
      const status = normalize(task.status);
      row.totalTasks += 1;
      if (status === "assigned") row.assigned += 1;
      if (status === "pending") row.pending += 1;
      if (status === "in_progress" || status === "in progress") row.inProgress += 1;
      if (status === "completed") row.completed += 1;

      if (task.qcDecision === "QC Passed") row.qcPassed += 1;
      if (task.qcDecision === "QC Failed") row.qcFailed += 1;
      if (task.qcDecision === "Needs Re-drive") row.needsRedrive += 1;
      if (task.qcDecision === "Waiting for Logs") row.waitingLogs += 1;
      if (task.qcDecision === "Log Naming Issue") row.logNamingIssue += 1;
      if (task.qcDecision === "Missing Evidence") row.missingEvidence += 1;
      if (task.qcDecision === "Not Reviewed") row.notReviewed += 1;

      row.issues += task.issues.length;
      row.updates += task.updates.length;
      row.photos += task.photoCount;
      row.checklistPercentTotal += task.checklist.percent;
      row.avgChecklist = row.totalTasks
        ? Math.round(row.checklistPercentTotal / row.totalTasks)
        : 0;
    });

    return Object.values(map).filter((row) => {
      const matchProject = !filters.projectId || row.id === filters.projectId;
      const matchMarket = !filters.market || normalize(row.market) === normalize(filters.market);
      return matchProject && matchMarket && (row.totalTasks > 0 || !filters.projectId);
    });
  }, [projects, projectMap, visibleTasks, filters]);

  const gridSummaryRows = useMemo(() => {
    const rows = [];

    visibleTasks.forEach((task) => {
      const grids = task.grids.length
        ? task.grids
        : [{ id: null, name: "Task-level / No Grid", market: task.market }];

      grids.forEach((grid) => {
        const qc = aggregateQc(task.id, grid.id) || task.qc;
        rows.push({
          id: `${task.id}_${grid.id || "task"}`,
          gridId: grid.id,
          taskId: task.id,
          taskTitle: task.taskTitle,
          projectName: task.projectName,
          customer: task.customer,
          market: grid.market || task.market,
          gridName: grid.name,
          feName: task.feName,
          status: task.statusLabel,
          checklist: task.checklist.label,
          checklistPercent: task.checklist.percent,
          issues: task.issues.length,
          updates: task.updates.length,
          qcDecision: qc.qc_decision || "Not Reviewed",
          logReceived: !!qc.log_received,
          logNamingCorrect: !!qc.log_naming_correct,
          evidenceReceived: !!qc.required_evidence_received,
          redriveNeeded: !!qc.redrive_needed || qc.qc_decision === "Needs Re-drive",
          reviewedAt: qc.reviewed_at,
        });
      });
    });

    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTasks, qcRows]);

  const feSummaryRows = useMemo(() => {
    const map = {};

    visibleTasks.forEach((task) => {
      const feId = task.feId || "unassigned";
      if (!map[feId]) {
        map[feId] = {
          id: feId,
          feName: task.feName,
          assignedTasks: 0,
          completedTasks: 0,
          activeTasks: 0,
          pendingTasks: 0,
          issues: 0,
          updates: 0,
          photos: 0,
          qcPassed: 0,
          qcFailed: 0,
          needsRedrive: 0,
          waitingLogs: 0,
          missingEvidence: 0,
          logNamingIssue: 0,
          avgChecklist: 0,
          checklistPercentTotal: 0,
        };
      }

      const row = map[feId];
      const status = normalize(task.status);
      row.assignedTasks += 1;
      if (status === "completed") row.completedTasks += 1;
      if (status === "in_progress" || status === "in progress") row.activeTasks += 1;
      if (status === "pending" || status === "assigned") row.pendingTasks += 1;
      row.issues += task.issues.length;
      row.updates += task.updates.length;
      row.photos += task.photoCount;
      if (task.qcDecision === "QC Passed") row.qcPassed += 1;
      if (task.qcDecision === "QC Failed") row.qcFailed += 1;
      if (task.qcDecision === "Needs Re-drive") row.needsRedrive += 1;
      if (task.qcDecision === "Waiting for Logs") row.waitingLogs += 1;
      if (task.qcDecision === "Missing Evidence") row.missingEvidence += 1;
      if (task.qcDecision === "Log Naming Issue") row.logNamingIssue += 1;
      row.checklistPercentTotal += task.checklist.percent;
      row.avgChecklist = row.assignedTasks
        ? Math.round(row.checklistPercentTotal / row.assignedTasks)
        : 0;
    });

    return Object.values(map).sort((a, b) => b.completedTasks - a.completedTasks);
  }, [visibleTasks]);

  const issueSummaryRows = useMemo(() => {
    const feIssues = issueRows
      .filter((issue) => visibleTaskIds.has(issue.task_id))
      .map((issue) => {
        const task = enrichedTasks.find((item) => item.id === issue.task_id) || {};
        return {
          id: issue.id,
          source: "FE Issue",
          issueType: getIssueTitle(issue),
          severity: issue.severity || "N/A",
          status: issue.status || "Open",
          description: issue.description || issue.notes || "",
          taskTitle: task.taskTitle || "Task",
          projectName: task.projectName || "N/A",
          market: task.market || "N/A",
          gridNames: task.gridNames?.join(", ") || "N/A",
          feName: task.feName || "N/A",
          createdAt: issue.created_at || issue.reported_at,
          latitude: issue.latitude || issue.lat || issue.gps_lat || "",
          longitude: issue.longitude || issue.lng || issue.lon || issue.gps_lng || "",
          needsRedrive:
            normalize(issue.issue_type).includes("re-drive") ||
            normalize(issue.type).includes("redrive") ||
            task.qcDecision === "Needs Re-drive",
        };
      });

    const qcRedrives = qcRows
      .filter((qc) => visibleTaskIds.has(qc.task_id))
      .filter((qc) => qc.redrive_needed || qc.qc_decision === "Needs Re-drive")
      .map((qc) => {
        const task = enrichedTasks.find((item) => item.id === qc.task_id) || {};
        const linkedText = qc.redrive_task_id ? " Re-drive task linked." : " Re-drive task not created yet.";
        return {
          id: `qc_redrive_${qc.id}`,
          source: "QC Re-drive",
          issueType: "QC Re-drive Required",
          severity: "QC",
          status: qc.redrive_task_id ? "Linked" : "QC Open",
          description: `${qc.redrive_reason || "Re-drive required"}${qc.qc_notes ? ` | ${qc.qc_notes}` : ""}${linkedText}`,
          taskTitle: task.taskTitle || "Task",
          projectName: task.projectName || "N/A",
          market: task.market || "N/A",
          gridNames: task.gridNames?.join(", ") || "N/A",
          feName: task.feName || "N/A",
          createdAt: qc.reviewed_at || qc.updated_at || qc.created_at,
          latitude: "",
          longitude: "",
          needsRedrive: true,
        };
      });

    return [...qcRedrives, ...feIssues].sort((a, b) => {
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
  }, [issueRows, qcRows, visibleTaskIds, enrichedTasks]);

  const evidenceSummaryRows = useMemo(() => {
    return visibleTasks.map((task) => ({
      id: task.id,
      taskTitle: task.taskTitle,
      projectName: task.projectName,
      market: task.market,
      gridNames: task.gridNames.join(", ") || "N/A",
      feName: task.feName,
      notesUpdates: task.updates.length,
      photos: task.photoCount,
      logsReceived: !!task.qc.log_received,
      logNamingCorrect: !!task.qc.log_naming_correct,
      requiredEvidenceReceived: !!task.qc.required_evidence_received,
      qcDecision: task.qcDecision,
      qcNotes: task.qc.qc_notes || "",
      reviewedAt: task.qc.reviewed_at,
    }));
  }, [visibleTasks]);

  const routeSummaryRows = useMemo(() => {
    const taskIds = new Set(visibleTasks.map((task) => task.id));
    const gridNamesById = {};
    const gridIds = new Set();

    gridSummaryRows.forEach((grid) => {
      if (grid.gridId) gridIds.add(grid.gridId);
      gridNamesById[grid.gridId] = grid.gridName;
    });

    return routeRows
      .filter((route) => {
        if (!route.task_id && !route.grid_id && !route.project_id) return true;
        if (route.task_id && taskIds.has(route.task_id)) return true;
        if (route.grid_id && gridIds.has(route.grid_id)) return true;
        if (route.project_id && projectSummaryRows.some((row) => row.id === route.project_id)) return true;
        return false;
      })
      .map((route, index) => ({
        id: route.id || index,
        routeName: route.name || route.route_name || route.title || `Route ${index + 1}`,
        mode: route.mode || route.route_mode || route.coverage_mode || route.type || "N/A",
        projectName: projectMap[route.project_id]?.name || route.project_name || "N/A",
        gridName: route.grid_name || gridNamesById[route.grid_id] || route.grid_id || "N/A",
        market: route.market || projectMap[route.project_id]?.market || "N/A",
        feName: getFEName(feMap[route.fe_id || route.assigned_to], route.fe_id || route.assigned_to || ""),
        status: route.status || route.route_status || "Saved",
        length:
          route.length_km ||
          route.route_length_km ||
          route.total_km ||
          route.length_miles ||
          "N/A",
        generatedAt: route.created_at || route.generated_at || route.updated_at,
      }));
  }, [routeRows, visibleTasks, gridSummaryRows, projectSummaryRows, projectMap, feMap]);

  const overviewStats = useMemo(() => {
    const totalTasks = visibleTasks.length;
    const completedTasks = visibleTasks.filter((task) => normalize(task.status) === "completed").length;
    const inProgressTasks = visibleTasks.filter((task) => {
      const status = normalize(task.status);
      return status === "in_progress" || status === "in progress";
    }).length;

    const assignedOrPending = visibleTasks.filter((task) => {
      const status = normalize(task.status);
      return status === "assigned" || status === "pending";
    }).length;

    return {
      projects: projectSummaryRows.filter((row) => row.totalTasks > 0).length,
      totalTasks,
      completedTasks,
      inProgressTasks,
      assignedOrPending,
      activeFEs: feSummaryRows.filter((row) => row.activeTasks > 0).length,
      qcPassed: visibleTasks.filter((task) => task.qcDecision === "QC Passed").length,
      qcFailed: visibleTasks.filter((task) => task.qcDecision === "QC Failed").length,
      needsRedrive: visibleTasks.filter((task) => task.qcDecision === "Needs Re-drive").length,
      waitingLogs: visibleTasks.filter((task) => task.qcDecision === "Waiting for Logs").length,
      missingEvidence: visibleTasks.filter((task) => task.qcDecision === "Missing Evidence").length,
      logNamingIssue: visibleTasks.filter((task) => task.qcDecision === "Log Naming Issue").length,
      notReviewed: visibleTasks.filter((task) => task.qcDecision === "Not Reviewed").length,
      issues: issueSummaryRows.length,
      updates: visibleTasks.reduce((sum, task) => sum + task.updates.length, 0),
      photos: visibleTasks.reduce((sum, task) => sum + task.photoCount, 0),
      grids: gridSummaryRows.length,
      routes: routeSummaryRows.length,
    };
  }, [visibleTasks, projectSummaryRows, feSummaryRows, issueSummaryRows, gridSummaryRows, routeSummaryRows]);

  const missingChecklistTasks = useMemo(
    () => visibleTasks.filter((task) => task.checklist.total > 0 && task.checklist.percent < 100),
    [visibleTasks]
  );

  const redriveRows = useMemo(
    () =>
      gridSummaryRows.filter(
        (row) => row.redriveNeeded || row.qcDecision === "Needs Re-drive"
      ),
    [gridSummaryRows]
  );

  const chartData = useMemo(() => {
    const statusRows = [
      { label: "Completed", value: overviewStats.completedTasks, tone: "good" },
      { label: "In Progress", value: overviewStats.inProgressTasks, tone: "info" },
      { label: "Pending / Assigned", value: overviewStats.assignedOrPending, tone: "warn" },
    ];

    const qcRowsForChart = DECISION_ORDER.map((decision) => ({
      label: decision,
      value: visibleTasks.filter((task) => task.qcDecision === decision).length,
      tone:
        decision === "QC Passed"
          ? "good"
          : ["QC Failed", "Needs Re-drive"].includes(decision)
            ? "bad"
            : ["Waiting for Logs", "Not Reviewed"].includes(decision)
              ? "info"
              : "warn",
    }));

    const evidenceRowsForChart = [
      {
        label: "Logs Received",
        value: visibleTasks.filter((task) => task.qc.log_received).length,
        tone: "good",
      },
      {
        label: "Naming Correct",
        value: visibleTasks.filter((task) => task.qc.log_naming_correct).length,
        tone: "info",
      },
      {
        label: "Evidence Received",
        value: visibleTasks.filter((task) => task.qc.required_evidence_received).length,
        tone: "good",
      },
      {
        label: "Photos Uploaded",
        value: visibleTasks.reduce((sum, task) => sum + task.photoCount, 0),
        tone: "warn",
      },
    ];

    const severityRows = ["critical", "high", "normal", "low", "N/A"].map((severity) => ({
      label: severity === "N/A" ? "N/A" : formatStatus(severity),
      value: issueSummaryRows.filter((issue) => normalize(issue.severity) === normalize(severity)).length,
      tone: ["critical", "high"].includes(severity) ? "bad" : severity === "normal" ? "warn" : "info",
    }));

    const feRowsForChart = feSummaryRows.slice(0, 8).map((fe) => ({
      label: fe.feName,
      value: fe.assignedTasks,
      detail: `${fe.completedTasks} completed / ${fe.activeTasks} active`,
      tone: fe.activeTasks ? "info" : "good",
    }));

    const projectRowsForChart = projectSummaryRows
      .filter((project) => project.totalTasks > 0)
      .slice(0, 8)
      .map((project) => ({
        label: project.name,
        value: project.completed,
        total: project.totalTasks,
        detail: `${project.completed}/${project.totalTasks} completed`,
        tone: project.completed === project.totalTasks ? "good" : "info",
      }));

    return {
      taskStatus: statusRows,
      qcDecision: qcRowsForChart,
      evidence: evidenceRowsForChart,
      severity: severityRows,
      feWorkload: feRowsForChart,
      projectProgress: projectRowsForChart,
    };
  }, [overviewStats, visibleTasks, issueSummaryRows, feSummaryRows, projectSummaryRows]);

  const readinessScore = useMemo(() => {
    if (!overviewStats.totalTasks) return 0;
    const completedWeight = safePercent(overviewStats.completedTasks, overviewStats.totalTasks) * 0.35;
    const qcReviewed = overviewStats.totalTasks - overviewStats.notReviewed;
    const qcWeight = safePercent(qcReviewed, overviewStats.totalTasks) * 0.25;
    const checklistReady = overviewStats.totalTasks - missingChecklistTasks.length;
    const checklistWeight = safePercent(checklistReady, overviewStats.totalTasks) * 0.20;
    const blockers = overviewStats.needsRedrive + overviewStats.waitingLogs + overviewStats.missingEvidence + overviewStats.logNamingIssue;
    const blockerWeight = Math.max(0, 100 - safePercent(blockers, overviewStats.totalTasks)) * 0.20;
    return Math.round(completedWeight + qcWeight + checklistWeight + blockerWeight);
  }, [overviewStats, missingChecklistTasks.length]);

  const topActionItems = useMemo(() => {
    const rows = [];
    if (overviewStats.notReviewed) rows.push({ label: "QC not reviewed", value: overviewStats.notReviewed, tone: "warn" });
    if (missingChecklistTasks.length) rows.push({ label: "Incomplete checklists", value: missingChecklistTasks.length, tone: "warn" });
    if (overviewStats.waitingLogs) rows.push({ label: "Waiting for logs", value: overviewStats.waitingLogs, tone: "info" });
    if (overviewStats.missingEvidence) rows.push({ label: "Missing evidence", value: overviewStats.missingEvidence, tone: "warn" });
    if (overviewStats.needsRedrive) rows.push({ label: "Needs re-drive", value: overviewStats.needsRedrive, tone: "bad" });
    if (overviewStats.issues) rows.push({ label: "Open issue records", value: overviewStats.issues, tone: "bad" });
    if (!rows.length) rows.push({ label: "No blockers visible", value: "Clear", tone: "good" });
    return rows.slice(0, 6);
  }, [overviewStats, missingChecklistTasks.length]);

  const executiveProjects = useMemo(() => {
    return projectSummaryRows
      .filter((row) => row.totalTasks > 0)
      .sort((a, b) => {
        const aRisk = a.needsRedrive + a.waitingLogs + a.missingEvidence + a.issues + a.notReviewed;
        const bRisk = b.needsRedrive + b.waitingLogs + b.missingEvidence + b.issues + b.notReviewed;
        return bRisk - aRisk || b.totalTasks - a.totalTasks;
      })
      .slice(0, 6);
  }, [projectSummaryRows]);

  function exportCurrentTab() {
    const config = getExportConfig(activeTab);
    const suffix = getEffectiveReportSuffix(reportPeriod, filters);
    const filename = config.filename.replace(/\.csv$/i, `_${suffix}.csv`);
    downloadCsv(filename, config.rows, config.columns);
  }

  function buildBarRowsHtml(rows = []) {
    const total = Math.max(...rows.map((row) => Number(row.value || 0)), 1);

    return rows
      .map((row) => {
        const value = Number(row.value || 0);
        const pct = Math.max(4, Math.round((value / total) * 100));
        return `
          <div class="pdf-bar-row">
            <div class="pdf-bar-top"><span>${escapeHtml(row.label)}</span><b>${escapeHtml(value)}</b></div>
            <div class="pdf-bar-track"><i class="${escapeHtml(row.tone || "info")}" style="width:${pct}%"></i></div>
          </div>
        `;
      })
      .join("");
  }

  function buildProjectRowsHtml(rows = []) {
    if (!rows.length) {
      return `<tr><td colspan="9">No project activity found for the selected period.</td></tr>`;
    }

    return rows
      .map(
        (row) => `
          <tr>
            <td><b>${escapeHtml(row.name)}</b></td>
            <td>${escapeHtml(row.customer)}</td>
            <td>${escapeHtml(row.market)}</td>
            <td>${escapeHtml(row.totalTasks)}</td>
            <td>${escapeHtml(row.completed)}</td>
            <td>${escapeHtml(row.qcPassed)}</td>
            <td>${escapeHtml(row.needsRedrive)}</td>
            <td>${escapeHtml(row.waitingLogs)}</td>
            <td>${escapeHtml(row.issues)}</td>
          </tr>
        `
      )
      .join("");
  }

  function buildCleanPrintHtml() {
    const printProjects = executiveProjects.length ? executiveProjects : projectSummaryRows.slice(0, 6);
    const completionPercent = safePercent(overviewStats.completedTasks, overviewStats.totalTasks);
    const generatedAt = new Date().toLocaleString();
    const projectRowsHtml = buildProjectRowsHtml(printProjects);
    const actionRowsHtml = topActionItems
      .map((item) => `<li><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.value)}</b></li>`)
      .join("");

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>BabyDragon Executive Operations Report</title>
          <style>
            @page { size: A4 landscape; margin: 7mm; }
            * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #0f172a; background: #ffffff; }
            .pdf-report { width: 100%; max-height: 194mm; overflow: hidden; }
            .pdf-header {
              display: grid;
              grid-template-columns: 1.3fr 1fr;
              gap: 10px;
              align-items: center;
              border: 1px solid #bfdbfe;
              border-radius: 14px;
              padding: 10px 12px;
              background: linear-gradient(135deg, #eff6ff, #ffffff);
              margin-bottom: 8px;
            }
            .pdf-brand { display: flex; align-items: center; gap: 12px; }
            .pdf-logo { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; background: #dbeafe; font-size: 24px; border: 1px solid #bfdbfe; }
            h1 { margin: 0; font-size: 23px; letter-spacing: -0.02em; }
            .pdf-subtitle { margin-top: 2px; font-size: 11px; color: #475569; font-weight: 700; }
            .pdf-meta { display: grid; gap: 5px; font-size: 11px; color: #334155; }
            .pdf-meta div { display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; }
            .pdf-one-line { margin: 0 0 8px; padding: 7px 10px; border-radius: 10px; background: #f8fafc; border: 1px solid #e2e8f0; color: #334155; font-size: 11px; font-weight: 700; text-align: center; }
            .pdf-kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 7px; margin-bottom: 8px; }
            .pdf-kpi { border: 1px solid #dbeafe; border-radius: 10px; padding: 7px 8px; text-align: center; background: #ffffff; }
            .pdf-kpi span { display: block; font-size: 9px; color: #64748b; text-transform: uppercase; font-weight: 800; letter-spacing: .04em; }
            .pdf-kpi b { display: block; margin-top: 2px; font-size: 21px; color: #0f172a; }
            .pdf-projects { margin-bottom: 8px; border: 1px solid #dbeafe; border-radius: 12px; overflow: hidden; }
            .pdf-section-title { display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; background: #eff6ff; border-bottom: 1px solid #dbeafe; }
            .pdf-section-title h2 { margin: 0; font-size: 13px; }
            .pdf-section-title span { font-size: 11px; color: #475569; font-weight: 700; }
            table { width: 100%; border-collapse: collapse; }
            th { background: #f8fafc; color: #0f172a; font-size: 10px; text-align: left; text-transform: uppercase; letter-spacing: .04em; }
            td, th { border-bottom: 1px solid #e2e8f0; padding: 5px 7px; font-size: 10px; vertical-align: top; }
            tr:last-child td { border-bottom: 0; }
            .pdf-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
            .pdf-card { border: 1px solid #dbeafe; border-radius: 12px; padding: 8px 10px; background: #ffffff; min-height: 126px; }
            .pdf-card h3 { margin: 0 0 6px; font-size: 13px; }
            .pdf-donut-wrap { display: flex; align-items: center; justify-content: center; gap: 14px; }
            .pdf-donut { width: 92px; height: 92px; border-radius: 50%; display: grid; place-items: center; background: radial-gradient(circle at center, #ffffff 0 56%, transparent 57%), conic-gradient(#22c55e ${completionPercent}%, #e2e8f0 0); }
            .pdf-donut b { font-size: 19px; }
            .pdf-bar-row { margin-bottom: 5px; }
            .pdf-bar-top { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px; color: #334155; }
            .pdf-bar-track { height: 6px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
            .pdf-bar-track i { display: block; height: 100%; border-radius: 999px; background: #2563eb; }
            .pdf-bar-track i.good { background: #22c55e; }
            .pdf-bar-track i.bad { background: #ef4444; }
            .pdf-bar-track i.warn { background: #f59e0b; }
            .pdf-action-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 5px; }
            .pdf-action-list li { display: flex; justify-content: space-between; gap: 10px; border: 1px solid #e2e8f0; border-radius: 9px; padding: 5px 7px; font-size: 10px; background: #f8fafc; }
            .pdf-footer { position: fixed; bottom: 2mm; left: 0; right: 0; text-align: center; color: #64748b; font-size: 9px; }
          </style>
        </head>
        <body>
          <main class="pdf-report">
            <section class="pdf-header">
              <div class="pdf-brand">
                <div class="pdf-logo">${escapeHtml(REPORT_BRAND.logo)}</div>
                <div>
                  <h1>Executive Operations Report</h1>
                  <div class="pdf-subtitle">${escapeHtml(REPORT_BRAND.name)} | ${escapeHtml(REPORT_BRAND.company)} | ${escapeHtml(REPORT_BRAND.subtitle)}</div>
                </div>
              </div>
              <div class="pdf-meta">
                <div><b>Report Period</b><span>${escapeHtml(reportPeriodLabel)}</span></div>
                <div><b>Generated</b><span>${escapeHtml(generatedAt)}</span></div>
                <div><b>Scope</b><span>Operational management only. No RF/KPI log processing.</span></div>
              </div>
            </section>

            <p class="pdf-one-line">Executive snapshot of project progress, field execution, QC readiness, evidence/log gaps, issues, routes, and re-drive risk. Operational data only.</p>

            <section class="pdf-kpis">
              <div class="pdf-kpi"><span>Projects</span><b>${escapeHtml(overviewStats.projects)}</b></div>
              <div class="pdf-kpi"><span>Tasks</span><b>${escapeHtml(overviewStats.totalTasks)}</b></div>
              <div class="pdf-kpi"><span>Completed</span><b>${escapeHtml(overviewStats.completedTasks)}</b></div>
              <div class="pdf-kpi"><span>Completion</span><b>${escapeHtml(completionPercent)}%</b></div>
              <div class="pdf-kpi"><span>Readiness</span><b>${escapeHtml(readinessScore)}%</b></div>
              <div class="pdf-kpi"><span>Issues/Re-drive</span><b>${escapeHtml(overviewStats.issues)}</b></div>
            </section>

            <section class="pdf-projects">
              <div class="pdf-section-title"><h2>Project Snapshot</h2><span>Top projects by activity and risk</span></div>
              <table>
                <thead>
                  <tr><th>Project</th><th>Customer</th><th>Market</th><th>Tasks</th><th>Completed</th><th>QC Passed</th><th>Needs Re-drive</th><th>Waiting Logs</th><th>Issues</th></tr>
                </thead>
                <tbody>${projectRowsHtml}</tbody>
              </table>
            </section>

            <section class="pdf-grid">
              <div class="pdf-card">
                <h3>Task Completion</h3>
                <div class="pdf-donut-wrap">
                  <div class="pdf-donut"><b>${escapeHtml(completionPercent)}%</b></div>
                  <div><b>${escapeHtml(overviewStats.completedTasks)}/${escapeHtml(overviewStats.totalTasks)}</b><br/><span>completed tasks</span></div>
                </div>
              </div>
              <div class="pdf-card">
                <h3>QC Decision Mix</h3>
                ${buildBarRowsHtml(chartData.qcDecision)}
              </div>
              <div class="pdf-card">
                <h3>Management Action Items</h3>
                <ul class="pdf-action-list">${actionRowsHtml}</ul>
              </div>
            </section>

            <div class="pdf-footer">Generated by BabyDragon / MobbiTech Global LLC. Operational report only.</div>
          </main>
          <script>
            window.addEventListener('load', function () {
              setTimeout(function () { window.print(); }, 350);
            });
          </script>
        </body>
      </html>
    `;
  }

  function exportPrintablePdf() {
    const html = buildCleanPrintHtml();
    const printWindow = window.open("", "_blank", "width=1200,height=850");

    if (!printWindow) {
      window.print();
      return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }

  function exportWordReport() {
    const printProjects = executiveProjects.length ? executiveProjects : projectSummaryRows.slice(0, 6);
    const completionPercent = safePercent(overviewStats.completedTasks, overviewStats.totalTasks);
    const generatedAt = new Date().toLocaleString();
    const suffix = getEffectiveReportSuffix(reportPeriod, filters);

    const projectRowsHtml = printProjects.length
      ? printProjects
          .map(
            (row) => `
              <tr>
                <td><strong>${escapeHtml(row.name)}</strong></td>
                <td>${escapeHtml(row.customer)}</td>
                <td>${escapeHtml(row.market)}</td>
                <td>${escapeHtml(row.totalTasks)}</td>
                <td>${escapeHtml(row.completed)}</td>
                <td>${escapeHtml(row.qcPassed)}</td>
                <td>${escapeHtml(row.needsRedrive)}</td>
                <td>${escapeHtml(row.waitingLogs)}</td>
                <td>${escapeHtml(row.issues)}</td>
              </tr>
            `
          )
          .join("")
      : `<tr><td colspan="9">No project activity found for the selected period.</td></tr>`;

    const qcRowsHtml = chartData.qcDecision
      .map(
        (row) => `
          <tr>
            <td>${escapeHtml(row.label)}</td>
            <td><strong>${escapeHtml(row.value || 0)}</strong></td>
          </tr>
        `
      )
      .join("");

    const actionRowsHtml = topActionItems
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(item.label)}</td>
            <td><strong>${escapeHtml(item.value)}</strong></td>
          </tr>
        `
      )
      .join("");

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>BabyDragon Executive Operations Summary</title>
          <style>
            @page { size: 11in 8.5in; margin: 0.35in; }
            body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 22px; }
            .header { border: 1px solid #bfdbfe; border-radius: 14px; padding: 14px 16px; background: #eff6ff; display: table; width: 100%; }
            .header-left { display: table-cell; vertical-align: middle; width: 58%; }
            .header-right { display: table-cell; vertical-align: middle; width: 42%; font-size: 11px; color: #475569; }
            .brand { font-size: 26px; font-weight: 800; color: #0f172a; margin: 0; }
            .brand span { display: inline-block; width: 42px; height: 42px; border-radius: 12px; background: #dbeafe; text-align: center; line-height: 42px; margin-right: 8px; }
            .subtitle { font-size: 12px; font-weight: 700; color: #334155; margin-top: 4px; }
            .meta-row { display: table; width: 100%; border-bottom: 1px solid #cbd5e1; padding: 4px 0; }
            .meta-row b { display: table-cell; width: 36%; text-transform: uppercase; letter-spacing: .04em; }
            .meta-row span { display: table-cell; text-align: right; }
            .one-line { border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; padding: 9px 12px; font-weight: 700; font-size: 12px; color: #334155; margin: 12px 0; text-align: center; }
            .kpis { width: 100%; border-collapse: separate; border-spacing: 8px; margin: 0 0 10px; }
            .kpis td { border: 1px solid #dbeafe; border-radius: 12px; text-align: center; padding: 9px 7px; width: 16.6%; }
            .kpis small { display: block; text-transform: uppercase; letter-spacing: .06em; color: #64748b; font-weight: 800; font-size: 10px; }
            .kpis strong { display: block; font-size: 24px; margin-top: 4px; color: #0f172a; }
            h2 { font-size: 15px; margin: 12px 0 6px; color: #0f172a; }
            table { width: 100%; border-collapse: collapse; }
            th { background: #dbeafe; color: #0f172a; text-transform: uppercase; font-size: 10px; }
            td, th { border: 1px solid #cbd5e1; padding: 6px 7px; font-size: 11px; vertical-align: top; }
            .three-col { width: 100%; border-collapse: separate; border-spacing: 10px; margin-top: 8px; }
            .three-col > tbody > tr > td { width: 33.33%; border: 1px solid #dbeafe; border-radius: 12px; padding: 10px; vertical-align: top; }
            .big-number { font-size: 30px; font-weight: 800; text-align: center; padding: 10px 0; color: #16a34a; }
            .footer { margin-top: 14px; color: #64748b; font-size: 10px; text-align: center; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="header-left">
              <div class="brand"><span>${REPORT_BRAND.logo}</span>Executive Operations Summary</div>
              <div class="subtitle">${REPORT_BRAND.name} | ${REPORT_BRAND.company} | ${REPORT_BRAND.subtitle}</div>
            </div>
            <div class="header-right">
              <div class="meta-row"><b>Report Period</b><span>${escapeHtml(reportPeriodLabel)}</span></div>
              <div class="meta-row"><b>Generated</b><span>${escapeHtml(generatedAt)}</span></div>
              <div class="meta-row"><b>Scope</b><span>Operational management only. No RF/KPI log processing.</span></div>
            </div>
          </div>

          <div class="one-line">Executive snapshot of project progress, field execution, QC readiness, evidence/log gaps, issues, routes, and re-drive risk. Operational data only.</div>

          <table class="kpis">
            <tr>
              <td><small>Projects</small><strong>${escapeHtml(overviewStats.projects)}</strong></td>
              <td><small>Tasks</small><strong>${escapeHtml(overviewStats.totalTasks)}</strong></td>
              <td><small>Completed</small><strong>${escapeHtml(overviewStats.completedTasks)}</strong></td>
              <td><small>Completion</small><strong>${escapeHtml(completionPercent)}%</strong></td>
              <td><small>Readiness</small><strong>${escapeHtml(readinessScore)}%</strong></td>
              <td><small>Issues/Re-drive</small><strong>${escapeHtml(overviewStats.issues)}</strong></td>
            </tr>
          </table>

          <h2>Project Snapshot</h2>
          <table>
            <thead>
              <tr><th>Project</th><th>Customer</th><th>Market</th><th>Tasks</th><th>Completed</th><th>QC Passed</th><th>Needs Re-drive</th><th>Waiting Logs</th><th>Issues</th></tr>
            </thead>
            <tbody>${projectRowsHtml}</tbody>
          </table>

          <table class="three-col">
            <tr>
              <td>
                <h2>Task Completion</h2>
                <div class="big-number">${escapeHtml(completionPercent)}%</div>
                <div style="text-align:center;"><strong>${escapeHtml(overviewStats.completedTasks)}/${escapeHtml(overviewStats.totalTasks)}</strong> completed tasks</div>
              </td>
              <td>
                <h2>QC Decision Mix</h2>
                <table>${qcRowsHtml}</table>
              </td>
              <td>
                <h2>Management Action Items</h2>
                <table>${actionRowsHtml}</table>
              </td>
            </tr>
          </table>

          <div class="footer">Generated by BabyDragon / MobbiTech Global LLC. Operational report only.</div>
        </body>
      </html>
    `;

    const blob = new Blob([html], { type: "application/msword;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `BabyDragon_Executive_Summary_${suffix}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function getExportConfig(tab) {
    if (tab === "projects") {
      return {
        filename: "BabyDragon_Project_Summary.csv",
        rows: projectSummaryRows,
        columns: [
          { label: "Project", key: "name" },
          { label: "Customer", key: "customer" },
          { label: "Market", key: "market" },
          { label: "Testing Type", key: "testingType" },
          { label: "Total Tasks", key: "totalTasks" },
          { label: "Completed", key: "completed" },
          { label: "In Progress", key: "inProgress" },
          { label: "Assigned", key: "assigned" },
          { label: "Pending", key: "pending" },
          { label: "QC Passed", key: "qcPassed" },
          { label: "QC Failed", key: "qcFailed" },
          { label: "Needs Re-drive", key: "needsRedrive" },
          { label: "Waiting Logs", key: "waitingLogs" },
          { label: "Log Naming Issue", key: "logNamingIssue" },
          { label: "Missing Evidence", key: "missingEvidence" },
          { label: "Not Reviewed", key: "notReviewed" },
          { label: "Issues", key: "issues" },
          { label: "Updates", key: "updates" },
          { label: "Photos", key: "photos" },
          { label: "Avg Checklist %", key: "avgChecklist" },
        ],
      };
    }

    if (tab === "grids") {
      return {
        filename: "BabyDragon_Grid_Summary.csv",
        rows: gridSummaryRows,
        columns: [
          { label: "Grid", key: "gridName" },
          { label: "Task", key: "taskTitle" },
          { label: "Project", key: "projectName" },
          { label: "Customer", key: "customer" },
          { label: "Market", key: "market" },
          { label: "FE", key: "feName" },
          { label: "Task Status", key: "status" },
          { label: "Checklist", key: "checklist" },
          { label: "Checklist %", key: "checklistPercent" },
          { label: "Issues", key: "issues" },
          { label: "Updates", key: "updates" },
          { label: "QC Decision", key: "qcDecision" },
          { label: "Logs Received", get: (row) => yesNo(row.logReceived) },
          { label: "Log Naming Correct", get: (row) => yesNo(row.logNamingCorrect) },
          { label: "Evidence Received", get: (row) => yesNo(row.evidenceReceived) },
          { label: "Re-drive Needed", get: (row) => yesNo(row.redriveNeeded) },
          { label: "Reviewed At", get: (row) => formatDate(row.reviewedAt) },
        ],
      };
    }

    if (tab === "fe") {
      return {
        filename: "BabyDragon_FE_Activity_Summary.csv",
        rows: feSummaryRows,
        columns: [
          { label: "FE", key: "feName" },
          { label: "Assigned Tasks", key: "assignedTasks" },
          { label: "Completed Tasks", key: "completedTasks" },
          { label: "Active Tasks", key: "activeTasks" },
          { label: "Pending/Assigned", key: "pendingTasks" },
          { label: "Issues", key: "issues" },
          { label: "Updates", key: "updates" },
          { label: "Photos", key: "photos" },
          { label: "QC Passed", key: "qcPassed" },
          { label: "QC Failed", key: "qcFailed" },
          { label: "Needs Re-drive", key: "needsRedrive" },
          { label: "Waiting Logs", key: "waitingLogs" },
          { label: "Missing Evidence", key: "missingEvidence" },
          { label: "Log Naming Issue", key: "logNamingIssue" },
          { label: "Avg Checklist %", key: "avgChecklist" },
        ],
      };
    }

    if (tab === "issues") {
      return {
        filename: "BabyDragon_Issues_Redrive_Summary.csv",
        rows: issueSummaryRows,
        columns: [
          { label: "Source", key: "source" },
          { label: "Issue Type", key: "issueType" },
          { label: "Severity", key: "severity" },
          { label: "Status", key: "status" },
          { label: "Task", key: "taskTitle" },
          { label: "Project", key: "projectName" },
          { label: "Market", key: "market" },
          { label: "Grid(s)", key: "gridNames" },
          { label: "FE", key: "feName" },
          { label: "Description", key: "description" },
          { label: "Needs Re-drive", get: (row) => yesNo(row.needsRedrive) },
          { label: "Latitude", key: "latitude" },
          { label: "Longitude", key: "longitude" },
          { label: "Created At", get: (row) => formatDate(row.createdAt) },
        ],
      };
    }

    if (tab === "evidence") {
      return {
        filename: "BabyDragon_Evidence_Log_Summary.csv",
        rows: evidenceSummaryRows,
        columns: [
          { label: "Task", key: "taskTitle" },
          { label: "Project", key: "projectName" },
          { label: "Market", key: "market" },
          { label: "Grid(s)", key: "gridNames" },
          { label: "FE", key: "feName" },
          { label: "Notes/Updates", key: "notesUpdates" },
          { label: "Photos", key: "photos" },
          { label: "Logs Received", get: (row) => yesNo(row.logsReceived) },
          { label: "Log Naming Correct", get: (row) => yesNo(row.logNamingCorrect) },
          { label: "Evidence Received", get: (row) => yesNo(row.requiredEvidenceReceived) },
          { label: "QC Decision", key: "qcDecision" },
          { label: "QC Notes", key: "qcNotes" },
          { label: "Reviewed At", get: (row) => formatDate(row.reviewedAt) },
        ],
      };
    }

    if (tab === "routes") {
      return {
        filename: "BabyDragon_Route_Summary.csv",
        rows: routeSummaryRows,
        columns: [
          { label: "Route", key: "routeName" },
          { label: "Mode", key: "mode" },
          { label: "Project", key: "projectName" },
          { label: "Grid", key: "gridName" },
          { label: "Market", key: "market" },
          { label: "FE", key: "feName" },
          { label: "Status", key: "status" },
          { label: "Length", key: "length" },
          { label: "Generated At", get: (row) => formatDate(row.generatedAt) },
        ],
      };
    }

    return {
      filename: "BabyDragon_Task_QC_Summary.csv",
      rows: visibleTasks,
      columns: [
        { label: "Task", key: "taskTitle" },
        { label: "Project", key: "projectName" },
        { label: "Customer", key: "customer" },
        { label: "Market", key: "market" },
        { label: "Testing Type", key: "testingType" },
        { label: "FE", key: "feName" },
        { label: "Grid(s)", get: (row) => row.gridNames.join(", ") || "N/A" },
        { label: "Task Status", key: "statusLabel" },
        { label: "Due Date", get: (row) => shortDate(row.due_date) },
        { label: "Checklist", get: (row) => row.checklist.label },
        { label: "Checklist %", get: (row) => row.checklist.percent },
        { label: "Missing Checklist Items", get: (row) => row.checklist.missing.join("; ") },
        { label: "Issues", get: (row) => row.issues.length },
        { label: "Updates", get: (row) => row.updates.length },
        { label: "Photos", key: "photoCount" },
        { label: "QC Decision", key: "qcDecision" },
        { label: "Logs Received", get: (row) => yesNo(row.qc.log_received) },
        { label: "Log Naming Correct", get: (row) => yesNo(row.qc.log_naming_correct) },
        { label: "Evidence Received", get: (row) => yesNo(row.qc.required_evidence_received) },
        { label: "Re-drive Needed", get: (row) => yesNo(row.qc.redrive_needed || row.qcDecision === "Needs Re-drive") },
        { label: "QC Notes", get: (row) => row.qc.qc_notes || "" },
        { label: "Reviewed At", get: (row) => formatDate(row.qc.reviewed_at) },
      ],
    };
  }

  function renderOverview() {
    const completionPercent = safePercent(overviewStats.completedTasks, overviewStats.totalTasks);

    return (
      <>
        <section className="bdr-exec-hero">
          <div>
            <p className="bdr-section-kicker">Executive snapshot</p>
            <h3>{overviewStats.projects} project(s), {overviewStats.totalTasks} task(s), {completionPercent}% complete</h3>
            <p>
              Period: <b>{reportPeriodLabel}</b>. This view is intentionally short for management review.
            </p>
          </div>
          <div className={`bdr-readiness-score ${readinessScore >= 85 ? "good" : readinessScore >= 65 ? "warn" : "bad"}`}>
            <span>Readiness</span>
            <strong>{readinessScore}%</strong>
          </div>
        </section>

        <section className="bdr-panel bdr-project-snapshot-first">
          <div className="bdr-panel-head">
            <div>
              <h3>Project Snapshot</h3>
              <span>Top projects stay hidden by default so the overview remains clean.</span>
            </div>
            <div className="bdr-panel-actions">
              <button type="button" onClick={() => setShowProjectSnapshot((value) => !value)}>
                {showProjectSnapshot ? "Hide Project Details" : "Show Project Details"}
              </button>
              {showAdvancedFilters && (
                <button type="button" onClick={() => setActiveTab("projects")}>Open Full Detail</button>
              )}
            </div>
          </div>
          {showProjectSnapshot ? (
            renderProjectTable(executiveProjects.length ? executiveProjects : projectSummaryRows.slice(0, 6))
          ) : (
            <div className="bdr-hidden-note">
              Project snapshot details are hidden for a cleaner executive view. {projectSummaryRows.filter((row) => row.totalTasks > 0).length} active project record(s) are available.
            </div>
          )}
        </section>

        <div className="bdr-exec-grid">
          <DonutCard
            title="Task Completion"
            value={overviewStats.completedTasks}
            total={overviewStats.totalTasks}
            label="completed tasks"
            tone="good"
          />
          <HorizontalBarChart title="Task Status" rows={chartData.taskStatus} compact />
          <HorizontalBarChart title="QC Decision Mix" rows={chartData.qcDecision} compact />
          <HorizontalBarChart title="Evidence / Logs" rows={chartData.evidence} compact />
        </div>

        <div className="bdr-two-column executive">
          <section className="bdr-panel">
            <div className="bdr-panel-head">
              <h3>Management Action Items</h3>
              <span>What needs attention</span>
            </div>
            <div className="bdr-action-list">
              {topActionItems.map((item) => (
                <ReadinessLine key={item.label} label={item.label} value={item.value} tone={item.tone} />
              ))}
            </div>
          </section>

          <section className="bdr-panel">
            <div className="bdr-panel-head">
              <h3>Closeout Readiness</h3>
              <span>Operational checks</span>
            </div>
            <div className="bdr-readiness-list compact">
              <ReadinessLine label="Incomplete checklists" value={missingChecklistTasks.length} tone={missingChecklistTasks.length ? "warn" : "good"} />
              <ReadinessLine label="Missing evidence" value={overviewStats.missingEvidence} tone={overviewStats.missingEvidence ? "warn" : "good"} />
              <ReadinessLine label="Waiting for logs" value={overviewStats.waitingLogs} tone={overviewStats.waitingLogs ? "info" : "good"} />
              <ReadinessLine label="Needs re-drive" value={overviewStats.needsRedrive} tone={overviewStats.needsRedrive ? "bad" : "good"} />
              <ReadinessLine label="Issue records" value={overviewStats.issues} tone={overviewStats.issues ? "warn" : "good"} />
            </div>
          </section>
        </div>

        {showAdvancedFilters && (
          <section className="bdr-panel bdr-detail-strip">
            <div className="bdr-panel-head">
              <h3>Detailed Report Tables</h3>
              <span>Use these buttons when more detail is needed.</span>
            </div>
            <div className="bdr-detail-buttons">
              <button type="button" onClick={() => setActiveTab("tasks")}>Task / QC</button>
              <button type="button" onClick={() => setActiveTab("grids")}>Grid Summary</button>
              <button type="button" onClick={() => setActiveTab("fe")}>FE Activity</button>
              <button type="button" onClick={() => setActiveTab("issues")}>Issues / Re-drive</button>
              <button type="button" onClick={() => setActiveTab("evidence")}>Evidence / Logs</button>
              <button type="button" onClick={() => setActiveTab("routes")}>Routes</button>
            </div>
          </section>
        )}
      </>
    );
  }


  function renderProjectTable(rows = projectSummaryRows) {
    return (
      <ReportTable
        emptyText="No project summary found."
        columns={[
          "Project",
          "Customer",
          "Market",
          "Tasks",
          "Completed",
          "QC Passed",
          "Needs Re-drive",
          "Waiting Logs",
          "Issues",
          "Avg Checklist",
        ]}
        rows={rows.map((row) => [
          <strong>{row.name}</strong>,
          row.customer,
          row.market,
          row.totalTasks,
          row.completed,
          row.qcPassed,
          row.needsRedrive,
          row.waitingLogs,
          row.issues,
          `${row.avgChecklist}%`,
        ])}
      />
    );
  }

  function renderTaskTable(rows = visibleTasks) {
    return (
      <ReportTable
        emptyText="No task/QC records match the filters."
        columns={[
          "Task",
          "Project",
          "Market",
          "FE",
          "Grid(s)",
          "Status",
          "Checklist",
          "Issues",
          "Updates",
          "QC Decision",
          "Logs",
          "Evidence",
        ]}
        rows={rows.map((task) => [
          <strong>{task.taskTitle}</strong>,
          task.projectName,
          task.market,
          task.feName,
          task.gridNames.join(", ") || "N/A",
          <span className={getStatusClass(task.status)}>{task.statusLabel}</span>,
          <span>{task.checklist.label} ({task.checklist.percent}%)</span>,
          task.issues.length,
          task.updates.length,
          <span className={getDecisionClass(task.qcDecision)}>{task.qcDecision}</span>,
          yesNo(task.qc.log_received),
          yesNo(task.qc.required_evidence_received),
        ])}
      />
    );
  }

  function renderGridTable(rows = gridSummaryRows) {
    return (
      <ReportTable
        emptyText="No grid records match the filters."
        columns={[
          "Grid",
          "Task",
          "Project",
          "Market",
          "FE",
          "Task Status",
          "Checklist",
          "Issues",
          "QC Decision",
          "Logs",
          "Naming",
          "Evidence",
          "Re-drive",
        ]}
        rows={rows.map((row) => [
          <strong>{row.gridName}</strong>,
          row.taskTitle,
          row.projectName,
          row.market,
          row.feName,
          row.status,
          `${row.checklist} (${row.checklistPercent}%)`,
          row.issues,
          <span className={getDecisionClass(row.qcDecision)}>{row.qcDecision}</span>,
          yesNo(row.logReceived),
          yesNo(row.logNamingCorrect),
          yesNo(row.evidenceReceived),
          yesNo(row.redriveNeeded),
        ])}
      />
    );
  }

  function renderFETable(rows = feSummaryRows) {
    return (
      <ReportTable
        emptyText="No FE activity found for current filters."
        columns={[
          "FE",
          "Assigned",
          "Completed",
          "Active",
          "Issues",
          "Updates",
          "Photos",
          "QC Passed",
          "Needs Re-drive",
          "Waiting Logs",
          "Avg Checklist",
        ]}
        rows={rows.map((row) => [
          <strong>{row.feName}</strong>,
          row.assignedTasks,
          row.completedTasks,
          row.activeTasks,
          row.issues,
          row.updates,
          row.photos,
          row.qcPassed,
          row.needsRedrive,
          row.waitingLogs,
          `${row.avgChecklist}%`,
        ])}
      />
    );
  }

  function renderIssueTable(rows = issueSummaryRows) {
    return (
      <ReportTable
        emptyText="No issues found for current filters."
        columns={[
          "Source",
          "Issue",
          "Severity",
          "Status",
          "Task",
          "Project",
          "Market",
          "Grid(s)",
          "FE",
          "Description",
          "Re-drive",
          "Reported",
        ]}
        rows={rows.map((row) => [
          row.source || "FE Issue",
          <strong>{row.issueType}</strong>,
          row.severity,
          row.status,
          row.taskTitle,
          row.projectName,
          row.market,
          row.gridNames,
          row.feName,
          row.description || "N/A",
          yesNo(row.needsRedrive),
          formatDate(row.createdAt),
        ])}
      />
    );
  }

  function renderEvidenceTable(rows = evidenceSummaryRows) {
    return (
      <ReportTable
        emptyText="No evidence/log summary found."
        columns={[
          "Task",
          "Project",
          "Market",
          "Grid(s)",
          "FE",
          "Updates",
          "Photos",
          "Logs Received",
          "Naming Correct",
          "Evidence Received",
          "QC Decision",
          "Reviewed",
        ]}
        rows={rows.map((row) => [
          <strong>{row.taskTitle}</strong>,
          row.projectName,
          row.market,
          row.gridNames,
          row.feName,
          row.notesUpdates,
          row.photos,
          yesNo(row.logsReceived),
          yesNo(row.logNamingCorrect),
          yesNo(row.requiredEvidenceReceived),
          <span className={getDecisionClass(row.qcDecision)}>{row.qcDecision}</span>,
          formatDate(row.reviewedAt),
        ])}
      />
    );
  }

  function renderRouteTable(rows = routeSummaryRows) {
    return (
      <ReportTable
        emptyText="No saved route records found. If routes exist but do not show here, confirm the saved route table name."
        columns={[
          "Route",
          "Mode",
          "Project",
          "Grid",
          "Market",
          "FE",
          "Status",
          "Length",
          "Generated",
        ]}
        rows={rows.map((row) => [
          <strong>{row.routeName}</strong>,
          row.mode,
          row.projectName,
          row.gridName,
          row.market,
          row.feName,
          row.status,
          row.length,
          formatDate(row.generatedAt),
        ])}
      />
    );
  }

  function renderPrintPackage() {
    const printProjects = executiveProjects.length ? executiveProjects : projectSummaryRows.slice(0, 6);
    const completionPercent = safePercent(overviewStats.completedTasks, overviewStats.totalTasks);
    return (
      <div className="bdr-print-package">
        <section className="bdr-print-cover">
          <div>
            <div className="bdr-print-brand"><span>{REPORT_BRAND.logo}</span><strong>{REPORT_BRAND.name}</strong></div>
            <h1>Executive Operations Report</h1>
            <p>{REPORT_BRAND.company} | {REPORT_BRAND.subtitle}</p>
          </div>
          <div className="bdr-print-meta">
            <p><b>Period:</b> {reportPeriodLabel}</p>
            <p><b>Generated:</b> {new Date().toLocaleString()}</p>
            <p><b>Scope:</b> Operational management only. No RF/KPI log processing.</p>
          </div>
        </section>

        <section className="bdr-print-summary">
          <div><span>Projects</span><b>{overviewStats.projects}</b></div>
          <div><span>Tasks</span><b>{overviewStats.totalTasks}</b></div>
          <div><span>Completed</span><b>{overviewStats.completedTasks}</b></div>
          <div><span>Completion</span><b>{completionPercent}%</b></div>
          <div><span>Readiness</span><b>{readinessScore}%</b></div>
          <div><span>Issues / Re-drive</span><b>{overviewStats.issues}</b></div>
        </section>

        <section className="bdr-print-charts">
          <DonutCard title="Task Completion" value={overviewStats.completedTasks} total={overviewStats.totalTasks} label="completed" />
          <HorizontalBarChart title="Task Status" rows={chartData.taskStatus} />
          <HorizontalBarChart title="QC Decision Mix" rows={chartData.qcDecision} />
          <HorizontalBarChart title="Evidence / Logs" rows={chartData.evidence} />
        </section>

        <section className="bdr-print-two">
          <div>
            <h2>Management Action Items</h2>
            <div className="bdr-readiness-list compact">
              {topActionItems.map((item) => (
                <ReadinessLine key={item.label} label={item.label} value={item.value} tone={item.tone} />
              ))}
            </div>
          </div>
          <div>
            <h2>Project Snapshot</h2>
            {renderProjectTable(printProjects)}
          </div>
        </section>
      </div>
    );
  }

  function renderTabContent() {
    if (!showAdvancedFilters) return renderOverview();
    if (activeTab === "overview") return renderOverview();

    if (activeTab === "projects") {
      return (
        <section className="bdr-panel">
          <PanelTitle title="Project Summary" subtitle="Project, market, completion, QC, issues, and checklist readiness." />
          <HorizontalBarChart title="Project Completion Snapshot" rows={chartData.projectProgress} />
          {renderProjectTable()}
        </section>
      );
    }

    if (activeTab === "tasks") {
      return (
        <section className="bdr-panel">
          <PanelTitle title="Task / QC Detail" subtitle="Task-level operational report with checklist, issues, logs, evidence, and QC decision." />
          {renderTaskTable()}
        </section>
      );
    }

    if (activeTab === "grids") {
      return (
        <section className="bdr-panel">
          <PanelTitle title="Grid Summary" subtitle="Grid-level report for assigned tasks, FE, QC, logs, evidence, and re-drive status." />
          {renderGridTable()}
        </section>
      );
    }

    if (activeTab === "fe") {
      return (
        <section className="bdr-panel">
          <PanelTitle title="FE Activity Summary" subtitle="Field engineer workload, completed work, updates, issues, photos, and QC outcomes." />
          <HorizontalBarChart title="FE Workload" rows={chartData.feWorkload} />
          {renderFETable()}
        </section>
      );
    }

    if (activeTab === "issues") {
      return (
        <>
          <div className="bdr-stat-grid qc">
            <ReportStat label="Issue / Re-drive Records" value={issueSummaryRows.length} tone="warn" />
            <ReportStat label="Re-drive Related" value={issueSummaryRows.filter((row) => row.needsRedrive).length} tone="bad" />
            <ReportStat
              label="High / Critical"
              value={issueSummaryRows.filter((row) => ["high", "critical"].includes(normalize(row.severity))).length}
              tone="bad"
            />
            <ReportStat
              label="Open Issues"
              value={issueSummaryRows.filter((row) => normalize(row.status) !== "closed").length}
              tone="info"
            />
          </div>

          <section className="bdr-panel">
            <PanelTitle title="Issues / Re-drive Summary" subtitle="All FE-reported issues and QC-triggered re-drive visibility." />
            <HorizontalBarChart title="Issue Severity Mix" rows={chartData.severity} />
            {renderIssueTable()}
          </section>
        </>
      );
    }

    if (activeTab === "evidence") {
      return (
        <section className="bdr-panel">
          <PanelTitle title="Evidence / Upload Summary" subtitle="Notes, photos, logs received, naming correctness, evidence received, and QC notes." />
          <HorizontalBarChart title="Evidence / Logs Readiness" rows={chartData.evidence} />
          {renderEvidenceTable()}
        </section>
      );
    }

    if (activeTab === "routes") {
      return (
        <section className="bdr-panel">
          <PanelTitle title="Route Summary" subtitle="Saved route reporting where route records are available." />
          {renderRouteTable()}
        </section>
      );
    }

    return null;
  }

  return (
    <div className="bdr-page">
      <ReportsStyles />
      {renderPrintPackage()}

      <section className="bdr-header bdr-page-hero">
        <div className="bdr-hero-copy">
          <p className="bdr-kicker">QC & Reports</p>
          <h2>Executive Operational Reports</h2>
          <p>
            Executive snapshot of project progress, field execution, QC readiness, evidence/log gaps, issues, routes, and re-drive risk. Operational data only.
          </p>
          <div className="bdr-hero-meta-line">
            <span>Period: <b>{reportPeriodLabel}</b></span>
            <span>Generated: <b>{new Date().toLocaleString()}</b></span>
          </div>
        </div>

        <div className="bdr-hero-side">
          <div className="bdr-workflow-pill">Overview → QC → Evidence → Export</div>
          <div className="bdr-header-actions">
            <button type="button" onClick={loadReportData}>
              {loading ? "Loading..." : "Refresh"}
            </button>

            <div className="bdr-export-wrap">
              <button type="button" onClick={() => setShowExportMenu((value) => !value)}>
                Export Report ▾
              </button>
              {showExportMenu && (
                <div className="bdr-export-menu">
                  <button type="button" onClick={() => { exportCurrentTab(); setShowExportMenu(false); }}>Export CSV</button>
                  <button type="button" onClick={() => { exportPrintablePdf(); setShowExportMenu(false); }}>Print / Save PDF</button>
                  <button type="button" onClick={() => { exportWordReport(); setShowExportMenu(false); }}>Export Word</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className={`bdr-toolbar ${showAdvancedFilters ? "advanced" : "overview"}`}>
        <input
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Search project, task, grid, market, FE, QC decision..."
        />

        <select
          value={localDecisionFilter}
          onChange={(event) => setLocalDecisionFilter(event.target.value)}
        >
          <option value="All">All QC Decisions</option>
          {DECISION_ORDER.map((decision) => (
            <option key={decision} value={decision}>{decision}</option>
          ))}
        </select>

        <select
          value={filters?.dateMode && filters.dateMode !== "all" ? filters.dateMode : reportPeriod}
          onChange={(event) => setReportPeriod(event.target.value)}
          disabled={!!filters?.dateMode && filters.dateMode !== "all"}
          title={filters?.dateMode && filters.dateMode !== "all" ? "Using dashboard date range filter" : "Report period"}
        >
          <option value="all">All Time</option>
          <option value="daily">Daily - Today</option>
          <option value="today">Today - Dashboard Filter</option>
          <option value="weekly">Weekly - This Week</option>
          <option value="week">This Week - Dashboard Filter</option>
          <option value="monthly">Monthly - This Month</option>
          <option value="month">This Month - Dashboard Filter</option>
          <option value="custom">Custom - Dashboard Filter</option>
        </select>

        {showAdvancedFilters && (
          <select value={activeTab} onChange={(event) => setActiveTab(event.target.value)}>
            {REPORT_TABS.map((tab) => (
              <option key={tab.id} value={tab.id}>{tab.label}</option>
            ))}
          </select>
        )}

        <button
          type="button"
          className="bdr-advanced-toggle"
          onClick={() => setShowAdvancedFilters((value) => !value)}
        >
          {showAdvancedFilters ? "Hide Advanced" : "Show Advanced"}
        </button>
      </div>

      {showAdvancedFilters && (
        <div className="bdr-advanced-panel">
          <div className="bdr-tabs">
            {REPORT_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? "active" : ""}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="bdr-report-meta">
            <span>Period: <b>{reportPeriodLabel}</b></span>
            <span>Visible tasks: <b>{visibleTasks.length}</b></span>
            <span>Visible grids: <b>{gridSummaryRows.length}</b></span>
            <span>Issues: <b>{issueSummaryRows.length}</b></span>
            <span>Last refresh: <b>{lastLoadedAt ? lastLoadedAt.toLocaleTimeString() : "N/A"}</b></span>
          </div>
        </div>
      )}

      {loading ? (
        <div className="bdr-empty">Loading Reports V1 data...</div>
      ) : (
        renderTabContent()
      )}
    </div>
  );
}

function safePercent(value, total) {
  if (!total) return 0;
  return Math.round((Number(value || 0) / Number(total || 0)) * 100);
}

function DonutCard({ title, value, total, label, tone = "default" }) {
  const percent = safePercent(value, total);

  return (
    <section className={`bdr-chart-card donut ${tone}`}>
      <div className="bdr-chart-head">
        <h3>{title}</h3>
        <span>{label}</span>
      </div>
      <div className="bdr-donut-wrap">
        <div className="bdr-donut" style={{ "--pct": `${percent}%` }}>
          <div>
            <strong>{percent}%</strong>
            <span>{value}/{total || 0}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function HorizontalBarChart({ title, rows = [] }) {
  const max = Math.max(1, ...rows.map((row) => Number(row.total || row.value || 0)));

  return (
    <section className="bdr-chart-card">
      <div className="bdr-chart-head">
        <h3>{title}</h3>
        <span>{rows.reduce((sum, row) => sum + Number(row.value || 0), 0)} total</span>
      </div>
      <div className="bdr-bar-list">
        {rows.length === 0 ? (
          <p className="bdr-muted-line">No chart data available.</p>
        ) : (
          rows.map((row) => {
            const percent = row.total
              ? safePercent(row.value, row.total)
              : Math.round((Number(row.value || 0) / max) * 100);

            return (
              <div key={row.label} className="bdr-bar-row">
                <div className="bdr-bar-label">
                  <strong>{row.label}</strong>
                  <span>{row.detail || row.value}</span>
                </div>
                <div className="bdr-bar-track">
                  <div className={`bdr-bar-fill ${row.tone || "default"}`} style={{ width: `${Math.max(percent, row.value ? 4 : 0)}%` }} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function ReportStat({ label, value, tone = "default" }) {
  return (
    <div className={`bdr-stat ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ReadinessLine({ label, value, tone }) {
  return (
    <div className={`bdr-readiness ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PanelTitle({ title, subtitle }) {
  return (
    <div className="bdr-panel-title">
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function ReportTable({ columns, rows, emptyText }) {
  if (!rows.length) {
    return <div className="bdr-empty small">{emptyText}</div>;
  }

  return (
    <div className="bdr-table-wrap">
      <table className="bdr-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}_${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportsStyles() {
  return (
    <style>{`
      .bdr-page {
        --r-surface: #071323;
        --r-surface-2: #0b1a31;
        --r-surface-3: #102440;
        --r-card: #0b1a31;
        --r-card-2: #10233f;
        --r-border: rgba(96, 165, 250, 0.18);
        --r-border-strong: rgba(96, 165, 250, 0.34);
        --r-text: #e8f1ff;
        --r-strong: #ffffff;
        --r-muted: #9fb3d1;
        --r-muted-2: #c9d7ee;
        --r-blue: #60a5fa;
        --r-green: #22c55e;
        --r-red: #fb7185;
        --r-yellow: #fbbf24;
        --r-shadow: 0 16px 34px rgba(0, 0, 0, 0.28);
        width: 100%;
        padding: 18px 20px 30px;
        color: var(--r-text);
        text-align: left;
      }

      body.bd-theme-day .bdr-page,
      .theme-day .bdr-page {
        --r-surface: #ffffff;
        --r-surface-2: #f8fbff;
        --r-surface-3: #eef6ff;
        --r-card: #ffffff;
        --r-card-2: #f8fbff;
        --r-border: #dbeafe;
        --r-border-strong: #bfdbfe;
        --r-text: #0f172a;
        --r-strong: #0f172a;
        --r-muted: #475569;
        --r-muted-2: #334155;
        --r-blue: #2563eb;
        --r-green: #16a34a;
        --r-red: #dc2626;
        --r-yellow: #d97706;
        --r-shadow: 0 14px 32px rgba(15, 23, 42, 0.07);
      }

      .bdr-page * {
        box-sizing: border-box;
      }

      .bdr-report-cover {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 18px;
        background:
          linear-gradient(135deg, rgba(37, 99, 235, 0.18), rgba(14, 165, 233, 0.08)),
          linear-gradient(180deg, var(--r-card-2), var(--r-card));
        border: 1px solid var(--r-border-strong);
        border-radius: 18px;
        padding: 16px 18px;
        margin-bottom: 16px;
        box-shadow: var(--r-shadow);
      }

      .bdr-brand-lockup {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .bdr-brand-logo {
        width: 54px;
        height: 54px;
        display: grid;
        place-items: center;
        border-radius: 16px;
        background: linear-gradient(135deg, rgba(96, 165, 250, 0.25), rgba(34, 197, 94, 0.16));
        border: 1px solid var(--r-border-strong);
        font-size: 30px;
      }

      .bdr-brand-name {
        color: var(--r-strong);
        font-size: 28px;
        font-weight: 950;
        letter-spacing: -0.02em;
        line-height: 1;
      }

      .bdr-brand-subtitle {
        color: var(--r-muted-2);
        font-size: 13px;
        font-weight: 800;
        margin-top: 6px;
      }

      .bdr-cover-meta {
        min-width: 280px;
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 6px 10px;
        align-items: center;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid var(--r-border);
        border-radius: 14px;
        padding: 10px 12px;
      }

      .bdr-cover-meta span {
        color: var(--r-muted);
        font-size: 11px;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .bdr-cover-meta strong {
        color: var(--r-strong);
        font-size: 12px;
        text-align: right;
      }

      .bdr-header {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 14px;
        margin-bottom: 16px;
        text-align: left;
        align-items: end;
      }

      .bdr-kicker {
        margin: 0 0 4px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--r-blue);
        font-size: 11px;
        font-weight: 900;
      }

      .bdr-header h2 {
        margin: 0;
        color: var(--r-strong);
        font-size: 28px;
        line-height: 1.15;
      }

      .bdr-header p {
        margin: 8px 0 0;
        color: var(--r-muted-2);
        font-size: 14px;
        max-width: 900px;
        line-height: 1.35;
        text-align: left;
      }

      .bdr-header small {
        display: block;
        margin-top: 7px;
        color: var(--r-muted);
        font-size: 12px;
        font-weight: 800;
      }

      .bdr-header-actions {
        display: flex;
        gap: 9px;
        flex-wrap: nowrap;
        justify-content: flex-end;
        align-items: center;
        white-space: nowrap;
        width: auto;
      }

      .bdr-header-actions button,
      .bdr-panel-head button,
      .bdr-tabs button {
        border: 1px solid var(--r-border-strong);
        background: var(--r-card-2);
        color: var(--r-strong);
        border-radius: 12px;
        padding: 9px 11px;
        font-size: 11px;
        font-weight: 900;
        cursor: pointer;
      }

      .bdr-header-actions button:hover,
      .bdr-panel-head button:hover,
      .bdr-tabs button:hover {
        filter: brightness(1.08);
      }

      .bdr-toolbar {
        display: grid;
        grid-template-columns: minmax(260px, 1fr) 220px 200px 190px;
        gap: 10px;
        margin-bottom: 12px;
      }

      .bdr-toolbar input,
      .bdr-toolbar select {
        width: 100%;
        border: 1px solid var(--r-border-strong);
        background: var(--r-surface);
        color: var(--r-text);
        border-radius: 12px;
        padding: 11px 12px;
        font-size: 13px;
        outline: none;
      }

      .bdr-toolbar input::placeholder {
        color: var(--r-muted);
      }

      .bdr-toolbar input:focus,
      .bdr-toolbar select:focus {
        border-color: var(--r-blue);
        box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.14);
      }

      .bdr-tabs {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }

      .bdr-tabs button {
        padding: 8px 11px;
        border-radius: 999px;
      }

      .bdr-tabs button.active {
        background: linear-gradient(135deg, rgba(37, 99, 235, 0.92), rgba(14, 165, 233, 0.74));
        color: #ffffff;
        border-color: rgba(147, 197, 253, 0.5);
      }

      .bdr-report-meta {
        display: flex;
        gap: 9px;
        flex-wrap: wrap;
        margin-bottom: 14px;
      }

      .bdr-report-meta span {
        background: var(--r-surface-2);
        border: 1px solid var(--r-border);
        border-radius: 999px;
        padding: 6px 10px;
        color: var(--r-muted);
        font-size: 12px;
        font-weight: 800;
      }

      .bdr-report-meta b {
        color: var(--r-strong);
      }

      .bdr-stat-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 14px;
      }

      .bdr-stat-grid.qc {
        grid-template-columns: repeat(8, minmax(0, 1fr));
      }

      .bdr-stat {
        background: linear-gradient(180deg, var(--r-card-2), var(--r-card));
        border: 1px solid var(--r-border);
        border-radius: 16px;
        min-height: 82px;
        padding: 14px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        text-align: center;
        box-shadow: var(--r-shadow);
      }

      .bdr-stat strong {
        color: var(--r-strong);
        font-size: 24px;
        line-height: 1;
      }

      .bdr-stat span {
        margin-top: 8px;
        color: var(--r-muted);
        font-size: 12px;
        font-weight: 900;
      }

      .bdr-stat.good strong { color: #4ade80; }
      .bdr-stat.bad strong { color: #fb7185; }
      .bdr-stat.warn strong { color: #fbbf24; }
      .bdr-stat.info strong { color: #38bdf8; }

      body.bd-theme-day .bdr-stat.good strong,
      .theme-day .bdr-stat.good strong { color: #16a34a; }
      body.bd-theme-day .bdr-stat.bad strong,
      .theme-day .bdr-stat.bad strong { color: #dc2626; }
      body.bd-theme-day .bdr-stat.warn strong,
      .theme-day .bdr-stat.warn strong { color: #d97706; }
      body.bd-theme-day .bdr-stat.info strong,
      .theme-day .bdr-stat.info strong { color: #0284c7; }

      .bdr-chart-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 14px;
      }

      .bdr-chart-card {
        background: linear-gradient(180deg, var(--r-card), var(--r-surface));
        border: 1px solid var(--r-border);
        border-radius: 18px;
        padding: 14px;
        box-shadow: var(--r-shadow);
        min-width: 0;
      }

      .bdr-chart-head {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: flex-start;
        margin-bottom: 12px;
      }

      .bdr-chart-head h3 {
        margin: 0;
        color: var(--r-strong);
        font-size: 15px;
        line-height: 1.25;
      }

      .bdr-chart-head span,
      .bdr-muted-line {
        color: var(--r-muted);
        font-size: 12px;
        font-weight: 800;
      }

      .bdr-donut-wrap {
        display: flex;
        justify-content: center;
        padding: 2px 0 4px;
      }

      .bdr-donut {
        width: 132px;
        height: 132px;
        border-radius: 999px;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at center, var(--r-card) 0 54%, transparent 55%),
          conic-gradient(var(--r-green) var(--pct), rgba(148, 163, 184, 0.18) 0);
      }

      .bdr-donut div {
        text-align: center;
      }

      .bdr-donut strong {
        display: block;
        color: var(--r-strong);
        font-size: 25px;
        line-height: 1;
      }

      .bdr-donut span {
        display: block;
        margin-top: 6px;
        color: var(--r-muted);
        font-size: 12px;
        font-weight: 900;
      }

      .bdr-bar-list {
        display: grid;
        gap: 10px;
      }

      .bdr-bar-label {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 5px;
      }

      .bdr-bar-label strong {
        color: var(--r-muted-2);
        font-size: 12px;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .bdr-bar-label span {
        color: var(--r-muted);
        font-size: 12px;
        font-weight: 900;
        white-space: nowrap;
      }

      .bdr-bar-track {
        height: 9px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.18);
        overflow: hidden;
      }

      .bdr-bar-fill {
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, #60a5fa, #38bdf8);
      }

      .bdr-bar-fill.good { background: linear-gradient(90deg, #22c55e, #86efac); }
      .bdr-bar-fill.bad { background: linear-gradient(90deg, #ef4444, #fb7185); }
      .bdr-bar-fill.warn { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
      .bdr-bar-fill.info { background: linear-gradient(90deg, #2563eb, #38bdf8); }

      .bdr-two-column {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 14px;
        margin-bottom: 14px;
      }

      .bdr-panel,
      .bdr-empty {
        background: linear-gradient(180deg, var(--r-card), var(--r-surface));
        border: 1px solid var(--r-border);
        border-radius: 18px;
        padding: 16px;
        box-shadow: var(--r-shadow);
      }

      .bdr-empty {
        color: var(--r-muted);
        font-weight: 900;
      }

      .bdr-empty.small {
        box-shadow: none;
        background: var(--r-surface-2);
      }

      .bdr-panel-head,
      .bdr-panel-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
      }

      .bdr-panel h3,
      .bdr-panel-title h3 {
        margin: 0;
        color: var(--r-strong);
        font-size: 18px;
      }

      .bdr-panel-head span,
      .bdr-panel-title p {
        margin: 4px 0 0;
        color: var(--r-muted);
        font-size: 12px;
        font-weight: 800;
      }

      .bdr-decision-list {
        display: grid;
        gap: 11px;
      }

      .bdr-decision-row > div {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        margin-bottom: 6px;
      }

      .bdr-decision-row b {
        color: var(--r-strong);
      }

      .bdr-progress {
        height: 8px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(148, 163, 184, 0.18);
      }

      body.bd-theme-day .bdr-progress,
      .theme-day .bdr-progress {
        background: #e2e8f0;
      }

      .bdr-progress div {
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, #2563eb, #22c55e);
      }

      .bdr-readiness-list {
        display: grid;
        gap: 10px;
      }

      .bdr-readiness {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        border: 1px solid var(--r-border);
        background: var(--r-surface-2);
        border-radius: 14px;
        padding: 11px 12px;
      }

      .bdr-readiness span {
        color: var(--r-muted-2);
        font-size: 13px;
        font-weight: 800;
      }

      .bdr-readiness strong {
        color: var(--r-strong);
        font-size: 18px;
      }

      .bdr-readiness.good strong { color: #4ade80; }
      .bdr-readiness.bad strong { color: #fb7185; }
      .bdr-readiness.warn strong { color: #fbbf24; }
      .bdr-readiness.info strong { color: #38bdf8; }

      .bdr-table-wrap {
        width: 100%;
        overflow: auto;
        border: 1px solid var(--r-border);
        border-radius: 14px;
      }

      .bdr-table {
        width: 100%;
        border-collapse: collapse;
        min-width: 980px;
      }

      .bdr-table th,
      .bdr-table td {
        padding: 10px 11px;
        border-bottom: 1px solid var(--r-border);
        text-align: left;
        vertical-align: top;
        font-size: 12px;
      }

      .bdr-table th {
        position: sticky;
        top: 0;
        background: var(--r-surface-3);
        color: var(--r-muted-2);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-weight: 900;
        z-index: 1;
      }

      .bdr-table td {
        color: var(--r-muted-2);
      }

      .bdr-table td strong {
        color: var(--r-strong);
      }

      .bdr-table tr:hover td {
        background: rgba(96, 165, 250, 0.06);
      }

      .bdr-badge,
      .bdr-status {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        padding: 5px 9px;
        font-size: 11px;
        font-weight: 900;
        white-space: nowrap;
      }

      .bdr-badge-pass { background: rgba(34, 197, 94, 0.16); color: #86efac; }
      .bdr-badge-fail { background: rgba(239, 68, 68, 0.16); color: #fca5a5; }
      .bdr-badge-redrive { background: rgba(244, 63, 94, 0.16); color: #fda4af; }
      .bdr-badge-warning { background: rgba(245, 158, 11, 0.16); color: #fcd34d; }
      .bdr-badge-waiting { background: rgba(56, 189, 248, 0.16); color: #7dd3fc; }
      .bdr-badge-muted { background: rgba(148, 163, 184, 0.16); color: #cbd5e1; }

      .bdr-status { background: rgba(148, 163, 184, 0.14); color: #cbd5e1; }
      .bdr-status-completed { background: rgba(34, 197, 94, 0.16); color: #86efac; }
      .bdr-status-progress { background: rgba(56, 189, 248, 0.16); color: #7dd3fc; }
      .bdr-status-assigned { background: rgba(96, 165, 250, 0.16); color: #93c5fd; }
      .bdr-status-pending { background: rgba(245, 158, 11, 0.16); color: #fcd34d; }

      body.bd-theme-day .bdr-badge-pass,
      .theme-day .bdr-badge-pass { background: #dcfce7; color: #166534; }
      body.bd-theme-day .bdr-badge-fail,
      .theme-day .bdr-badge-fail { background: #fee2e2; color: #991b1b; }
      body.bd-theme-day .bdr-badge-redrive,
      .theme-day .bdr-badge-redrive { background: #ffe4e6; color: #9f1239; }
      body.bd-theme-day .bdr-badge-warning,
      .theme-day .bdr-badge-warning { background: #fef3c7; color: #92400e; }
      body.bd-theme-day .bdr-badge-waiting,
      .theme-day .bdr-badge-waiting { background: #e0f2fe; color: #075985; }
      body.bd-theme-day .bdr-badge-muted,
      .theme-day .bdr-badge-muted { background: #f1f5f9; color: #475569; }

      body.bd-theme-day .bdr-status,
      .theme-day .bdr-status { background: #f1f5f9; color: #475569; }
      body.bd-theme-day .bdr-status-completed,
      .theme-day .bdr-status-completed { background: #dcfce7; color: #166534; }
      body.bd-theme-day .bdr-status-progress,
      .theme-day .bdr-status-progress { background: #e0f2fe; color: #075985; }
      body.bd-theme-day .bdr-status-assigned,
      .theme-day .bdr-status-assigned { background: #dbeafe; color: #1e40af; }
      body.bd-theme-day .bdr-status-pending,
      .theme-day .bdr-status-pending { background: #fef3c7; color: #92400e; }


      .bdr-section-kicker {
        margin: 0 0 4px;
        color: var(--r-blue);
        font-size: 11px;
        font-weight: 950;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .bdr-exec-hero {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 170px;
        gap: 12px;
        align-items: stretch;
        background: linear-gradient(135deg, rgba(37, 99, 235, 0.12), rgba(34, 197, 94, 0.08));
        border: 1px solid var(--r-border-strong);
        border-radius: 18px;
        padding: 16px;
        margin-bottom: 14px;
        box-shadow: var(--r-shadow);
      }

      .bdr-exec-hero h3 {
        margin: 0;
        color: var(--r-strong);
        font-size: 24px;
        line-height: 1.2;
      }

      .bdr-exec-hero p {
        margin: 7px 0 0;
        color: var(--r-muted-2);
        font-size: 13px;
      }

      .bdr-readiness-score {
        border: 1px solid var(--r-border);
        border-radius: 16px;
        display: grid;
        place-items: center;
        text-align: center;
        background: var(--r-card);
        min-height: 96px;
      }

      .bdr-readiness-score span {
        color: var(--r-muted);
        font-size: 12px;
        font-weight: 900;
      }

      .bdr-readiness-score strong {
        color: var(--r-strong);
        font-size: 34px;
        line-height: 1;
      }

      .bdr-readiness-score.good strong { color: var(--r-green); }
      .bdr-readiness-score.warn strong { color: var(--r-yellow); }
      .bdr-readiness-score.bad strong { color: var(--r-red); }

      .bdr-project-snapshot-first {
        margin-bottom: 14px;
      }

      .bdr-exec-grid {
        display: grid;
        grid-template-columns: 0.85fr 1.15fr 1.15fr 1.15fr;
        gap: 12px;
        margin-bottom: 14px;
      }

      .bdr-two-column.executive {
        margin-bottom: 14px;
      }

      .bdr-action-list,
      .bdr-readiness-list.compact {
        display: grid;
        gap: 8px;
      }

      .bdr-detail-strip {
        margin-top: 2px;
      }

      .bdr-detail-buttons {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .bdr-detail-buttons button {
        border: 1px solid var(--r-border-strong);
        background: var(--r-card-2);
        color: var(--r-strong);
        border-radius: 999px;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 900;
        cursor: pointer;
      }

      .bdr-print-package {
        display: none;
      }

      .bdr-page-hero {
        background: linear-gradient(180deg, var(--r-card), var(--r-surface));
        border: 1px solid var(--r-border-strong);
        border-radius: 18px;
        padding: 18px 20px;
        box-shadow: var(--r-shadow);
        align-items: center;
      }

      .bdr-hero-copy {
        min-width: 0;
        text-align: left;
      }

      .bdr-hero-side {
        display: grid;
        gap: 12px;
        justify-items: end;
        align-content: center;
      }

      .bdr-workflow-pill {
        border: 1px solid var(--r-border-strong);
        color: var(--r-blue);
        background: var(--r-card-2);
        border-radius: 999px;
        padding: 10px 16px;
        font-size: 13px;
        font-weight: 950;
        white-space: nowrap;
      }

      .bdr-hero-meta-line {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
      }

      .bdr-hero-meta-line span {
        color: var(--r-muted);
        background: var(--r-surface-2);
        border: 1px solid var(--r-border);
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 12px;
        font-weight: 850;
      }

      .bdr-hero-meta-line b {
        color: var(--r-strong);
      }

      .bdr-export-wrap {
        position: relative;
      }

      .bdr-export-menu {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        z-index: 20;
        min-width: 180px;
        display: grid;
        gap: 6px;
        background: var(--r-card);
        border: 1px solid var(--r-border-strong);
        border-radius: 14px;
        padding: 8px;
        box-shadow: var(--r-shadow);
      }

      .bdr-export-menu button {
        width: 100%;
        text-align: left;
        justify-content: flex-start;
        background: var(--r-surface-2);
      }

      .bdr-toolbar {
        grid-template-columns: minmax(260px, 1fr) 220px 210px 190px auto;
        align-items: center;
        background: linear-gradient(180deg, var(--r-card), var(--r-surface));
        border: 1px solid var(--r-border);
        border-radius: 16px;
        padding: 12px;
        box-shadow: var(--r-shadow);
      }

      .bdr-toolbar.overview {
        grid-template-columns: minmax(260px, 1fr) 220px 210px auto;
      }

      .bdr-advanced-toggle {
        border: 1px solid var(--r-border-strong);
        background: var(--r-card-2);
        color: var(--r-strong);
        border-radius: 12px;
        padding: 11px 12px;
        font-size: 11px;
        font-weight: 900;
        cursor: pointer;
        white-space: nowrap;
      }

      .bdr-advanced-panel {
        background: linear-gradient(180deg, var(--r-card), var(--r-surface));
        border: 1px solid var(--r-border);
        border-radius: 16px;
        padding: 12px;
        margin-bottom: 14px;
        box-shadow: var(--r-shadow);
      }

      .bdr-advanced-panel .bdr-tabs,
      .bdr-advanced-panel .bdr-report-meta {
        margin-bottom: 0;
      }

      .bdr-advanced-panel .bdr-tabs + .bdr-report-meta {
        margin-top: 10px;
      }

      .bdr-panel-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      .bdr-hidden-note {
        border: 1px dashed var(--r-border-strong);
        background: var(--r-surface-2);
        color: var(--r-muted-2);
        border-radius: 12px;
        padding: 8px 11px;
        min-height: 0;
        font-size: 12px;
        line-height: 1.25;
        font-weight: 850;
        text-align: left;
      }



      @media print {
        @page { size: landscape; margin: 0.35in; }

        html, body, #root {
          background: #ffffff !important;
          margin: 0 !important;
          padding: 0 !important;
        }

        body * { visibility: hidden !important; }

        .bdr-page,
        .bdr-print-package,
        .bdr-print-package * {
          visibility: visible !important;
        }

        .bdr-page {
          position: absolute !important;
          left: 0 !important;
          top: 0 !important;
          width: 100% !important;
          padding: 0 !important;
          margin: 0 !important;
          background: #ffffff !important;
          color: #111827 !important;
          --r-surface: #ffffff;
          --r-surface-2: #ffffff;
          --r-surface-3: #eef6ff;
          --r-card: #ffffff;
          --r-card-2: #ffffff;
          --r-border: #cbd5e1;
          --r-border-strong: #94a3b8;
          --r-text: #111827;
          --r-strong: #111827;
          --r-muted: #475569;
          --r-muted-2: #334155;
          --r-shadow: none;
        }

        .bdr-page > :not(.bdr-print-package) {
          display: none !important;
        }

        .bdr-print-package {
          display: block !important;
          width: 100% !important;
          max-width: none !important;
        }

        .bdr-print-cover {
          display: grid !important;
          grid-template-columns: 1.3fr 1fr !important;
          gap: 14px !important;
          border: 1px solid #94a3b8 !important;
          border-radius: 14px !important;
          padding: 14px !important;
          margin-bottom: 10px !important;
          break-inside: avoid;
        }

        .bdr-print-brand {
          display: flex !important;
          align-items: center !important;
          gap: 9px !important;
          font-size: 24px !important;
          color: #0f172a !important;
        }

        .bdr-print-brand span {
          width: 36px !important;
          height: 36px !important;
          display: inline-grid !important;
          place-items: center !important;
          border-radius: 10px !important;
          background: #dbeafe !important;
        }

        .bdr-print-cover h1 {
          margin: 8px 0 4px !important;
          color: #0f172a !important;
          font-size: 22px !important;
        }

        .bdr-print-cover p,
        .bdr-print-meta p {
          margin: 4px 0 !important;
          color: #334155 !important;
          font-size: 11px !important;
        }

        .bdr-print-summary {
          display: grid !important;
          grid-template-columns: repeat(6, 1fr) !important;
          gap: 8px !important;
          margin-bottom: 10px !important;
          break-inside: avoid;
        }

        .bdr-print-summary div {
          border: 1px solid #cbd5e1 !important;
          border-radius: 12px !important;
          padding: 8px !important;
          text-align: center !important;
          background: #f8fbff !important;
        }

        .bdr-print-summary span {
          display: block !important;
          color: #475569 !important;
          font-size: 9px !important;
          font-weight: 800 !important;
          text-transform: uppercase !important;
        }

        .bdr-print-summary b {
          display: block !important;
          color: #0f172a !important;
          font-size: 19px !important;
        }

        .bdr-print-charts {
          display: grid !important;
          grid-template-columns: repeat(4, 1fr) !important;
          gap: 8px !important;
          margin-bottom: 10px !important;
          break-inside: avoid;
        }

        .bdr-print-two {
          display: grid !important;
          grid-template-columns: 0.72fr 1.28fr !important;
          gap: 10px !important;
          align-items: start !important;
        }

        .bdr-print-two h2 {
          margin: 0 0 6px !important;
          font-size: 14px !important;
          color: #0f172a !important;
        }

        .bdr-chart-card,
        .bdr-panel,
        .bdr-readiness,
        .bdr-table-wrap {
          box-shadow: none !important;
          border: 1px solid #cbd5e1 !important;
          border-radius: 10px !important;
          break-inside: avoid;
          background: #ffffff !important;
        }

        .bdr-chart-card { padding: 8px !important; min-height: auto !important; }
        .bdr-chart-head { margin-bottom: 6px !important; }
        .bdr-chart-head h3 { font-size: 11px !important; color: #0f172a !important; }
        .bdr-chart-head span, .bdr-bar-label strong, .bdr-bar-label span { font-size: 9px !important; color: #334155 !important; }
        .bdr-bar-list { gap: 5px !important; }
        .bdr-bar-track { height: 6px !important; background: #e2e8f0 !important; }
        .bdr-donut { width: 88px !important; height: 88px !important; }
        .bdr-donut strong { font-size: 17px !important; color: #0f172a !important; }
        .bdr-donut span { font-size: 9px !important; color: #475569 !important; }
        .bdr-table-wrap { overflow: visible !important; }
        .bdr-table { min-width: 0 !important; width: 100% !important; }
        .bdr-table th, .bdr-table td { padding: 4px 5px !important; font-size: 8px !important; color: #111827 !important; }
        .bdr-table th { background: #eaf4ff !important; }
        .bdr-table td strong { color: #0f172a !important; }
        .bdr-badge, .bdr-status { padding: 3px 6px !important; font-size: 8px !important; }
        .bdr-readiness { padding: 6px 8px !important; }
        .bdr-readiness span { font-size: 9px !important; color: #334155 !important; }
        .bdr-readiness strong { font-size: 12px !important; color: #0f172a !important; }
      }

      @media (max-width: 1300px) {
        .bdr-stat-grid.qc,
        .bdr-chart-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }

      @media (max-width: 1000px) {
        .bdr-report-cover,
        .bdr-header,
        .bdr-two-column {
          grid-template-columns: 1fr;
          flex-direction: column;
        }

        .bdr-header-actions {
          justify-content: flex-start;
          flex-wrap: wrap;
        }

        .bdr-toolbar {
          grid-template-columns: 1fr;
        }

        .bdr-stat-grid,
        .bdr-stat-grid.qc,
        .bdr-chart-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 700px) {
        .bdr-cover-meta {
          min-width: 0;
          width: 100%;
          grid-template-columns: 1fr;
        }

        .bdr-cover-meta strong {
          text-align: left;
        }

        .bdr-page {
          padding: 14px;
        }

        .bdr-stat-grid,
        .bdr-stat-grid.qc,
        .bdr-chart-grid {
          grid-template-columns: 1fr;
        }
      }
    `}</style>
  );
}
