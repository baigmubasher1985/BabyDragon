import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const QC_DECISIONS = [
  "QC Passed",
  "QC Failed",
  "Needs Re-drive",
  "Waiting for Logs",
  "Log Naming Issue",
  "Missing Evidence",
];

const EMPTY_QC = {
  log_received: false,
  log_naming_correct: false,
  required_evidence_received: false,
  checklist_reviewed: false,
  issues_reviewed: false,
  notes_photos_reviewed: false,
  qc_decision: "Waiting for Logs",
  qc_notes: "",
  redrive_needed: false,
  redrive_reason: "",
};

const DEFAULT_CHECKLIST_LABELS = [
  "Reached assigned grid/site",
  "Opened assigned route",
  "Started testing in RF tool",
  "Required drive/testing completed",
  "Logs collected in RF tool",
  "Logs uploaded/handed to team",
  "Photo/evidence added if needed",
  "Issue reported if any",
];

function getTaskFEId(task) {
  return (
    task.assigned_fe ||
    task.assigned_fe_id ||
    task.assigned_to ||
    task.fe_id ||
    null
  );
}

function getTaskTitle(task) {
  return (
    task.target_name ||
    task.grid_name ||
    task.site_name ||
    task.cluster_name ||
    task.name ||
    task.title ||
    "Completed Task"
  );
}

function makeKey(taskId, gridId) {
  return `${taskId}__${gridId || "task"}`;
}

function formatDate(value) {
  if (!value) return "Not reviewed yet";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Not reviewed yet";
  }
}

function getDecisionClass(decision) {
  if (decision === "QC Passed") return "bdqc-badge bdqc-badge-pass";
  if (decision === "QC Failed") return "bdqc-badge bdqc-badge-fail";
  if (decision === "Needs Re-drive") return "bdqc-badge bdqc-badge-redrive";
  if (decision === "Log Naming Issue") return "bdqc-badge bdqc-badge-warning";
  if (decision === "Missing Evidence") return "bdqc-badge bdqc-badge-warning";
  return "bdqc-badge bdqc-badge-waiting";
}

function isChecklistChecked(row) {
  return (
    row.is_done === true ||
    row.is_checked === true ||
    row.checked === true ||
    row.completed === true ||
    row.value === true ||
    row.status === "done" ||
    row.status === "completed"
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

function getIssueTitle(issue) {
  return issue.issue_type || issue.type || issue.category || "Issue";
}

function getUpdatePhotoUrl(update) {
  return (
    update.image_url ||
    update.photo_url ||
    update.evidence_url ||
    update.file_url ||
    update.attachment_url ||
    update.public_url ||
    null
  );
}

function hasUpdatePhotoEvidence(update) {
  return !!(
    getUpdatePhotoUrl(update) ||
    update?.image_path ||
    update?.photo_path ||
    update?.file_path ||
    update?.storage_path ||
    update?.attachment_path ||
    update?.evidence_path
  );
}

function getUpdateText(update) {
  return update.comment || update.notes || update.note || update.description || "Update submitted";
}

function hasUpdateGps(update) {
  return !!(update?.latitude && update?.longitude);
}

function isAutoGpsUpdate(update) {
  const text = String(getUpdateText(update) || "").trim().toLowerCase();
  const hasPhoto = !!getUpdatePhotoUrl(update);

  return (
    hasUpdateGps(update) &&
    !hasPhoto &&
    (text.includes("auto gps") ||
      text.includes("gps auto") ||
      text === "gps point logged" ||
      text === "no comment provided")
  );
}

function isUsefulEvidenceUpdate(update) {
  return !isAutoGpsUpdate(update);
}

function hasMeaningfulFieldText(update) {
  const text = String(getUpdateText(update) || "").trim().toLowerCase();

  if (!text) return false;

  return ![
    "update submitted",
    "no comment provided",
    "gps point logged",
    "auto gps point",
    "gps auto point",
  ].includes(text);
}

function hasQcEvidence(update) {
  if (!update || isAutoGpsUpdate(update)) return false;

  return (
    hasUpdatePhotoEvidence(update) ||
    hasUpdateGps(update) ||
    hasMeaningfulFieldText(update)
  );
}

function hasDetectedEvidence(qc, usefulUpdateRows) {
  return !!qc?.required_evidence_received || (usefulUpdateRows || []).some(hasQcEvidence);
}

function getUsefulEvidenceUpdates(rows) {
  return (rows || []).filter(isUsefulEvidenceUpdate);
}

function getUpdateKind(update) {
  if (getUpdatePhotoUrl(update)) return "Photo";
  if (hasUpdateGps(update)) return isAutoGpsUpdate(update) ? "Auto GPS" : "GPS Checkpoint";
  return "Field Note";
}

function getAssignedFeId(task) {
  return (
    task.assigned_to ||
    task.assigned_fe ||
    task.assigned_fe_id ||
    task.fe_id ||
    null
  );
}

function makeRedriveTitle(task) {
  const baseTitle = getTaskTitle(task);
  return baseTitle.toLowerCase().startsWith("re-drive")
    ? baseTitle
    : `Re-drive - ${baseTitle}`;
}

function makeRedriveNotes(task, qc, grid) {
  const lines = [
    "Re-drive task created from QC Review.",
    `Original task: ${getTaskTitle(task)}`,
  ];

  if (grid?.name) lines.push(`Grid: ${grid.name}`);
  if (qc?.qc_decision) lines.push(`QC decision: ${qc.qc_decision}`);
  if (qc?.redrive_reason) lines.push(`Re-drive reason: ${qc.redrive_reason}`);
  if (qc?.qc_notes) lines.push(`QC notes: ${qc.qc_notes}`);
  if (task?.notes) lines.push("", "Original task notes:", task.notes);

  return lines.filter((line) => line !== null && line !== undefined).join("\n");
}

function buildRedriveTaskPayload(task, qc, grid) {
  const blockedKeys = new Set([
    "id",
    "created_at",
    "updated_at",
    "started_at",
    "completed_at",
    "completed_by",
    "completion_notes",
    "projects",
  ]);

  const payload = {};

  Object.entries(task || {}).forEach(([key, value]) => {
    if (!blockedKeys.has(key)) {
      payload[key] = value;
    }
  });

  payload.status = getAssignedFeId(task) ? "assigned" : "pending";

  if ("target_name" in payload || task?.target_name) {
    payload.target_name = makeRedriveTitle(task);
  }

  if ("name" in payload && !("target_name" in payload)) {
    payload.name = makeRedriveTitle(task);
  }

  if ("title" in payload && !("target_name" in payload) && !("name" in payload)) {
    payload.title = makeRedriveTitle(task);
  }

  if ("notes" in payload || task?.notes !== undefined) {
    payload.notes = makeRedriveNotes(task, qc, grid);
  }

  if ("priority" in payload && !payload.priority) {
    payload.priority = "High";
  }

  return payload;
}


function CheckRow({ label, checked, onChange, helper }) {
  return (
    <label className="bdqc-check-row">
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{label}</strong>
        {helper ? <small>{helper}</small> : null}
      </span>
    </label>
  );
}

export default function QCReview() {
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState("");
  const [creatingRedriveKey, setCreatingRedriveKey] = useState("");
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState({});
  const [profiles, setProfiles] = useState({});
  const [taskGrids, setTaskGrids] = useState({});
  const [qcReviews, setQcReviews] = useState({});
  const [checklists, setChecklists] = useState({});
  const [issues, setIssues] = useState({});
  const [updates, setUpdates] = useState({});
  const [drafts, setDrafts] = useState({});
  const [searchText, setSearchText] = useState("");
  const [decisionFilter, setDecisionFilter] = useState("All");
  const [expandedCards, setExpandedCards] = useState({});

  useEffect(() => {
    loadQCData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function safeSelect(requestFn, fallback = []) {
    const { data, error } = await requestFn();

    if (error) {
      console.warn("QC Review optional query skipped:", error.message);
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


  async function fetchTaskUpdatesPaged(taskIds) {
    if (!taskIds.length) return [];

    const pageSize = 1000;
    const maxPages = 20;
    let from = 0;
    let allRows = [];

    for (let page = 0; page < maxPages; page += 1) {
      const { data, error } = await supabase
        .from("task_updates")
        .select("*")
        .in("task_id", taskIds)
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);

      if (error) {
        console.warn("QC Review task_updates query skipped:", error.message);
        return allRows;
      }

      const rows = data || [];
      allRows = allRows.concat(rows);

      if (rows.length < pageSize) break;
      from += pageSize;
    }

    return allRows;
  }

  async function loadQCData() {
    setLoading(true);

    const completedTasks = await safeSelect(() =>
      supabase
        .from("tasks")
        .select("*")
        .or("status.eq.completed,status.eq.Completed")
        .order("created_at", { ascending: false })
    );

    const taskIds = completedTasks.map((task) => task.id).filter(Boolean);

    if (taskIds.length === 0) {
      setTasks([]);
      setProjects({});
      setProfiles({});
      setTaskGrids({});
      setQcReviews({});
      setChecklists({});
      setIssues({});
      setUpdates({});
      setDrafts({});
      setLoading(false);
      return;
    }

    const projectIds = [
      ...new Set(completedTasks.map((task) => task.project_id).filter(Boolean)),
    ];

    const feIds = [
      ...new Set(completedTasks.map((task) => getTaskFEId(task)).filter(Boolean)),
    ];

    const [
      projectRows,
      profileRows,
      qcRows,
      taskGridRows,
      checklistRows,
      issueRows,
      updateRows,
    ] = await Promise.all([
      projectIds.length
        ? safeSelect(() => supabase.from("projects").select("*").in("id", projectIds))
        : [],

      feIds.length
        ? safeSelect(() => supabase.from("profiles").select("*").in("id", feIds))
        : [],

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
        () =>
          supabase
            .from("task_issue_reports")
            .select("*")
            .in("task_id", taskIds)
            .order("created_at", { ascending: false }),
        () => supabase.from("task_issues").select("*").in("task_id", taskIds),
      ]),

      fetchTaskUpdatesPaged(taskIds),
    ]);

    const projectMap = {};
    projectRows.forEach((project) => {
      projectMap[project.id] = project;
    });

    const profileMap = {};
    profileRows.forEach((profile) => {
      profileMap[profile.id] = profile;
    });

    const taskGridMap = {};
    taskGridRows.forEach((row) => {
      const taskId = row.task_id;
      if (!taskGridMap[taskId]) taskGridMap[taskId] = [];

      taskGridMap[taskId].push({
        id: row.grid_id,
        name: row.grids?.name || row.grid_name || row.name || row.grid_id || "Assigned Grid",
        market: row.grids?.market || row.market || "",
      });
    });

    const qcMap = {};
    qcRows.forEach((row) => {
      qcMap[makeKey(row.task_id, row.grid_id)] = row;
    });

    const checklistMap = {};
    checklistRows.forEach((row) => {
      if (!checklistMap[row.task_id]) checklistMap[row.task_id] = [];
      checklistMap[row.task_id].push(row);
    });

    const issueMap = {};
    issueRows.forEach((row) => {
      if (!issueMap[row.task_id]) issueMap[row.task_id] = [];
      issueMap[row.task_id].push(row);
    });

    const updateMap = {};
    updateRows.forEach((row) => {
      if (!updateMap[row.task_id]) updateMap[row.task_id] = [];
      updateMap[row.task_id].push(row);
    });

    const draftMap = {};
    completedTasks.forEach((task) => {
      const grids = taskGridMap[task.id]?.length
        ? taskGridMap[task.id]
        : [
            {
              id: task.grid_id || null,
              name:
                task.grid_name ||
                task.target_name ||
                task.grid_code ||
                task.grid_label ||
                null,
              market: task.market || null,
            },
          ];

      grids.forEach((grid) => {
        const key = makeKey(task.id, grid.id);
        draftMap[key] = {
          ...EMPTY_QC,
          ...(qcMap[key] || {}),
        };
      });
    });

    setTasks(completedTasks);
    setProjects(projectMap);
    setProfiles(profileMap);
    setTaskGrids(taskGridMap);
    setQcReviews(qcMap);
    setChecklists(checklistMap);
    setIssues(issueMap);
    setUpdates(updateMap);
    setDrafts(draftMap);
    setLoading(false);
  }

  const reviewItems = useMemo(() => {
    const items = [];

    tasks.forEach((task) => {
      const grids = taskGrids[task.id]?.length
        ? taskGrids[task.id]
        : [{ id: null, name: null, market: null }];

      grids.forEach((grid) => {
        const key = makeKey(task.id, grid.id);
        const qc = drafts[key] || EMPTY_QC;
        const project = projects[task.project_id] || {};
        const fe = profiles[getTaskFEId(task)] || {};

        items.push({
          key,
          task,
          grid,
          qc,
          project,
          fe,
          checklistRows: checklists[task.id] || [],
          issueRows: issues[task.id] || [],
          updateRows: updates[task.id] || [],
        });
      });
    });

    return items;
  }, [tasks, taskGrids, drafts, projects, profiles, checklists, issues, updates]);

  const filteredItems = useMemo(() => {
    const text = searchText.trim().toLowerCase();

    return reviewItems.filter((item) => {
      const title = getTaskTitle(item.task).toLowerCase();
      const gridName = (item.grid?.name || "").toLowerCase();
      const projectName = (item.project?.name || "").toLowerCase();
      const feName = (item.fe?.full_name || item.fe?.email || "").toLowerCase();
      const market = (
        item.grid?.market ||
        item.project?.market ||
        item.task?.market ||
        ""
      ).toLowerCase();

      const matchesSearch =
        !text ||
        title.includes(text) ||
        gridName.includes(text) ||
        projectName.includes(text) ||
        feName.includes(text) ||
        market.includes(text);

      const matchesDecision =
        decisionFilter === "All" || item.qc.qc_decision === decisionFilter;

      return matchesSearch && matchesDecision;
    });
  }, [reviewItems, searchText, decisionFilter]);

  function updateDraft(key, field, value) {
    setDrafts((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || EMPTY_QC),
        [field]: value,
      },
    }));
  }

  function toggleCardDetails(key) {
    setExpandedCards((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }

  async function saveQC(item) {
    setSavingKey(item.key);

    const { task, grid, qc } = item;
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError) {
      alert(userError.message);
      setSavingKey("");
      return;
    }

    const reviewerId = userData?.user?.id || null;
    const isRedrive = qc.qc_decision === "Needs Re-drive" || !!qc.redrive_needed;

    const payload = {
      task_id: task.id,
      grid_id: grid?.id || null,
      reviewer_id: reviewerId,
      log_received: !!qc.log_received,
      log_naming_correct: !!qc.log_naming_correct,
      required_evidence_received: !!qc.required_evidence_received,
      checklist_reviewed: !!qc.checklist_reviewed,
      issues_reviewed: !!qc.issues_reviewed,
      notes_photos_reviewed: !!qc.notes_photos_reviewed,
      qc_decision: qc.qc_decision || "Waiting for Logs",
      qc_notes: qc.qc_notes || null,
      redrive_needed: isRedrive,
      redrive_reason: qc.redrive_reason || null,
      reviewed_at: new Date().toISOString(),
    };

    const existingRow = qcReviews[item.key];
    let result;

    if (existingRow?.id) {
      result = await supabase
        .from("qc_reviews")
        .update(payload)
        .eq("id", existingRow.id)
        .select()
        .single();
    } else {
      result = await supabase.from("qc_reviews").insert(payload).select().single();
    }

    if (result.error) {
      alert(result.error.message);
      setSavingKey("");
      return;
    }

    setQcReviews((prev) => ({
      ...prev,
      [item.key]: result.data,
    }));

    setDrafts((prev) => ({
      ...prev,
      [item.key]: {
        ...EMPTY_QC,
        ...result.data,
      },
    }));

    setSavingKey("");
  }

  async function createRedriveTask(item) {
    const existingQc = qcReviews[item.key];

    if (!existingQc?.id) {
      alert("Please save the QC Review first, then create the re-drive task.");
      return;
    }

    if (existingQc.redrive_task_id) {
      alert("A re-drive task is already linked to this QC review.");
      return;
    }

    const confirmed = window.confirm(
      "Create a new re-drive task from this QC review?"
    );

    if (!confirmed) return;

    setCreatingRedriveKey(item.key);

    const payload = buildRedriveTaskPayload(item.task, item.qc, item.grid);

    const { data: newTask, error: taskError } = await supabase
      .from("tasks")
      .insert(payload)
      .select()
      .single();

    if (taskError) {
      alert(taskError.message);
      setCreatingRedriveKey("");
      return;
    }

    if (item.grid?.id) {
      const { error: gridError } = await supabase
        .from("task_grids")
        .insert({
          task_id: newTask.id,
          grid_id: item.grid.id,
        });

      if (gridError) {
        console.warn("Re-drive task created, but grid link was not copied:", gridError.message);
      }
    }

    const { data: updatedQc, error: qcError } = await supabase
      .from("qc_reviews")
      .update({
        redrive_task_id: newTask.id,
        redrive_needed: true,
        qc_decision: "Needs Re-drive",
      })
      .eq("id", existingQc.id)
      .select()
      .single();

    if (qcError) {
      alert(`Re-drive task was created, but QC link update failed: ${qcError.message}`);
      setCreatingRedriveKey("");
      return;
    }

    setQcReviews((prev) => ({
      ...prev,
      [item.key]: updatedQc,
    }));

    setDrafts((prev) => ({
      ...prev,
      [item.key]: {
        ...EMPTY_QC,
        ...updatedQc,
      },
    }));

    setCreatingRedriveKey("");
    alert("Re-drive task created and linked to this QC review.");
  }

  function checklistProgress(rows) {
    const checked = (rows || []).filter(isChecklistChecked).length;
    const total = Math.max((rows || []).length, DEFAULT_CHECKLIST_LABELS.length);
    const percent = total ? Math.round((checked / total) * 100) : 0;

    return { label: `${checked}/${total}`, checked, total, percent };
  }

  function checklistRowsForDisplay(rows) {
    if ((rows || []).length) return rows;

    return DEFAULT_CHECKLIST_LABELS.map((label, index) => ({
      id: `default-${index}`,
      label,
      is_done: false,
    }));
  }

  const totals = useMemo(() => {
    return {
      total: reviewItems.length,
      passed: reviewItems.filter((item) => item.qc.qc_decision === "QC Passed").length,
      redrive: reviewItems.filter(
        (item) => item.qc.qc_decision === "Needs Re-drive" || !!item.qc.redrive_needed
      ).length,
      waiting: reviewItems.filter((item) => item.qc.qc_decision === "Waiting for Logs").length,
    };
  }, [reviewItems]);

  if (loading) {
    return (
      <div className="bdqc-page">
        <QCReviewStyles />
        <div className="bdqc-header-card">
          <div>
            <p className="bdqc-kicker">QC & Reports</p>
            <h2>QC Review V1</h2>
            <p>Loading completed tasks for QC...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bdqc-page">
      <QCReviewStyles />

      <div className="bdqc-header-card">
        <div>
          <p className="bdqc-kicker">QC & Reports</p>
          <h2>QC Review V1</h2>
          <p>
            Review completed tasks/grids, checklist progress, FE issues, logs,
            evidence, and re-drive needs.
          </p>
        </div>

        <button type="button" className="bdqc-refresh-btn" onClick={loadQCData}>
          Refresh
        </button>
      </div>

      <div className="bdqc-stats-grid">
        <div className="bdqc-stat-card">
          <strong>{totals.total}</strong>
          <span>Total QC Items</span>
        </div>
        <div className="bdqc-stat-card">
          <strong>{totals.passed}</strong>
          <span>QC Passed</span>
        </div>
        <div className="bdqc-stat-card">
          <strong>{totals.redrive}</strong>
          <span>Needs Re-drive</span>
        </div>
        <div className="bdqc-stat-card">
          <strong>{totals.waiting}</strong>
          <span>Waiting for Logs</span>
        </div>
      </div>

      <div className="bdqc-toolbar">
        <input
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Search task, grid, market, project, FE..."
        />

        <select value={decisionFilter} onChange={(event) => setDecisionFilter(event.target.value)}>
          <option value="All">All QC Decisions</option>
          {QC_DECISIONS.map((decision) => (
            <option key={decision} value={decision}>
              {decision}
            </option>
          ))}
        </select>
      </div>

      {filteredItems.length === 0 ? (
        <div className="bdqc-empty-card">
          No completed tasks are ready for QC yet.
        </div>
      ) : (
        <div className="bdqc-review-list">
          {filteredItems.map((item) => {
            const {
              key,
              task,
              grid,
              qc,
              project,
              fe,
              checklistRows,
              issueRows,
              updateRows,
            } = item;

            const progress = checklistProgress(checklistRows);
            const usefulUpdateRows = getUsefulEvidenceUpdates(updateRows);
            const evidenceFound = hasDetectedEvidence(qc, usefulUpdateRows);
            const recentUpdates = usefulUpdateRows.slice(0, 4);
            const recentIssues = issueRows.slice(0, 4);
            const market = grid?.market || project.market || task.market || "N/A";
            const feLabel = fe.full_name || fe.email || getTaskFEId(task) || "N/A";
            const detailsHidden = !expandedCards[key];
            const existingQc = qcReviews[key];
            const isRedriveMarked =
              qc.qc_decision === "Needs Re-drive" || !!qc.redrive_needed;
            const displayDecision = isRedriveMarked ? "Needs Re-drive" : qc.qc_decision;
            const hasLinkedRedriveTask = !!(qc.redrive_task_id || existingQc?.redrive_task_id);

            return (
              <article key={key} className="bdqc-card">
                <div className="bdqc-card-top">
                  <div className="bdqc-title-block">
                    <div className="bdqc-title-row">
                      <h3>{getTaskTitle(task)}</h3>

                      <div className="bdqc-title-actions">
                        <span className={getDecisionClass(displayDecision)}>{displayDecision}</span>
                        <button
                          type="button"
                          className="bdqc-detail-toggle"
                          onClick={() => toggleCardDetails(key)}
                        >
                          {detailsHidden ? "Show Details" : "Hide Details"}
                        </button>
                      </div>
                    </div>

                    <div className="bdqc-meta-grid">
                      <span><b>Project:</b> {project.name || "N/A"}</span>
                      <span><b>Market:</b> {market}</span>
                      <span><b>Grid:</b> {grid?.name || "Task-level QC"}</span>
                      <span><b>FE:</b> {feLabel}</span>
                      <span><b>Status:</b> {task.status || "Completed"}</span>
                      <span><b>Reviewed:</b> {formatDate(qc.reviewed_at)}</span>
                    </div>
                  </div>
                </div>

                {detailsHidden ? (
                  <div className="bdqc-collapsed-summary">
                    <div>
                      <strong>{progress.label}</strong>
                      <span>Checklist</span>
                    </div>
                    <div>
                      <strong>{issueRows.length}</strong>
                      <span>Issues</span>
                    </div>
                    <div>
                      <strong>{usefulUpdateRows.length}</strong>
                      <span>Evidence Updates</span>
                    </div>
                    <div>
                      <strong>{qc.log_received ? "Yes" : "No"}</strong>
                      <span>Logs Received</span>
                    </div>
                    <div>
                      <strong>{evidenceFound ? "Yes" : "No"}</strong>
                      <span>Evidence Found</span>
                    </div>
                  </div>
                ) : (
                  <>
                <div className="bdqc-main-grid">
                  <section className="bdqc-panel">
                    <div className="bdqc-panel-heading">
                      <h4>FE Execution Review</h4>
                      <span>{progress.label}</span>
                    </div>

                    <div className="bdqc-progress-wrap">
                      <div className="bdqc-progress-info">
                        <span>Checklist progress</span>
                        <b>{progress.percent}%</b>
                      </div>
                      <div className="bdqc-progress-track">
                        <div style={{ width: `${progress.percent}%` }} />
                      </div>
                    </div>

                    <div className="bdqc-mini-grid">
                      <div>
                        <strong>{issueRows.length}</strong>
                        <span>Issues</span>
                      </div>
                      <div>
                        <strong>{usefulUpdateRows.length}</strong>
                        <span>Evidence Updates</span>
                      </div>
                    </div>

                    <CheckRow
                      label="Checklist reviewed"
                      checked={qc.checklist_reviewed}
                      onChange={(value) => updateDraft(key, "checklist_reviewed", value)}
                    />
                    <CheckRow
                      label="Issues reviewed"
                      checked={qc.issues_reviewed}
                      onChange={(value) => updateDraft(key, "issues_reviewed", value)}
                    />
                    <CheckRow
                      label="Notes/photos/evidence reviewed"
                      checked={qc.notes_photos_reviewed}
                      onChange={(value) => updateDraft(key, "notes_photos_reviewed", value)}
                    />
                  </section>

                  <section className="bdqc-panel">
                    <div className="bdqc-panel-heading">
                      <h4>Log / Evidence Checks</h4>
                    </div>

                    <CheckRow
                      label="Logs uploaded / received"
                      helper="Confirm files were handed over or uploaded."
                      checked={qc.log_received}
                      onChange={(value) => updateDraft(key, "log_received", value)}
                    />
                    <CheckRow
                      label="Log naming is correct"
                      helper="Check grid/site, date, market, and project naming."
                      checked={qc.log_naming_correct}
                      onChange={(value) => updateDraft(key, "log_naming_correct", value)}
                    />
                    <div className={evidenceFound ? "bdqc-evidence-found" : "bdqc-evidence-missing"}>
                      Evidence found from FE updates: {evidenceFound ? "Yes" : "No"}
                    </div>

                    <CheckRow
                      label="Required evidence received"
                      helper={
                        evidenceFound
                          ? "FE submitted usable evidence. Confirm it meets the project requirement before saving QC."
                          : "Photos, notes, GPS checkpoints, or required screenshots are still needed."
                      }
                      checked={qc.required_evidence_received}
                      onChange={(value) => updateDraft(key, "required_evidence_received", value)}
                    />
                  </section>

                  <section className="bdqc-panel bdqc-decision-panel">
                    <div className="bdqc-panel-heading">
                      <h4>QC Decision</h4>
                    </div>

                    <select
                      className="bdqc-input"
                      value={qc.qc_decision}
                      onChange={(event) => updateDraft(key, "qc_decision", event.target.value)}
                    >
                      {QC_DECISIONS.map((decision) => (
                        <option key={decision} value={decision}>
                          {decision}
                        </option>
                      ))}
                    </select>

                    <textarea
                      className="bdqc-input bdqc-textarea"
                      value={qc.qc_notes || ""}
                      onChange={(event) => updateDraft(key, "qc_notes", event.target.value)}
                      placeholder="QC notes..."
                      rows={4}
                    />

                    <CheckRow
                      label="Mark re-drive needed"
                      checked={qc.redrive_needed || qc.qc_decision === "Needs Re-drive"}
                      onChange={(value) => {
                        updateDraft(key, "redrive_needed", value);
                        if (value) updateDraft(key, "qc_decision", "Needs Re-drive");
                      }}
                    />

                    {(qc.redrive_needed || qc.qc_decision === "Needs Re-drive") && (
                      <textarea
                        className="bdqc-input bdqc-textarea"
                        value={qc.redrive_reason || ""}
                        onChange={(event) => updateDraft(key, "redrive_reason", event.target.value)}
                        placeholder="Re-drive reason..."
                        rows={3}
                      />
                    )}

                    <button
                      type="button"
                      className="bdqc-save-btn"
                      onClick={() => saveQC(item)}
                      disabled={savingKey === key}
                    >
                      <span>{savingKey === key ? "Saving..." : "Save QC Review"}</span>
                    </button>

                    {isRedriveMarked && (
                      <div className="bdqc-redrive-action">
                        {hasLinkedRedriveTask ? (
                          <div className="bdqc-redrive-linked">
                            Re-drive task linked
                          </div>
                        ) : existingQc?.id ? (
                          <button
                            type="button"
                            className="bdqc-redrive-btn"
                            onClick={() => createRedriveTask(item)}
                            disabled={creatingRedriveKey === key}
                          >
                            {creatingRedriveKey === key
                              ? "Creating Re-drive Task..."
                              : "Create Re-drive Task"}
                          </button>
                        ) : (
                          <div className="bdqc-redrive-hint">
                            Save QC Review first, then create re-drive task.
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                </div>

                <div className="bdqc-details-grid">
                  <section className="bdqc-detail-box">
                    <div className="bdqc-detail-heading">
                      <h4>Checklist Items</h4>
                      <span>{progress.label}</span>
                    </div>

                    <div className="bdqc-checklist-list">
                      {checklistRowsForDisplay(checklistRows).slice(0, 8).map((row, index) => (
                        <div key={row.id || index} className="bdqc-small-line">
                          <span className={isChecklistChecked(row) ? "bdqc-dot bdqc-dot-green" : "bdqc-dot"} />
                          <span>{getChecklistLabel(row)}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="bdqc-detail-box">
                    <div className="bdqc-detail-heading">
                      <h4>FE Issues</h4>
                      <span>{issueRows.length}</span>
                    </div>

                    {recentIssues.length === 0 ? (
                      <p className="bdqc-muted">No FE issues reported.</p>
                    ) : (
                      recentIssues.map((issue, index) => (
                        <div key={issue.id || index} className="bdqc-issue-line">
                          <div>
                            <strong>{getIssueTitle(issue)}</strong>
                            <span>Severity: {issue.severity || "N/A"}</span>
                            <span>Status: {issue.status || "Open"}</span>
                          </div>
                          <p>{issue.description || issue.notes || "No description provided."}</p>
                        </div>
                      ))
                    )}
                  </section>

                  <section className="bdqc-detail-box">
                    <div className="bdqc-detail-heading">
                      <h4>FE Notes / Evidence</h4>
                      <span>{usefulUpdateRows.length}</span>
                    </div>

                    {recentUpdates.length === 0 ? (
                      <p className="bdqc-muted">No FE notes or photos found.</p>
                    ) : (
                      recentUpdates.map((update, index) => {
                        const photoUrl = getUpdatePhotoUrl(update);

                        return (
                          <div key={update.id || index} className="bdqc-update-line">
                            <p>{getUpdateText(update)}</p>
                            <div>
                              <small>{getUpdateKind(update)} • {formatDate(update.created_at)}</small>
                              {photoUrl ? (
                                <a href={photoUrl} target="_blank" rel="noreferrer">
                                  View Photo
                                </a>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </section>
                </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function QCReviewStyles() {
  return (
    <style>{`
      .bdqc-page {
        --qc-bg: transparent;
        --qc-surface: #081426;
        --qc-surface-2: #0d1b31;
        --qc-surface-3: #102340;
        --qc-card: #0b1830;
        --qc-card-2: #0e203c;
        --qc-border: rgba(96, 165, 250, 0.16);
        --qc-border-strong: rgba(96, 165, 250, 0.28);
        --qc-text: #e8f1ff;
        --qc-text-strong: #ffffff;
        --qc-muted: #98abc9;
        --qc-muted-2: #c9d7ee;
        --qc-accent: #55a3ff;
        --qc-accent-soft: rgba(85, 163, 255, 0.14);
        --qc-input-bg: rgba(8, 20, 38, 0.86);
        --qc-summary-bg: #0d1d37;
        --qc-progress-track: rgba(148, 163, 184, 0.18);
        --qc-shadow: 0 16px 34px rgba(0, 0, 0, 0.28);
        width: 100%;
        box-sizing: border-box;
        padding: 18px 20px 28px;
        color: var(--qc-text);
        text-align: left;
      }

      body.bd-theme-day .bdqc-page,
      .theme-day .bdqc-page {
        --qc-bg: transparent;
        --qc-surface: #ffffff;
        --qc-surface-2: #f8fbff;
        --qc-surface-3: #f8fbff;
        --qc-card: #ffffff;
        --qc-card-2: #f8fbff;
        --qc-border: #dbeafe;
        --qc-border-strong: #bfdbfe;
        --qc-text: #0f172a;
        --qc-text-strong: #0f172a;
        --qc-muted: #475569;
        --qc-muted-2: #64748b;
        --qc-accent: #2563eb;
        --qc-accent-soft: rgba(37, 99, 235, 0.12);
        --qc-input-bg: #ffffff;
        --qc-summary-bg: #f8fbff;
        --qc-progress-track: #e2e8f0;
        --qc-shadow: 0 14px 32px rgba(15, 23, 42, 0.07);
      }

      body.bd-theme-night .bdqc-page,
      .theme-night .bdqc-page {
        --qc-bg: transparent;
        --qc-surface: #081426;
        --qc-surface-2: #0d1b31;
        --qc-surface-3: #102340;
        --qc-card: #0b1830;
        --qc-card-2: #0e203c;
        --qc-border: rgba(96, 165, 250, 0.16);
        --qc-border-strong: rgba(96, 165, 250, 0.28);
        --qc-text: #e8f1ff;
        --qc-text-strong: #ffffff;
        --qc-muted: #98abc9;
        --qc-muted-2: #c9d7ee;
        --qc-accent: #55a3ff;
        --qc-accent-soft: rgba(85, 163, 255, 0.14);
        --qc-input-bg: rgba(8, 20, 38, 0.86);
        --qc-summary-bg: #0d1d37;
        --qc-progress-track: rgba(148, 163, 184, 0.18);
        --qc-shadow: 0 16px 34px rgba(0, 0, 0, 0.28);
      }

      .bdqc-page * {
        box-sizing: border-box;
      }

      .bdqc-header-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 16px;
      }

      .bdqc-header-card h2 {
        margin: 0;
        font-size: 26px;
        line-height: 1.2;
        letter-spacing: -0.02em;
        color: var(--qc-text-strong);
        text-align: left;
      }

      .bdqc-header-card p {
        margin: 6px 0 0;
        color: var(--qc-muted);
        font-size: 14px;
        text-align: left;
      }

      .bdqc-kicker {
        margin: 0 0 4px !important;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-size: 11px !important;
        font-weight: 900;
        color: var(--qc-accent) !important;
      }

      .bdqc-refresh-btn,
      .bdqc-save-btn {
        border: 0;
        border-radius: 12px;
        cursor: pointer;
        font-weight: 900;
        white-space: nowrap;
      }

      .bdqc-refresh-btn {
        background: var(--qc-surface-2);
        color: var(--qc-text-strong);
        border: 1px solid var(--qc-border-strong);
        padding: 10px 14px;
        box-shadow: var(--qc-shadow);
      }

      .bdqc-stats-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 14px;
      }

      .bdqc-stat-card {
        background: linear-gradient(180deg, var(--qc-surface-2) 0%, var(--qc-surface) 100%);
        border: 1px solid var(--qc-border);
        border-radius: 16px;
        padding: 15px 16px;
        box-shadow: var(--qc-shadow);
        min-height: 82px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        text-align: center;
      }

      .bdqc-stat-card strong {
        font-size: 24px;
        line-height: 1;
        color: var(--qc-text-strong);
      }

      .bdqc-stat-card span {
        margin-top: 8px;
        color: var(--qc-muted);
        font-size: 13px;
        font-weight: 800;
      }

      .bdqc-toolbar {
        display: grid;
        grid-template-columns: minmax(260px, 1fr) 240px;
        gap: 10px;
        margin-bottom: 16px;
      }

      .bdqc-toolbar input,
      .bdqc-toolbar select,
      .bdqc-input {
        width: 100%;
        border: 1px solid var(--qc-border-strong);
        background: var(--qc-input-bg);
        color: var(--qc-text);
        border-radius: 12px;
        padding: 11px 12px;
        font-size: 13px;
        outline: none;
        text-align: left;
      }

      .bdqc-toolbar input::placeholder,
      .bdqc-input::placeholder,
      .bdqc-textarea::placeholder {
        color: var(--qc-muted);
      }

      .bdqc-toolbar input:focus,
      .bdqc-toolbar select:focus,
      .bdqc-input:focus {
        border-color: var(--qc-accent);
        box-shadow: 0 0 0 3px var(--qc-accent-soft);
      }

      .bdqc-review-list {
        display: grid;
        gap: 16px;
      }

      .bdqc-card,
      .bdqc-empty-card {
        background: linear-gradient(180deg, var(--qc-card) 0%, var(--qc-surface) 100%);
        border: 1px solid var(--qc-border);
        border-radius: 18px;
        box-shadow: var(--qc-shadow);
      }

      .bdqc-card {
        padding: 16px;
      }

      .bdqc-empty-card {
        padding: 28px;
        color: var(--qc-muted);
        font-weight: 800;
      }

      .bdqc-card-top {
        padding-bottom: 14px;
        border-bottom: 1px solid var(--qc-border);
        margin-bottom: 14px;
      }

      .bdqc-title-row {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 10px;
      }

      .bdqc-title-row h3 {
        margin: 0;
        font-size: 20px;
        line-height: 1.2;
        letter-spacing: -0.01em;
        color: var(--qc-text-strong);
        text-align: left;
      }

      .bdqc-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        padding: 6px 11px;
        font-size: 12px;
        font-weight: 900;
        white-space: nowrap;
      }

      .bdqc-badge-pass { background: rgba(34, 197, 94, 0.16); color: #86efac; }
      .bdqc-badge-fail { background: rgba(239, 68, 68, 0.16); color: #fca5a5; }
      .bdqc-badge-redrive { background: rgba(244, 63, 94, 0.16); color: #fda4af; }
      .bdqc-badge-warning { background: rgba(245, 158, 11, 0.16); color: #fcd34d; }
      .bdqc-badge-waiting { background: rgba(56, 189, 248, 0.16); color: #7dd3fc; }

      body.bd-theme-day .bdqc-badge-pass,
      .theme-day .bdqc-badge-pass { background: #dcfce7; color: #166534; }
      body.bd-theme-day .bdqc-badge-fail,
      .theme-day .bdqc-badge-fail { background: #fee2e2; color: #991b1b; }
      body.bd-theme-day .bdqc-badge-redrive,
      .theme-day .bdqc-badge-redrive { background: #ffe4e6; color: #9f1239; }
      body.bd-theme-day .bdqc-badge-warning,
      .theme-day .bdqc-badge-warning { background: #fef3c7; color: #92400e; }
      body.bd-theme-day .bdqc-badge-waiting,
      .theme-day .bdqc-badge-waiting { background: #e0f2fe; color: #075985; }

      .bdqc-title-actions {
        display: inline-flex;
        align-items: center;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: 8px;
      }

      .bdqc-detail-toggle {
        border: 1px solid var(--qc-border-strong);
        background: var(--qc-surface-2);
        color: var(--qc-text-strong);
        border-radius: 999px;
        padding: 6px 11px;
        font-size: 12px;
        font-weight: 900;
        cursor: pointer;
        white-space: nowrap;
      }

      .bdqc-detail-toggle:hover,
      .bdqc-refresh-btn:hover {
        filter: brightness(1.05);
      }

      .bdqc-collapsed-summary {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 10px;
        margin-top: 12px;
      }

      .bdqc-collapsed-summary div {
        background: var(--qc-summary-bg);
        border: 1px solid var(--qc-border);
        border-radius: 14px;
        padding: 10px 12px;
        min-height: 64px;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }

      .bdqc-collapsed-summary strong {
        color: var(--qc-text-strong);
        font-size: 16px;
        line-height: 1.1;
      }

      .bdqc-collapsed-summary span {
        margin-top: 5px;
        color: var(--qc-muted);
        font-size: 12px;
        font-weight: 800;
      }

      .bdqc-meta-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px 14px;
      }

      .bdqc-meta-grid span {
        color: var(--qc-muted);
        font-size: 13px;
        line-height: 1.35;
        text-align: left;
      }

      .bdqc-meta-grid b {
        color: var(--qc-muted-2);
      }

      .bdqc-main-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 14px;
        align-items: stretch;
      }

      .bdqc-panel {
        background: linear-gradient(180deg, var(--qc-card-2) 0%, var(--qc-surface) 100%);
        border: 1px solid var(--qc-border);
        border-radius: 16px;
        padding: 14px;
        min-width: 0;
      }

      .bdqc-panel-heading,
      .bdqc-detail-heading {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
      }

      .bdqc-panel-heading h4,
      .bdqc-detail-heading h4 {
        margin: 0;
        color: var(--qc-text-strong);
        font-size: 14px;
        font-weight: 900;
        text-align: left;
      }

      .bdqc-panel-heading span,
      .bdqc-detail-heading span {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid var(--qc-border-strong);
        color: var(--qc-accent);
        border-radius: 999px;
        padding: 4px 9px;
        font-size: 12px;
        font-weight: 900;
      }

      body.bd-theme-day .bdqc-panel-heading span,
      body.bd-theme-day .bdqc-detail-heading span,
      .theme-day .bdqc-panel-heading span,
      .theme-day .bdqc-detail-heading span {
        background: #ffffff;
      }

      .bdqc-progress-wrap {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid var(--qc-border);
        border-radius: 13px;
        padding: 10px;
        margin-bottom: 10px;
      }

      .bdqc-progress-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        margin-bottom: 8px;
        font-size: 12px;
        color: var(--qc-muted);
        font-weight: 800;
      }

      .bdqc-progress-info b {
        color: var(--qc-text-strong);
      }

      .bdqc-progress-track {
        height: 8px;
        background: var(--qc-progress-track);
        border-radius: 999px;
        overflow: hidden;
      }

      .bdqc-progress-track div {
        height: 100%;
        background: linear-gradient(90deg, #3b82f6, #22c55e);
        border-radius: 999px;
      }

      .bdqc-mini-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        margin-bottom: 10px;
      }

      .bdqc-mini-grid div {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid var(--qc-border);
        border-radius: 12px;
        padding: 10px;
        text-align: center;
      }

      .bdqc-mini-grid strong {
        display: block;
        font-size: 17px;
        color: var(--qc-text-strong);
      }

      .bdqc-mini-grid span {
        display: block;
        margin-top: 2px;
        color: var(--qc-muted);
        font-size: 12px;
        font-weight: 800;
      }

      .bdqc-check-row {
        display: grid !important;
        grid-template-columns: 18px minmax(0, 1fr);
        align-items: flex-start;
        gap: 10px;
        width: 100%;
        margin: 0 0 9px;
        padding: 9px 10px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid var(--qc-border);
        border-radius: 12px;
        cursor: pointer;
        color: var(--qc-text);
        text-align: left !important;
      }

      .bdqc-check-row input {
        width: 15px;
        height: 15px;
        margin: 2px 0 0;
        accent-color: var(--qc-accent);
      }

      .bdqc-check-row span {
        display: block;
        color: var(--qc-text);
        text-align: left !important;
        line-height: 1.25;
        font-size: 13px;
      }

      .bdqc-check-row strong {
        display: block;
        color: var(--qc-text-strong);
        font-size: 13px;
        font-weight: 900;
        text-align: left !important;
      }

      .bdqc-check-row small {
        display: block;
        margin-top: 3px;
        color: var(--qc-muted);
        font-size: 11px;
        font-weight: 700;
        text-align: left !important;
      }

      .bdqc-textarea {
        resize: vertical;
        min-height: 94px;
        margin-top: 9px;
        font-family: inherit;
      }

      .bdqc-decision-panel .bdqc-check-row {
        margin-top: 9px;
      }

      .bdqc-save-btn {
        width: 100%;
        margin-top: 10px;
        padding: 12px 14px;
        background: linear-gradient(135deg, #1d4ed8 0%, #0f172a 100%);
        color: #ffffff !important;
        box-shadow: 0 14px 28px rgba(0, 0, 0, 0.26);
      }

      .bdqc-save-btn span {
        color: #ffffff !important;
        font-weight: 900;
      }

      body.bd-theme-day .bdqc-save-btn,
      .theme-day .bdqc-save-btn {
        background: linear-gradient(135deg, #2563eb 0%, #06b6d4 100%);
        box-shadow: 0 14px 26px rgba(37, 99, 235, 0.18);
      }

      .bdqc-save-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
      }

      .bdqc-redrive-action {
        margin-top: 10px;
      }

      .bdqc-redrive-btn {
        width: 100%;
        border: 1px solid rgba(244, 63, 94, 0.42);
        background: rgba(244, 63, 94, 0.14);
        color: #fecdd3;
        border-radius: 12px;
        padding: 11px 14px;
        font-size: 13px;
        font-weight: 900;
        cursor: pointer;
      }

      .bdqc-redrive-btn:hover {
        background: rgba(244, 63, 94, 0.22);
      }

      .bdqc-redrive-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
      }

      .bdqc-redrive-linked,
      .bdqc-redrive-hint {
        border-radius: 12px;
        padding: 10px 12px;
        font-size: 12px;
        font-weight: 900;
        text-align: center;
      }

      .bdqc-redrive-linked {
        border: 1px solid rgba(34, 197, 94, 0.32);
        background: rgba(34, 197, 94, 0.12);
        color: #86efac;
      }

      .bdqc-redrive-hint {
        border: 1px solid rgba(245, 158, 11, 0.32);
        background: rgba(245, 158, 11, 0.12);
        color: #fcd34d;
      }

      body.bd-theme-day .bdqc-redrive-btn,
      .theme-day .bdqc-redrive-btn {
        border-color: #fecdd3;
        background: #fff1f2;
        color: #9f1239;
      }

      body.bd-theme-day .bdqc-redrive-linked,
      .theme-day .bdqc-redrive-linked {
        border-color: #bbf7d0;
        background: #dcfce7;
        color: #166534;
      }

      body.bd-theme-day .bdqc-redrive-hint,
      .theme-day .bdqc-redrive-hint {
        border-color: #fde68a;
        background: #fffbeb;
        color: #92400e;
      }

      .bdqc-details-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 14px;
        margin-top: 14px;
        padding-top: 14px;
        border-top: 1px solid var(--qc-border);
      }

      .bdqc-detail-box {
        background: linear-gradient(180deg, var(--qc-card-2) 0%, var(--qc-surface) 100%);
        border: 1px solid var(--qc-border);
        border-radius: 16px;
        padding: 14px;
        min-width: 0;
      }

      .bdqc-muted {
        margin: 0;
        color: var(--qc-muted);
        font-size: 13px;
        font-weight: 700;
        text-align: left;
      }

      .bdqc-evidence-found,
      .bdqc-evidence-missing {
        border-radius: 12px;
        padding: 10px 12px;
        font-size: 12px;
        font-weight: 900;
        margin-bottom: 10px;
      }

      .bdqc-evidence-found {
        border: 1px solid rgba(34, 197, 94, 0.28);
        background: rgba(34, 197, 94, 0.10);
        color: #166534;
      }

      .bdqc-evidence-missing {
        border: 1px solid rgba(245, 158, 11, 0.30);
        background: rgba(245, 158, 11, 0.10);
        color: #92400e;
      }

      .bdqc-checklist-list {
        display: grid;
        gap: 8px;
      }

      .bdqc-small-line {
        display: grid;
        grid-template-columns: 10px minmax(0, 1fr);
        gap: 8px;
        align-items: center;
        color: var(--qc-muted-2);
        font-size: 13px;
        text-align: left;
      }

      .bdqc-dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #475569;
      }

      .bdqc-dot-green {
        background: #22c55e;
      }

      .bdqc-issue-line,
      .bdqc-update-line {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid var(--qc-border);
        border-radius: 12px;
        padding: 10px;
        margin-bottom: 8px;
        text-align: left;
      }

      .bdqc-issue-line div {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 7px;
        margin-bottom: 5px;
      }

      .bdqc-issue-line strong {
        color: var(--qc-text-strong);
        font-size: 13px;
      }

      .bdqc-issue-line span {
        color: var(--qc-muted);
        font-size: 12px;
        font-weight: 800;
      }

      .bdqc-issue-line p,
      .bdqc-update-line p {
        margin: 0;
        color: var(--qc-muted-2);
        font-size: 13px;
        line-height: 1.4;
        text-align: left;
      }

      .bdqc-update-line div {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        align-items: center;
        margin-top: 8px;
      }

      .bdqc-update-line small {
        color: var(--qc-muted);
        font-size: 11px;
        font-weight: 700;
      }

      .bdqc-update-line a {
        color: var(--qc-accent);
        font-size: 12px;
        font-weight: 900;
        text-decoration: none;
      }


      body.bd-theme-night .bdqc-card,
      body.bd-theme-night .bdqc-empty-card,
      body.bd-theme-night .bdqc-stat-card,
      body.bd-theme-night .bdqc-panel,
      body.bd-theme-night .bdqc-detail-box,
      body.bd-theme-night .bdqc-collapsed-summary div,
      body.bd-theme-night .bdqc-header-card,
      .theme-night .bdqc-card,
      .theme-night .bdqc-empty-card,
      .theme-night .bdqc-stat-card,
      .theme-night .bdqc-panel,
      .theme-night .bdqc-detail-box,
      .theme-night .bdqc-collapsed-summary div,
      .theme-night .bdqc-header-card {
        color: var(--qc-text) !important;
      }

      body.bd-theme-night .bdqc-card h3,
      body.bd-theme-night .bdqc-header-card h2,
      body.bd-theme-night .bdqc-panel h4,
      body.bd-theme-night .bdqc-detail-box h4,
      body.bd-theme-night .bdqc-stat-card strong,
      .theme-night .bdqc-card h3,
      .theme-night .bdqc-header-card h2,
      .theme-night .bdqc-panel h4,
      .theme-night .bdqc-detail-box h4,
      .theme-night .bdqc-stat-card strong {
        color: #ffffff !important;
      }

      body.bd-theme-night .bdqc-toolbar input,
      body.bd-theme-night .bdqc-toolbar select,
      body.bd-theme-night .bdqc-input,
      .theme-night .bdqc-toolbar input,
      .theme-night .bdqc-toolbar select,
      .theme-night .bdqc-input {
        background: rgba(8, 20, 38, 0.92) !important;
        color: #e8f1ff !important;
      }

      @media (max-width: 1200px) {
        .bdqc-main-grid,
        .bdqc-details-grid {
          grid-template-columns: 1fr;
        }

        .bdqc-meta-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .bdqc-collapsed-summary {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 800px) {
        .bdqc-page {
          padding: 14px;
        }

        .bdqc-header-card,
        .bdqc-title-row {
          flex-direction: column;
          align-items: stretch;
        }

        .bdqc-stats-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .bdqc-toolbar {
          grid-template-columns: 1fr;
        }

        .bdqc-meta-grid,
        .bdqc-collapsed-summary {
          grid-template-columns: 1fr;
        }
      }
    `}</style>
  );
}
