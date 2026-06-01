import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import AdminLiveMap from "./components/AdminLiveMap";
import GridUpload from "./pages/GridUpload";
import AssignTask from "./pages/AssignTask";
import RouteManagement from "./pages/RouteManagement";
import AssignedRoutes from "./pages/AssignedRoutes";
import CellFileManagement from "./pages/CellFileManagement";
import QCReview from "./pages/QCReview";
import Reports from "./pages/Reports";

const emptyProject = {
  name: "",
  customer: "",
  market: "",
  testing_type: "",
};

const menuGroups = [
  {
    title: "Project Management",
    items: [
      { id: "createProject", label: "Create Project", icon: "➕" },
      { id: "assignTask", label: "Assign Task", icon: "🧾" },
      { id: "taskTracking", label: "Task Tracking", icon: "✅" },
    ],
  },
  {
    title: "Route Management",
    items: [
      { id: "uploadKml", label: "Grids", icon: "📁" },
      { id: "cellFiles", label: "Cell Files", icon: "📶" },
      { id: "routes", label: "Route Management", icon: "🗺️" },
      { id: "assignRoute", label: "Assigned Routes", icon: "📍" },
    ],
  },
  {
    title: "Field Operations",
    items: [
      { id: "liveMap", label: "Live FE Map", icon: "📡" },
      { id: "timeline", label: "Task Timeline", icon: "🕒" },
      { id: "updates", label: "FE Updates / Photos", icon: "🖼️" },
    ],
  },
  {
    title: "QC & Reports",
    items: [
      { id: "qc", label: "QC Review", icon: "🔍" },
      { id: "reports", label: "Reports", icon: "📄" },
    ],
  },
];


function getGroupTitleForView(viewId) {
  const match = menuGroups.find((group) =>
    group.items.some((item) => item.id === viewId)
  );

  return match?.title || "";
}

function getDefaultCollapsedMenuGroups(activeView) {
  const activeGroupTitle = getGroupTitleForView(activeView);
  const state = {};

  menuGroups.forEach((group) => {
    state[group.title] = group.title !== activeGroupTitle;
  });

  return state;
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

function getDashboardDateRange(filters) {
  const mode = filters?.dateMode || "all";
  const now = new Date();

  if (mode === "today") {
    return { start: startOfLocalDay(now), end: endOfLocalDay(now) };
  }

  if (mode === "week") {
    return { start: startOfLocalWeek(now), end: endOfLocalWeek(now) };
  }

  if (mode === "month") {
    return { start: startOfLocalMonth(now), end: endOfLocalMonth(now) };
  }

  if (mode === "custom") {
    const start = filters?.dateFrom ? startOfLocalDay(new Date(filters.dateFrom)) : null;
    const end = filters?.dateTo ? endOfLocalDay(new Date(filters.dateTo)) : null;

    if (start && Number.isNaN(start.getTime())) return null;
    if (end && Number.isNaN(end.getTime())) return null;

    if (start || end) return { start, end };
  }

  return null;
}

function getTaskFilterDate(task) {
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

function isTaskInsideDashboardDateRange(task, filters) {
  const range = getDashboardDateRange(filters);
  if (!range) return true;

  const value = getTaskFilterDate(task);
  if (!value) return false;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  if (range.start && date < range.start) return false;
  if (range.end && date > range.end) return false;
  return true;
}

function getDashboardDateLabel(filters) {
  const mode = filters?.dateMode || "all";
  const range = getDashboardDateRange(filters);

  if (!range) return "All Time";
  if (mode === "today") return "Today";
  if (mode === "week") return "This Week";
  if (mode === "month") return "This Month";

  const start = range.start ? range.start.toLocaleDateString() : "Start";
  const end = range.end ? range.end.toLocaleDateString() : "Today";
  return `${start} - ${end}`;
}

export default function AdminDashboard({ user, onLogout }) {
  const [focusedLocation, setFocusedLocation] = useState(null);

  const [activeView, setActiveView] = useState(() => {
    return localStorage.getItem("adminActiveView") || "overview";
  });

  const [themeMode, setThemeMode] = useState(() => {
    return localStorage.getItem("babyDragonTheme") || "night";
  });

  const [collapsedMenuGroups, setCollapsedMenuGroups] = useState(() => {
    const saved = localStorage.getItem("adminCollapsedMenuGroups");

    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // If saved state is damaged, rebuild a clean one.
      }
    }

    return getDefaultCollapsedMenuGroups(
      localStorage.getItem("adminActiveView") || "overview"
    );
  });

  const [projects, setProjects] = useState([]);
  const [fieldEngineers, setFieldEngineers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [taskUpdates, setTaskUpdates] = useState({});
  const [taskChecklistItems, setTaskChecklistItems] = useState({});
  const [taskIssues, setTaskIssues] = useState({});
  const [users, setUsers] = useState([]);

  const [newUser, setNewUser] = useState({
    email: "",
    password: "",
    role: "fe",
  });

  const [projectForm, setProjectForm] = useState(() => {
    const saved = localStorage.getItem("adminProjectForm");
    return saved ? JSON.parse(saved) : emptyProject;
  });

  const [message, setMessage] = useState("");
  const [expandedTaskId, setExpandedTaskId] = useState("");

  const [filters, setFilters] = useState({
    projectId: "",
    market: "",
    status: "",
    feId: "",
    dateMode: "all",
    dateFrom: "",
    dateTo: "",
  });

  useEffect(() => {
    localStorage.setItem("babyDragonTheme", themeMode);

    document.body.classList.toggle("bd-theme-day", themeMode === "day");
    document.body.classList.toggle("bd-theme-night", themeMode === "night");

    return () => {
      document.body.classList.remove("bd-theme-day");
      document.body.classList.remove("bd-theme-night");
    };
  }, [themeMode]);

  useEffect(() => {
    localStorage.setItem("adminProjectForm", JSON.stringify(projectForm));
  }, [projectForm]);

  useEffect(() => {
    localStorage.setItem("adminActiveView", activeView);

    const activeGroupTitle = getGroupTitleForView(activeView);

    if (activeView === "overview") {
      setCollapsedMenuGroups((prev) => {
        const next = { ...prev };
        menuGroups.forEach((group) => {
          next[group.title] = true;
        });
        return next;
      });
      return;
    }

    if (activeGroupTitle) {
      setCollapsedMenuGroups((prev) => ({
        ...prev,
        [activeGroupTitle]: false,
      }));
    }
  }, [activeView]);

  useEffect(() => {
    localStorage.setItem(
      "adminCollapsedMenuGroups",
      JSON.stringify(collapsedMenuGroups)
    );
  }, [collapsedMenuGroups]);

  function toggleMenuGroup(groupTitle) {
    setCollapsedMenuGroups((prev) => ({
      ...prev,
      [groupTitle]: !prev[groupTitle],
    }));
  }

  useEffect(() => {
    fetchAll();

    const channel = supabase
      .channel("admin-dashboard-refresh")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, fetchAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_updates" }, fetchAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_checklist_items" }, fetchAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_issue_reports" }, fetchAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_grids" }, fetchAll)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function fetchAll() {
    await Promise.all([
      fetchProjects(),
      fetchFEs(),
      fetchTasks(),
      fetchTaskUpdates(),
      fetchTaskChecklistItems(),
      fetchTaskIssues(),
      fetchUsers(),
    ]);
  }

  async function fetchProjects() {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Projects error:", error);
      return;
    }

    setProjects(data || []);
  }

  async function fetchFEs() {
    const { data, error } = await supabase.rpc("get_field_engineers");

    if (error) {
      console.error("FE error:", error);
      return;
    }

    setFieldEngineers(data || []);
  }

  async function fetchTasks() {
    const { data, error } = await supabase
      .from("tasks")
      .select(`
        *,
        projects (
          id,
          name,
          market,
          customer,
          testing_type
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Tasks error:", error);
      return;
    }

    setTasks(data || []);
  }

  async function fetchTaskUpdates() {
    const { data, error } = await supabase
      .from("task_updates")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Task updates error:", error);
      return;
    }

    const grouped = {};
    (data || []).forEach((update) => {
      if (!grouped[update.task_id]) grouped[update.task_id] = [];
      grouped[update.task_id].push(update);
    });

    setTaskUpdates(grouped);
  }

  async function fetchTaskChecklistItems() {
    const { data, error } = await supabase
      .from("task_checklist_items")
      .select("*")
      .order("item_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Task checklist error:", error);
      return;
    }

    const grouped = {};
    (data || []).forEach((item) => {
      if (!grouped[item.task_id]) grouped[item.task_id] = [];
      grouped[item.task_id].push(item);
    });

    setTaskChecklistItems(grouped);
  }

  async function fetchTaskIssues() {
    const { data, error } = await supabase
      .from("task_issue_reports")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Task issues error:", error);
      return;
    }

    const grouped = {};
    (data || []).forEach((issue) => {
      if (!grouped[issue.task_id]) grouped[issue.task_id] = [];
      grouped[issue.task_id].push(issue);
    });

    setTaskIssues(grouped);
  }

  async function fetchUsers() {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, role, is_active, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Users error:", error);
      return;
    }

    setUsers(data || []);
  }

  async function toggleUserActive(profile) {
    const { error } = await supabase
      .from("profiles")
      .update({ is_active: !profile.is_active })
      .eq("id", profile.id);

    if (error) {
      alert(error.message);
      return;
    }

    fetchUsers();
    fetchFEs();
  }

  async function updateUserRole(profile, role) {
    const { error } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", profile.id);

    if (error) {
      alert(error.message);
      return;
    }

    fetchUsers();
    fetchFEs();
  }

  async function createUserFromDashboard(e) {
    e.preventDefault();

    if (!newUser.email || !newUser.password) {
      alert("Please enter email and temporary password.");
      return;
    }

    alert(
      "For now, create the user from Supabase Authentication → Users → Add user. After that, refresh BabyDragon. Next we will connect this button to a secure Supabase Edge Function."
    );
  }

  async function resetPasswordFromDashboard(profile) {
    alert(
      `For now, reset password from Supabase Authentication → Users for ${profile.email}. Next we will connect this button to a secure Supabase Edge Function.`
    );
  }

  async function createProject(e) {
    e.preventDefault();
    setMessage("");

    const { error } = await supabase.from("projects").insert({
      name: projectForm.name.trim(),
      customer: projectForm.customer.trim(),
      market: projectForm.market.trim(),
      testing_type: projectForm.testing_type.trim(),
      status: "active",
    });

    if (error) {
      alert(error.message);
      return;
    }

    setProjectForm(emptyProject);
    localStorage.removeItem("adminProjectForm");
    setMessage("Project created successfully.");
    fetchProjects();
  }

  function getFeEmail(feId) {
    return fieldEngineers.find((fe) => fe.id === feId)?.email || "Unassigned";
  }

  function statusLabel(status) {
    if (status === "in_progress") return "In Progress";
    if (status === "completed") return "Completed";
    if (status === "assigned") return "Assigned";
    if (status === "needs_redrive") return "Needs Re-drive";
    if (status === "pending") return "Pending";
    return status || "Unknown";
  }

  function getChecklistProgress(taskId) {
    const items = taskChecklistItems[taskId] || [];
    const done = items.filter((item) => item.is_done).length;

    return {
      done,
      total: items.length,
      items,
    };
  }

  function formatIssueType(value) {
    return String(value || "Issue")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function issueSeverityClass(severity) {
    const value = String(severity || "normal").toLowerCase();

    if (value === "critical") return "critical";
    if (value === "high") return "high";
    if (value === "low") return "low";
    return "normal";
  }

  const markets = useMemo(() => {
    const values = new Set();

    projects.forEach((p) => {
      if (p.market) values.add(p.market);
    });

    tasks.forEach((t) => {
      if (t.market) values.add(t.market);
    });

    return Array.from(values).sort();
  }, [projects, tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      const matchProject = !filters.projectId || t.project_id === filters.projectId;
      const matchMarket = !filters.market || t.market === filters.market;
      const matchStatus =
        !filters.status ||
        t.status === filters.status ||
        statusLabel(t.status) === filters.status;
      const matchFe = !filters.feId || t.assigned_to === filters.feId;
      const matchDate = isTaskInsideDashboardDateRange(t, filters);

      return matchProject && matchMarket && matchStatus && matchFe && matchDate;
    });
  }, [tasks, filters]);

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      const matchProject = !filters.projectId || p.id === filters.projectId;
      const matchMarket = !filters.market || p.market === filters.market;

      return matchProject && matchMarket;
    });
  }, [projects, filters]);

  const stats = useMemo(() => {
    const activeFeIds = new Set(
      filteredTasks
        .filter((t) => t.status === "in_progress")
        .map((t) => t.assigned_to)
        .filter(Boolean)
    );

    return {
      projects: filteredProjects.length,
      totalTasks: filteredTasks.length,
      assigned: filteredTasks.filter((t) => t.status === "assigned").length,
      inProgress: filteredTasks.filter((t) => t.status === "in_progress").length,
      completed: filteredTasks.filter((t) => t.status === "completed").length,
      activeFes: activeFeIds.size,
    };
  }, [filteredProjects, filteredTasks]);

  const dashboardOverview = useMemo(() => {
    const total = stats.totalTasks || 0;
    const completedPct = total ? Math.round((stats.completed / total) * 100) : 0;
    const inProgressPct = total ? Math.round((stats.inProgress / total) * 100) : 0;
    const assignedPct = total ? Math.round((stats.assigned / total) * 100) : 0;

    const issueCount = filteredTasks.reduce((sum, task) => {
      return sum + (taskIssues[task.id]?.length || 0);
    }, 0);

    const updateCount = filteredTasks.reduce((sum, task) => {
      return sum + (taskUpdates[task.id]?.length || 0);
    }, 0);

    const checklist = filteredTasks.reduce(
      (acc, task) => {
        const items = taskChecklistItems[task.id] || [];
        acc.total += items.length;
        acc.done += items.filter((item) => item.is_done).length;
        return acc;
      },
      { done: 0, total: 0 }
    );

    const checklistPct = checklist.total ? Math.round((checklist.done / checklist.total) * 100) : 0;

    const projectRows = filteredProjects
      .map((project) => {
        const projectTasks = filteredTasks.filter((task) => task.project_id === project.id);
        const completed = projectTasks.filter((task) => task.status === "completed").length;
        return {
          name: project.name || "Project",
          customer: project.customer || "N/A",
          market: project.market || "N/A",
          total: projectTasks.length,
          completed,
          percent: projectTasks.length ? Math.round((completed / projectTasks.length) * 100) : 0,
        };
      })
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    return {
      completedPct,
      inProgressPct,
      assignedPct,
      issueCount,
      updateCount,
      checklist,
      checklistPct,
      projectRows,
    };
  }, [stats, filteredTasks, filteredProjects, taskIssues, taskUpdates, taskChecklistItems]);

  function renderUserManagement() {
    return (
      <div className="panel-card">
        <div className="panel-header">
          <div>
            <h2>User Management</h2>
            <p>Create users, manage roles, activate/deactivate accounts, and prepare password reset control.</p>
          </div>
        </div>

        {message && <div className="message-bar">{message}</div>}

        <form onSubmit={createUserFromDashboard} className="form-grid">
          <div className="form-row">
            <input
              type="email"
              placeholder="New user email"
              value={newUser.email}
              onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
            />

            <input
              type="password"
              placeholder="Temporary password"
              value={newUser.password}
              onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            />
          </div>

          <div className="form-row">
            <select
              value={newUser.role}
              onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
            >
              <option value="fe">Field Engineer</option>
              <option value="admin">Admin</option>
              <option value="super_admin">Super Admin</option>
            </select>

            <button type="submit">Create User</button>
          </div>
        </form>

        <div className="info-box" style={{ marginTop: "14px" }}>
          For today, the Create User and Reset Password buttons are placeholders.
          Use Supabase Authentication → Users to create/reset users until we deploy the secure Edge Functions.
        </div>

        <div className="user-list">
          {users.length === 0 ? (
            <p className="muted">No users found.</p>
          ) : (
            users.map((profile) => (
              <div key={profile.id} className="user-row">
                <div>
                  <b>{profile.email}</b>
                  <p>
                    {profile.is_active ? "Active" : "Inactive"} •{" "}
                    {profile.created_at
                      ? new Date(profile.created_at).toLocaleString()
                      : "No date"}
                  </p>
                </div>

                <select
                  value={profile.role || "fe"}
                  onChange={(e) => updateUserRole(profile, e.target.value)}
                >
                  <option value="fe">FE</option>
                  <option value="admin">Admin</option>
                  <option value="super_admin">Super Admin</option>
                </select>

                <button type="button" onClick={() => toggleUserActive(profile)}>
                  {profile.is_active ? "Deactivate" : "Activate"}
                </button>

                <button type="button" onClick={() => resetPasswordFromDashboard(profile)}>
                  Reset Password
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  function renderComingSoon(title) {
    return (
      <div className="panel-card">
        <h2>{title}</h2>
        <p className="muted">
          This module is reserved for the next phase. We are keeping the button
          visible so the BabyDragon workflow stays clear, but we will not
          overbuild it yet.
        </p>
      </div>
    );
  }

  function renderCreateProject() {
    return (
      <div className="panel-card">
        <div className="panel-header">
          <div>
            <h2>Create Project</h2>
            <p>Start the workflow with project, customer, market, and test type.</p>
          </div>
        </div>

        <form onSubmit={createProject} className="form-grid">
          <input
            placeholder="Project Name"
            value={projectForm.name}
            onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })}
            required
          />

          <input
            placeholder="Customer"
            value={projectForm.customer}
            onChange={(e) => setProjectForm({ ...projectForm, customer: e.target.value })}
          />

          <input
            placeholder="Market"
            value={projectForm.market}
            onChange={(e) => setProjectForm({ ...projectForm, market: e.target.value })}
            required
          />

          <input
            placeholder="Testing Type"
            value={projectForm.testing_type}
            onChange={(e) =>
              setProjectForm({
                ...projectForm,
                testing_type: e.target.value,
              })
            }
          />

          <button type="submit">Create Project</button>
        </form>
      </div>
    );
  }

  function renderTaskTracking() {
    return (
      <div className="panel-card">
        <div className="panel-header">
          <div>
            <h2>Task Tracking</h2>
            <p>Filtered task list with status, FE, updates, photos, and map links.</p>
          </div>
        </div>

        <div className="task-list">
          {filteredTasks.length === 0 ? (
            <p className="muted">No tasks match the selected filters.</p>
          ) : (
            filteredTasks.map((t) => {
              const isExpanded = String(expandedTaskId) === String(t.id);
              const updates = taskUpdates[t.id] || [];
              const checklist = getChecklistProgress(t.id);
              const issues = taskIssues[t.id] || [];

              return (
                <div key={t.id} className="task-card">
                  <div className="task-card-top">
                    <div>
                      <h3>{t.projects?.name || "No Project"} • {t.target_name}</h3>
                      <p>
                        {t.market || "No Market"} • {t.test_type || "No Scope"} • FE: {getFeEmail(t.assigned_to)}
                      </p>
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {checklist.total > 0 && (
                        <span className="admin-mini-pill checklist-pill">
                          Checklist {checklist.done}/{checklist.total}
                        </span>
                      )}
                      {issues.length > 0 && (
                        <span className="admin-mini-pill issue-pill">
                          Issues {issues.length}
                        </span>
                      )}
                      <span className={`status-pill ${t.status}`}>{statusLabel(t.status)}</span>
                      <button
                        type="button"
                        className="small-btn"
                        onClick={() => setExpandedTaskId(isExpanded ? "" : t.id)}
                      >
                        {isExpanded ? "Hide Details" : "Details"}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <>
                      <div className="task-meta-grid">
                        <div>
                          <span>FE</span>
                          <b>{getFeEmail(t.assigned_to)}</b>
                        </div>
                        <div>
                          <span>Target Type</span>
                          <b>{t.target_type || "N/A"}</b>
                        </div>
                        <div>
                          <span>Priority</span>
                          <b>{t.priority || "Normal"}</b>
                        </div>
                        <div>
                          <span>Due</span>
                          <b>{t.due_date ? new Date(t.due_date).toLocaleString() : "N/A"}</b>
                        </div>
                      </div>

                      <div className="admin-qc-summary-grid">
                        <div className="admin-checklist-box">
                          <div className="admin-section-head">
                            <div>
                              <b>FE Checklist</b>
                              <p>{checklist.total ? `${checklist.done}/${checklist.total} completed` : "No checklist created yet"}</p>
                            </div>
                            <span className="admin-progress-badge">{checklist.done}/{checklist.total || 0}</span>
                          </div>

                          {checklist.items.length > 0 ? (
                            <div className="admin-checklist-list">
                              {checklist.items.map((item) => (
                                <div key={item.id} className={`admin-checklist-item ${item.is_done ? "done" : ""}`}>
                                  <span>{item.is_done ? "✅" : "⬜"}</span>
                                  <div>
                                    <b>{item.label}</b>
                                    {item.completed_at && (
                                      <small>{new Date(item.completed_at).toLocaleString()}</small>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="muted">Checklist will appear after FE opens task details.</p>
                          )}
                        </div>

                        <div className="admin-issues-box">
                          <div className="admin-section-head">
                            <div>
                              <b>Issue Reports</b>
                              <p>{issues.length ? `${issues.length} issue(s) reported` : "No issues reported"}</p>
                            </div>
                            <span className={`admin-progress-badge ${issues.length ? "has-issues" : ""}`}>{issues.length}</span>
                          </div>

                          {issues.length > 0 ? (
                            <div className="admin-issue-list">
                              {issues.slice(0, 5).map((issue) => (
                                <div key={issue.id} className="admin-issue-item">
                                  <div className="admin-issue-top">
                                    <b>{formatIssueType(issue.issue_type)}</b>
                                    <span className={`issue-severity ${issueSeverityClass(issue.severity)}`}>
                                      {issue.severity || "Normal"} • {issue.status || "Open"}
                                    </span>
                                  </div>

                                  {issue.description && <p>{issue.description}</p>}

                                  <small>
                                    {issue.created_at ? new Date(issue.created_at).toLocaleString() : "No time"}
                                    {issue.lat && issue.lon && " • "}
                                    {issue.lat && issue.lon && (
                                      <a
                                        href={`https://www.google.com/maps?q=${issue.lat},${issue.lon}`}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        Open GPS
                                      </a>
                                    )}
                                  </small>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="muted">No field issues reported for this task.</p>
                          )}
                        </div>
                      </div>

                      {updates.length > 0 && (
                        <div className="updates-box">
                          <b>Latest FE Updates</b>

                          {updates.slice(0, 5).map((update) => (
                            <div key={update.id} className="update-item">
                              <div>
                                <b>Time:</b> {new Date(update.created_at).toLocaleString()}
                              </div>

                              {update.comment && (
                                <div>
                                  <b>Comment:</b> {update.comment}
                                </div>
                              )}

                              {update.latitude && update.longitude && (
                                <div>
                                  <b>Location:</b>{" "}
                                  <a
                                    href={`https://www.google.com/maps?q=${update.latitude},${update.longitude}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open Map
                                  </a>
                                </div>
                              )}

                              {update.photo_url && (
                                <img
                                  src={update.photo_url}
                                  alt="FE Upload"
                                  className="update-photo"
                                  onClick={() => window.open(update.photo_url, "_blank")}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  function renderTimeline() {
    function buildTimelineEvents(task) {
      const events = [];

      events.push({
        type: "assigned",
        label: "Task Assigned",
        time: task.created_at,
        detail: `${task.projects?.name || "Project"} assigned to ${getFeEmail(task.assigned_to)}`,
      });

      if (task.started_at) {
        events.push({
          type: "started",
          label: "Testing Started",
          time: task.started_at,
          detail: "FE started field execution.",
        });
      }

      const updatesForTask = taskUpdates[task.id] || [];

      updatesForTask.forEach((update) => {
        const isLate =
          task.completed_at &&
          new Date(update.created_at) > new Date(task.completed_at);

        let label = "GPS Auto Log";

        if (update.comment && update.comment !== "Auto GPS point") {
          label = "FE Manual Update";
        }

        if (update.photo_url) {
          label = "Photo Uploaded";
        }

        if (isLate) {
          label = "Post-Completion Update";
        }

        events.push({
          type: isLate
            ? "late"
            : update.photo_url
            ? "photo"
            : update.comment && update.comment !== "Auto GPS point"
            ? "comment"
            : "gps",
          label,
          time: update.created_at,
          detail: update.comment || "GPS point logged.",
          latitude: update.latitude,
          longitude: update.longitude,
          photo_url: update.photo_url,
        });
      });

      if (task.completed_at) {
        events.push({
          type: "completed",
          label: "Task Completed",
          time: task.completed_at,
          detail: "FE marked this task as completed.",
        });
      }

      return events.sort((a, b) => new Date(a.time) - new Date(b.time));
    }

    function getTimelineIcon(type) {
      if (type === "assigned") return "🧾";
      if (type === "started") return "🚙";
      if (type === "gps") return "📍";
      if (type === "comment") return "💬";
      if (type === "photo") return "📸";
      if (type === "completed") return "✅";
      if (type === "late") return "⚠️";
      return "•";
    }

    return (
      <div className="panel-card">
        <div className="panel-header">
          <div>
            <h2>Task Timeline</h2>
            <p>
              Full execution story: assigned, started, GPS logs, updates, photos,
              completion, and late uploads.
            </p>
          </div>
        </div>

        {filteredTasks.length === 0 ? (
          <p className="muted">No tasks match the selected filters.</p>
        ) : (
          <div className="timeline-task-list">
            {filteredTasks.map((task) => {
              const events = buildTimelineEvents(task);

              return (
                <div key={task.id} className="timeline-task-card">
                  <div className="timeline-task-header">
                    <div>
                      <h3>
                        {task.projects?.name || "No Project"} •{" "}
                        {task.target_name || "No Target"}
                      </h3>
                      <p>
                        {task.market || "No Market"} •{" "}
                        {task.test_type || "No Scope"} • FE:{" "}
                        {getFeEmail(task.assigned_to)}
                      </p>
                    </div>

                    <span className={`status-pill ${task.status}`}>
                      {statusLabel(task.status)}
                    </span>
                  </div>

                  <div className="timeline-line-wrap">
                    {events.map((event, index) => (
                      <div key={`${event.type}-${event.time}-${index}`} className="timeline-row">
                        <div className={`timeline-icon ${event.type}`}>
                          {getTimelineIcon(event.type)}
                        </div>

                        <div className="timeline-event-card">
                          <div className="timeline-event-top">
                            <strong>{event.label}</strong>
                            <span>{new Date(event.time).toLocaleString()}</span>
                          </div>

                          <p>{event.detail}</p>

                          {event.latitude && event.longitude && (
                            <button
                              type="button"
                              className="timeline-link"
                              onClick={() => {
                                setFocusedLocation({
                                  lat: event.latitude,
                                  lng: event.longitude,
                                  time: event.time,
                                });
                                setActiveView("liveMap");
                              }}
                            >
                              📍 View on Map
                            </button>
                          )}

                          {event.photo_url && (
                            <img
                              src={event.photo_url}
                              alt="timeline"
                              className="timeline-photo"
                              onClick={() => window.open(event.photo_url, "_blank")}
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function renderUpdates() {
    const allUpdates = filteredTasks.flatMap((taskItem) =>
      (taskUpdates[taskItem.id] || []).map((update) => ({
        ...update,
        task: taskItem,
      }))
    );

    return (
      <div className="panel-card">
        <div className="panel-header">
          <div>
            <h2>FE Updates / Photos</h2>
            <p>All comments, GPS points, and uploaded field photos.</p>
          </div>
        </div>

        {allUpdates.length === 0 ? (
          <p className="muted">No updates found for selected filters.</p>
        ) : (
          <div className="updates-grid">
            {allUpdates.map((update) => (
              <div key={update.id} className="update-card">
                <h3>{update.task?.target_name || "Task Update"}</h3>
                <p>{new Date(update.created_at).toLocaleString()}</p>

                {update.comment && <p>{update.comment}</p>}

                {update.latitude && update.longitude && (
                  <a
                    href={`https://www.google.com/maps?q=${update.latitude},${update.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open GPS Location
                  </a>
                )}

                {update.photo_url && (
                  <img
                    src={update.photo_url}
                    alt="FE Upload"
                    className="large-update-photo"
                    onClick={() => window.open(update.photo_url, "_blank")}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderDashboardOverview() {
    return (
      <div className="dashboard-overview-stack">
        <section className="dashboard-exec-panel">
          <div className="dashboard-exec-header">
            <div>
              <p>Executive Snapshot</p>
              <h2>{stats.completed}/{stats.totalTasks} tasks completed</h2>
              <span>{getDashboardDateLabel(filters)} | {stats.activeFes} active FE(s) | {dashboardOverview.issueCount} issue record(s)</span>
            </div>
            <div className="dashboard-score-card">
              <span>Completion</span>
              <b>{dashboardOverview.completedPct}%</b>
            </div>
          </div>

          <div className="dashboard-chart-grid">
            <div className="dashboard-donut-card">
              <div className="dashboard-donut" style={{ "--pct": `${dashboardOverview.completedPct}%` }}>
                <strong>{dashboardOverview.completedPct}%</strong>
                <span>Done</span>
              </div>
              <p>Task completion</p>
            </div>

            <div className="dashboard-bars-card">
              <h3>Task Status</h3>
              <DashboardMiniBar label="Completed" value={stats.completed} total={stats.totalTasks} tone="good" />
              <DashboardMiniBar label="In Progress" value={stats.inProgress} total={stats.totalTasks} tone="info" />
              <DashboardMiniBar label="Assigned" value={stats.assigned} total={stats.totalTasks} tone="warn" />
            </div>

            <div className="dashboard-bars-card">
              <h3>Field Readiness</h3>
              <DashboardMiniBar label="Checklist Done" value={dashboardOverview.checklist.done} total={dashboardOverview.checklist.total} tone="good" />
              <DashboardMiniBar label="FE Updates" value={dashboardOverview.updateCount} total={Math.max(dashboardOverview.updateCount, 1)} tone="info" />
              <DashboardMiniBar label="Issues" value={dashboardOverview.issueCount} total={Math.max(dashboardOverview.issueCount, 1)} tone="bad" />
            </div>

            <div className="dashboard-project-card">
              <h3>Top Projects</h3>
              {dashboardOverview.projectRows.length ? (
                dashboardOverview.projectRows.map((row) => (
                  <div key={row.name} className="dashboard-project-line">
                    <div>
                      <b>{row.name}</b>
                      <span>{row.customer} | {row.market}</span>
                    </div>
                    <strong>{row.completed}/{row.total}</strong>
                  </div>
                ))
              ) : (
                <p>No project activity in this period.</p>
              )}
            </div>
          </div>
        </section>

        <AdminLiveMap
          filters={filters}
          focusedLocation={focusedLocation}
          showGridLayer
          showCellSites
          showCellSectors
          showAssignedGrids
        />
      </div>
    );
  }

  function renderActiveView() {
    if (activeView === "overview") {
      return renderDashboardOverview();
    }

    if (activeView === "userManagement") return renderUserManagement();
    if (activeView === "createProject") return renderCreateProject();

    if (activeView === "assignTask") {
      return (
        <AssignTask
          projects={projects}
          fieldEngineers={fieldEngineers}
          onTaskCreated={fetchAll}
          setActiveView={setActiveView}
          setMessage={setMessage}
        />
      );
    }

    if (activeView === "taskTracking") return renderTaskTracking();

    if (activeView === "liveMap") {
      return <AdminLiveMap
          filters={filters}
          focusedLocation={focusedLocation}
          showGridLayer
          showCellSites
          showCellSectors
          showAssignedGrids
        />;
    }

    if (activeView === "timeline") return renderTimeline();
    if (activeView === "updates") return renderUpdates();

    if (activeView === "routes") {
      return <RouteManagement />;
    }

    if (activeView === "uploadKml") {
      return <GridUpload filters={filters} />;
    }

    if (activeView === "cellFiles") {
      return <CellFileManagement user={user} />;
    }

    if (activeView === "assignRoute") {
  return (
    <AssignedRoutes
      projects={projects}
      fieldEngineers={fieldEngineers}
      tasks={tasks}
      setActiveView={setActiveView}
    />
  );
}
    if (activeView === "qc") {
      return <QCReview user={user} filters={filters} />;
    }

    if (activeView === "reports") {
      return (
        <Reports
          user={user}
          filters={filters}
          projects={projects}
          tasks={tasks}
          fieldEngineers={fieldEngineers}
        />
      );
    }

    return null;
  }

  return (
    <div className={`admin-shell theme-${themeMode}`}>
      <style>{adminCompactLayoutCss}</style>

      <aside className="admin-sidebar">
        <div className="brand-block">
          <div className="brand-icon">🐉</div>
          <div>
            <h1>BabyDragon</h1>
            <p>Admin Command Center</p>
          </div>
        </div>

        <div className="sidebar-user">
          <span>Signed in</span>
          <b>{user?.email}</b>
        </div>

        <button
          className={`nav-btn dashboard-home-btn ${activeView === "overview" ? "active" : ""}`}
          onClick={() => setActiveView("overview")}
        >
          <span>📊</span>
          Dashboard Overview
        </button>

        <nav className="side-nav">
          {menuGroups.map((group) => {
            const isCollapsed = Boolean(collapsedMenuGroups[group.title]);
            const hasActiveItem = group.items.some((item) => item.id === activeView);

            return (
              <div key={group.title} className="nav-group compact-nav-group">
                <button
                  type="button"
                  className={`nav-group-toggle ${hasActiveItem ? "active-group" : ""}`}
                  onClick={() => toggleMenuGroup(group.title)}
                >
                  <span>{group.title}</span>
                  <b>{isCollapsed ? "▸" : "▾"}</b>
                </button>

                {!isCollapsed && (
                  <div className="nav-group-items">
                    {group.items.map((item) => (
                      <button
                        key={item.id}
                        className={`nav-btn ${activeView === item.id ? "active" : ""}`}
                        onClick={() => setActiveView(item.id)}
                      >
                        <span>{item.icon}</span>
                        {item.label}
                        {item.soon && <small>Soon</small>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <button
          className={`nav-btn ${activeView === "userManagement" ? "active" : ""}`}
          onClick={() => setActiveView("userManagement")}
        >
          <span>👥</span>
          User Management
        </button>

        <button className="logout-btn" onClick={onLogout}>
          Logout
        </button>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-inner">
            <h2>Operations Dashboard</h2>
            <p className="workflow-ribbon">Project → Scope → Route → Assignment → Execution → Upload → QC → Report → Close</p>
          </div>

          <button
            type="button"
            className="theme-toggle"
            onClick={() => setThemeMode((current) => (current === "night" ? "day" : "night"))}
            title="Switch day/night theme"
          >
            {themeMode === "night" ? "☀️ Day" : "🌙 Night"}
          </button>
        </header>

        <section className="filters-card">
          <div className="filter-title">
            <h3>Filters <span className="date-filter-pill">{getDashboardDateLabel(filters)}</span></h3>
            <button
              className="small-btn"
              onClick={() =>
                setFilters({
                  projectId: "",
                  market: "",
                  status: "",
                  feId: "",
                  dateMode: "all",
                  dateFrom: "",
                  dateTo: "",
                })
              }
            >
              Clear
            </button>
          </div>

          <div className="filters-grid">
            <select
              value={filters.projectId}
              onChange={(e) =>
                setFilters({ ...filters, projectId: e.target.value })
              }
            >
              <option value="">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <select
              value={filters.market}
              onChange={(e) => setFilters({ ...filters, market: e.target.value })}
            >
              <option value="">All Markets</option>
              {markets.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">All Statuses</option>
              <option value="Available">Available</option>
              <option value="Assigned">Assigned</option>
              <option value="In Progress">In Progress</option>
              <option value="Completed">Completed</option>
              <option value="Needs Re-drive">Needs Re-drive</option>
            </select>

            <select
              value={filters.feId}
              onChange={(e) => setFilters({ ...filters, feId: e.target.value })}
            >
              <option value="">All FEs</option>
              {fieldEngineers.map((fe) => (
                <option key={fe.id} value={fe.id}>
                  {fe.email}
                </option>
              ))}
            </select>
          </div>

          <div className="date-filter-row">
            <select
              value={filters.dateMode || "all"}
              onChange={(e) => {
                const value = e.target.value;
                setFilters({
                  ...filters,
                  dateMode: value,
                  dateFrom: value === "custom" ? filters.dateFrom : "",
                  dateTo: value === "custom" ? filters.dateTo : "",
                });
              }}
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="custom">Custom Date Range</option>
            </select>

            <input
              type="date"
              value={filters.dateFrom || ""}
              disabled={filters.dateMode !== "custom"}
              onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value, dateMode: "custom" })}
            />

            <input
              type="date"
              value={filters.dateTo || ""}
              disabled={filters.dateMode !== "custom"}
              onChange={(e) => setFilters({ ...filters, dateTo: e.target.value, dateMode: "custom" })}
            />

            <button
              type="button"
              className="small-btn"
              onClick={() => setMessage(`Date range applied: ${getDashboardDateLabel(filters)}`)}
            >
              Fetch Date Range
            </button>
          </div>
        </section>

        <section className="stats-grid">
          <div className="stat-card">
            <span>Projects</span>
            <b>{stats.projects}</b>
          </div>

          <div className="stat-card">
            <span>Total Tasks</span>
            <b>{stats.totalTasks}</b>
          </div>

          <div className="stat-card">
            <span>Assigned</span>
            <b>{stats.assigned}</b>
          </div>

          <div className="stat-card active-stat">
            <span>In Progress</span>
            <b>{stats.inProgress}</b>
          </div>

          <div className="stat-card done-stat">
            <span>Completed</span>
            <b>{stats.completed}</b>
          </div>

          <div className="stat-card">
            <span>Active FEs</span>
            <b>{stats.activeFes}</b>
          </div>
        </section>

        {message && <div className="message-bar">{message}</div>}

        <section className="content-area">{renderActiveView()}</section>
      </main>
    </div>
  );
}

function DashboardMiniBar({ label, value, total, tone = "default" }) {
  const percent = total ? Math.round((Number(value || 0) / Number(total || 0)) * 100) : 0;

  return (
    <div className="dashboard-mini-bar">
      <div>
        <span>{label}</span>
        <b>{value}</b>
      </div>
      <div className="dashboard-mini-track">
        <i className={tone} style={{ width: `${Math.max(percent, value ? 5 : 0)}%` }} />
      </div>
    </div>
  );
}

const adminCompactLayoutCss = `
  :root {
    --bd-admin-right-gutter: 12px;
  }

  body.bd-theme-night {
    background: #07111f !important;
  }

  body.bd-theme-day {
    background: #edf5ff !important;
  }

  html,
  body,
  #root {
    width: 100% !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow-x: hidden !important;
    background: #07111f !important;
  }

  .admin-shell {
    width: 100vw !important;
    max-width: none !important;
    min-height: 100vh !important;
    margin: 0 !important;
    display: flex !important;
    align-items: stretch !important;
    justify-content: flex-start !important;
    background: #07111f !important;
    box-sizing: border-box !important;
    padding-right: var(--bd-admin-right-gutter) !important;
  }

  .admin-sidebar {
    flex: 0 0 210px !important;
    width: 210px !important;
    max-width: 210px !important;
    min-height: 100vh !important;
    box-sizing: border-box !important;
    padding: 12px 10px !important;
  }

  .brand-block {
    padding: 12px 12px !important;
    border-radius: 14px !important;
    margin-bottom: 8px !important;
    position: relative !important;
    padding-right: 0 !important;
    box-sizing: border-box !important;
  }

  .brand-icon {
    font-size: 28px !important;
  }

  .brand-block h1 {
    font-size: 18px !important;
    margin: 0 0 3px !important;
  }

  .brand-block p {
    font-size: 11px !important;
    line-height: 1.25 !important;
    margin: 0 !important;
  }

  .sidebar-user {
    padding: 12px 10px !important;
    border-radius: 12px !important;
    margin-bottom: 10px !important;
  }

  .sidebar-user span {
    font-size: 10px !important;
  }

  .sidebar-user b {
    font-size: 12px !important;
  }

  .admin-main {
    flex: 1 1 auto !important;
    width: calc(100vw - 210px - var(--bd-admin-right-gutter)) !important;
    max-width: none !important;
    min-width: 0 !important;
    padding: 10px 18px 14px 14px !important;
    box-sizing: border-box !important;
  }

  .admin-topbar {
    width: 100% !important;
    display: flex !important;
    justify-content: center !important;
    align-items: center !important;
    text-align: center !important;
    margin-bottom: 8px !important;
    position: relative !important;
    padding-right: 0 !important;
    box-sizing: border-box !important;
  }

  .admin-topbar-inner {
    width: 100% !important;
    max-width: 980px !important;
    margin: 0 auto !important;
  }

  .admin-topbar h2 {
    font-size: clamp(20px, 1.45vw, 24px) !important;
    margin: 0 0 3px !important;
    line-height: 1.05 !important;
  }

  .admin-topbar p,
  .workflow-ribbon {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    text-align: center !important;
    font-size: clamp(11px, 0.82vw, 14px) !important;
    margin: 0 auto !important;
    line-height: 1.25 !important;
    color: #93c5fd !important;
    letter-spacing: 0.01em !important;
    white-space: normal !important;
  }

  .filters-card,
  .stats-grid,
  .content-area {
    width: 100% !important;
    max-width: none !important;
    box-sizing: border-box !important;
  }

  .filters-card {
    padding: 12px 14px !important;
    margin-bottom: 10px !important;
    border-radius: 16px !important;
  }

  .filter-title {
    margin-bottom: 8px !important;
  }

  .filter-title h3 {
    font-size: 16px !important;
    margin: 0 !important;
    line-height: 1.1 !important;
  }

  .filter-title button,
  .filters-card button,
  .small-btn,
  button {
    font-size: 11px !important;
  }

  .filters-grid {
    display: grid !important;
    grid-template-columns: repeat(4, minmax(150px, 1fr)) !important;
    gap: 10px !important;
  }

  .date-filter-row {
    display: grid !important;
    grid-template-columns: minmax(170px, 1.2fr) minmax(145px, 1fr) minmax(145px, 1fr) auto !important;
    gap: 10px !important;
    margin-top: 10px !important;
    align-items: center !important;
  }

  .date-filter-pill {
    display: inline-flex !important;
    align-items: center !important;
    margin-left: 8px !important;
    padding: 4px 9px !important;
    border-radius: 999px !important;
    border: 1px solid rgba(96, 165, 250, 0.35) !important;
    background: rgba(59, 130, 246, 0.12) !important;
    color: #93c5fd !important;
    font-size: 11px !important;
    font-weight: 900 !important;
  }

  .filters-grid select,
  .filters-grid input,
  .date-filter-row select,
  .date-filter-row input {
    min-height: 34px !important;
    height: 34px !important;
    font-size: 12px !important;
    padding: 7px 10px !important;
    border-radius: 10px !important;
  }

  .stats-grid {
    display: grid !important;
    grid-template-columns: repeat(6, minmax(105px, 1fr)) !important;
    gap: 10px !important;
    margin-bottom: 10px !important;
  }

  .stat-card {
    min-height: 58px !important;
    padding: 10px 12px !important;
    border-radius: 14px !important;
    box-sizing: border-box !important;
  }

  .stat-card span {
    font-size: 11px !important;
    line-height: 1.1 !important;
  }

  .stat-card b {
    font-size: clamp(20px, 1.45vw, 25px) !important;
    line-height: 1.05 !important;
  }

  .content-area {
    margin-top: 0 !important;
  }

  .content-area > .panel-card,
  .panel-card {
    width: 100% !important;
    max-width: none !important;
    box-sizing: border-box !important;
    padding: 12px 14px 14px !important;
    border-radius: 16px !important;
  }

  .panel-header {
    display: flex !important;
    justify-content: space-between !important;
    align-items: flex-start !important;
    gap: 14px !important;
    margin-bottom: 6px !important;
  }

  .panel-header h2 {
    font-size: clamp(18px, 1.35vw, 23px) !important;
    line-height: 1.05 !important;
    margin: 0 0 3px !important;
  }

  .panel-header p {
    font-size: clamp(12px, 0.9vw, 15px) !important;
    line-height: 1.25 !important;
    margin: 0 !important;
  }

  .live-map-status-banner {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    min-height: 24px !important;
    margin: 4px 0 9px !important;
    padding: 4px 10px !important;
    border-radius: 10px !important;
    background: rgba(15, 23, 42, 0.5) !important;
    color: #bfdbfe !important;
    font-size: clamp(12px, 0.95vw, 15px) !important;
    line-height: 1.25 !important;
    text-align: center !important;
  }

  .timeline-map-note {
    margin: 4px 0 10px !important;
    padding: 6px 10px !important;
    border-radius: 10px !important;
    background: rgba(14, 165, 233, 0.12) !important;
    border: 1px solid rgba(56, 189, 248, 0.25) !important;
    color: #bae6fd !important;
    text-align: center !important;
  }

  .map-shell {
    width: 100% !important;
    max-width: none !important;
    margin-top: 8px !important;
    border-radius: 16px !important;
    overflow: hidden !important;
    box-sizing: border-box !important;
  }

  .admin-map,
  .map-shell .leaflet-container {
    width: 100% !important;
    height: clamp(280px, 35vh, 360px) !important;
    min-height: 280px !important;
    border-radius: 16px !important;
  }

  .live-location-list {
    margin-top: 10px !important;
    padding-top: 0 !important;
  }

  .live-location-list h3 {
    font-size: 14px !important;
    margin: 0 0 4px !important;
    text-align: center !important;
  }

  .live-location-list .muted {
    text-align: center !important;
    margin: 4px 0 0 !important;
    color: #bfdbfe !important;
    font-size: 12px !important;
  }

  .compact-nav-group {
    margin-bottom: 6px !important;
  }



  .dashboard-overview-stack {
    display: grid !important;
    gap: 14px !important;
  }

  .dashboard-exec-panel {
    background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(96,165,250,0.05)) !important;
    border: 1px solid rgba(96, 165, 250, 0.22) !important;
    border-radius: 18px !important;
    padding: 16px !important;
    box-shadow: 0 16px 34px rgba(0,0,0,0.16) !important;
  }

  .dashboard-exec-header {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) 150px !important;
    gap: 14px !important;
    align-items: stretch !important;
    margin-bottom: 14px !important;
  }

  .dashboard-exec-header p {
    margin: 0 0 4px !important;
    color: #60a5fa !important;
    font-size: 11px !important;
    font-weight: 950 !important;
    letter-spacing: 0.12em !important;
    text-transform: uppercase !important;
  }

  .dashboard-exec-header h2 {
    margin: 0 !important;
    color: #e8f1ff !important;
    font-size: clamp(22px, 2vw, 30px) !important;
    line-height: 1.15 !important;
  }

  .dashboard-exec-header span {
    display: block !important;
    margin-top: 7px !important;
    color: #c9d7ee !important;
    font-size: 13px !important;
    font-weight: 800 !important;
  }

  .dashboard-score-card {
    display: grid !important;
    place-items: center !important;
    text-align: center !important;
    border: 1px solid rgba(96,165,250,0.28) !important;
    border-radius: 16px !important;
    background: rgba(15, 23, 42, 0.44) !important;
  }

  .dashboard-score-card span {
    color: #93c5fd !important;
    font-size: 12px !important;
    font-weight: 900 !important;
  }

  .dashboard-score-card b {
    color: #4ade80 !important;
    font-size: 34px !important;
    line-height: 1 !important;
  }

  .dashboard-chart-grid {
    display: grid !important;
    grid-template-columns: 0.8fr 1.15fr 1.15fr 1.25fr !important;
    gap: 12px !important;
  }

  .dashboard-donut-card,
  .dashboard-bars-card,
  .dashboard-project-card {
    background: rgba(15, 23, 42, 0.38) !important;
    border: 1px solid rgba(96,165,250,0.2) !important;
    border-radius: 16px !important;
    padding: 13px !important;
    min-width: 0 !important;
  }

  .dashboard-donut-card {
    display: grid !important;
    place-items: center !important;
    text-align: center !important;
  }

  .dashboard-donut-card p,
  .dashboard-bars-card h3,
  .dashboard-project-card h3 {
    margin: 8px 0 0 !important;
    color: #e8f1ff !important;
    font-size: 14px !important;
    font-weight: 950 !important;
  }

  .dashboard-bars-card h3,
  .dashboard-project-card h3 {
    margin: 0 0 10px !important;
  }

  .dashboard-donut {
    width: 112px !important;
    height: 112px !important;
    border-radius: 999px !important;
    display: grid !important;
    place-items: center !important;
    background: radial-gradient(circle at center, #071323 0 56%, transparent 57%), conic-gradient(#22c55e var(--pct), rgba(148,163,184,0.22) 0) !important;
  }

  .dashboard-donut strong {
    display: block !important;
    color: #ffffff !important;
    font-size: 24px !important;
    line-height: 1 !important;
  }

  .dashboard-donut span {
    display: block !important;
    color: #93c5fd !important;
    font-size: 11px !important;
    font-weight: 900 !important;
    margin-top: 5px !important;
  }

  .dashboard-mini-bar {
    margin-bottom: 10px !important;
  }

  .dashboard-mini-bar > div:first-child {
    display: flex !important;
    justify-content: space-between !important;
    gap: 10px !important;
    color: #c9d7ee !important;
    font-size: 12px !important;
    font-weight: 900 !important;
    margin-bottom: 5px !important;
  }

  .dashboard-mini-track {
    height: 8px !important;
    border-radius: 999px !important;
    background: rgba(148,163,184,0.20) !important;
    overflow: hidden !important;
  }

  .dashboard-mini-track i {
    display: block !important;
    height: 100% !important;
    border-radius: 999px !important;
    background: linear-gradient(90deg, #60a5fa, #38bdf8) !important;
  }

  .dashboard-mini-track i.good { background: linear-gradient(90deg, #22c55e, #86efac) !important; }
  .dashboard-mini-track i.warn { background: linear-gradient(90deg, #f59e0b, #fbbf24) !important; }
  .dashboard-mini-track i.bad { background: linear-gradient(90deg, #ef4444, #fb7185) !important; }
  .dashboard-mini-track i.info { background: linear-gradient(90deg, #2563eb, #38bdf8) !important; }

  .dashboard-project-line {
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
    gap: 10px !important;
    padding: 8px 0 !important;
    border-bottom: 1px solid rgba(96,165,250,0.14) !important;
  }

  .dashboard-project-line b,
  .dashboard-project-line strong {
    color: #f8fbff !important;
    font-size: 12px !important;
  }

  .dashboard-project-line span,
  .dashboard-project-card p {
    color: #c9d7ee !important;
    font-size: 11px !important;
    font-weight: 800 !important;
  }

  .content-area [style*="background: #020617"],
  .content-area [style*="background:#020617"],
  .content-area [style*="rgb(2, 6, 23)"] {
    color: #e8f1ff !important;
  }

  .content-area [style*="background: #020617"] *,
  .content-area [style*="background:#020617"] *,
  .content-area [style*="rgb(2, 6, 23)"] * {
    color: #e8f1ff !important;
  }

  body.bd-theme-day .dashboard-exec-panel,
  .theme-day .dashboard-exec-panel {
    background: #ffffff !important;
    border-color: #bfdbfe !important;
  }

  body.bd-theme-day .dashboard-exec-header h2,
  .theme-day .dashboard-exec-header h2,
  body.bd-theme-day .dashboard-donut-card p,
  body.bd-theme-day .dashboard-bars-card h3,
  body.bd-theme-day .dashboard-project-card h3,
  .theme-day .dashboard-donut-card p,
  .theme-day .dashboard-bars-card h3,
  .theme-day .dashboard-project-card h3 {
    color: #0f172a !important;
  }

  body.bd-theme-day .dashboard-exec-header span,
  .theme-day .dashboard-exec-header span,
  body.bd-theme-day .dashboard-mini-bar > div:first-child,
  .theme-day .dashboard-mini-bar > div:first-child,
  body.bd-theme-day .dashboard-project-line span,
  .theme-day .dashboard-project-line span,
  body.bd-theme-day .dashboard-project-card p,
  .theme-day .dashboard-project-card p {
    color: #334155 !important;
  }

  body.bd-theme-day .dashboard-score-card,
  body.bd-theme-day .dashboard-donut-card,
  body.bd-theme-day .dashboard-bars-card,
  body.bd-theme-day .dashboard-project-card,
  .theme-day .dashboard-score-card,
  .theme-day .dashboard-donut-card,
  .theme-day .dashboard-bars-card,
  .theme-day .dashboard-project-card {
    background: #f8fbff !important;
    border-color: #dbeafe !important;
  }

  body.bd-theme-day .dashboard-donut,
  .theme-day .dashboard-donut {
    background: radial-gradient(circle at center, #ffffff 0 56%, transparent 57%), conic-gradient(#22c55e var(--pct), #e2e8f0 0) !important;
  }

  body.bd-theme-day .dashboard-donut strong,
  .theme-day .dashboard-donut strong,
  body.bd-theme-day .dashboard-project-line b,
  body.bd-theme-day .dashboard-project-line strong,
  .theme-day .dashboard-project-line b,
  .theme-day .dashboard-project-line strong {
    color: #0f172a !important;
  }

  .dashboard-home-btn {
    width: 100% !important;
    margin: 2px 0 10px !important;
    border: 1px solid rgba(56, 189, 248, 0.24) !important;
    background: rgba(15, 23, 42, 0.58) !important;
  }

  .dashboard-home-btn.active {
    border-color: rgba(59, 130, 246, 0.55) !important;
    background: rgba(37, 99, 235, 0.18) !important;
  }

  .compact-nav-group h4 {
    display: none !important;
  }

  .nav-group-toggle {
    width: 100%;
    border: none;
    background: transparent;
    color: #93c5fd;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 10px;
    font-weight: 900;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 7px 8px;
    cursor: pointer;
    border-radius: 9px;
  }

  .nav-group-toggle:hover,
  .nav-group-toggle.active-group {
    background: rgba(37, 99, 235, 0.12);
    color: #bfdbfe;
  }

  .nav-group-toggle b {
    color: #e5eefc;
    font-size: 11px;
  }

  .nav-group-items {
    display: grid;
    gap: 4px;
    margin-top: 3px;
    margin-bottom: 7px;
  }

  .nav-btn,
  .side-nav button:not(.nav-group-toggle) {
    min-height: 34px !important;
    padding: 8px 10px !important;
    border-radius: 10px !important;
    font-size: 12px !important;
  }

  .message-bar {
    margin-bottom: 8px !important;
    padding: 8px 10px !important;
    border-radius: 10px !important;
    font-size: 12px !important;
  }


  .theme-toggle {
    position: absolute !important;
    right: 4px !important;
    top: 0 !important;
    transform: none !important;
    border: 1px solid rgba(56, 189, 248, 0.35) !important;
    background: rgba(15, 23, 42, 0.85) !important;
    color: #e5eefc !important;
    border-radius: 999px !important;
    padding: 7px 11px !important;
    font-weight: 900 !important;
    font-size: 12px !important;
    cursor: pointer !important;
    box-shadow: 0 8px 24px rgba(0,0,0,0.18) !important;
  }

  .theme-toggle:hover {
    border-color: rgba(59, 130, 246, 0.75) !important;
  }

  .theme-day.admin-shell {
    background: #edf5ff !important;
    color: #0f172a !important;
  }

  .theme-day .admin-sidebar {
    background: #f8fbff !important;
    border-right: 1px solid rgba(37, 99, 235, 0.18) !important;
  }

  .theme-day .admin-main {
    background: #edf5ff !important;
    color: #0f172a !important;
  }

  .theme-day .brand-block,
  .theme-day .sidebar-user,
  .theme-day .filters-card,
  .theme-day .stat-card,
  .theme-day .panel-card,
  .theme-day .content-area > .panel-card,
  .theme-day .task-card,
  .theme-day .timeline-task-card,
  .theme-day .update-card,
  .theme-day .user-row {
    background: #ffffff !important;
    border-color: rgba(37, 99, 235, 0.18) !important;
    color: #0f172a !important;
    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.07) !important;
  }

  .theme-day .admin-topbar h2,
  .theme-day .panel-header h2,
  .theme-day .filter-title h3,
  .theme-day .brand-block h1,
  .theme-day h1,
  .theme-day h2,
  .theme-day h3,
  .theme-day h4,
  .theme-day b {
    color: #0f172a !important;
  }

  .theme-day .workflow-ribbon,
  .theme-day .admin-topbar p,
  .theme-day .panel-header p,
  .theme-day .muted,
  .theme-day .sidebar-user span,
  .theme-day .stat-card span,
  .theme-day .live-map-status-banner,
  .theme-day .live-location-list .muted {
    color: #2563eb !important;
  }

  .theme-day .filters-grid select,
  .theme-day .filters-grid input,
  .theme-day .date-filter-row select,
  .theme-day .date-filter-row input,
  .theme-day input,
  .theme-day select,
  .theme-day textarea {
    background: #f8fbff !important;
    border-color: rgba(37, 99, 235, 0.22) !important;
    color: #0f172a !important;
  }

  .theme-day .nav-btn,
  .theme-day .side-nav button:not(.nav-group-toggle),
  .theme-day .dashboard-home-btn {
    color: #0f172a !important;
    background: #ffffff !important;
    border-color: rgba(37, 99, 235, 0.18) !important;
  }

  .theme-day .nav-btn.active,
  .theme-day .dashboard-home-btn.active {
    color: #0f172a !important;
    background: #dbeafe !important;
    border-color: rgba(37, 99, 235, 0.45) !important;
  }

  .theme-day .nav-group-toggle {
    color: #1d4ed8 !important;
    background: transparent !important;
  }

  .theme-day .nav-group-toggle:hover,
  .theme-day .nav-group-toggle.active-group {
    background: #dbeafe !important;
    color: #0f172a !important;
  }

  .theme-day .small-btn,
  .theme-day .theme-toggle {
    background: #ffffff !important;
    border-color: rgba(37, 99, 235, 0.25) !important;
    color: #0f172a !important;
  }

  .theme-day .live-map-status-banner,
  .theme-day .timeline-map-note,
  .theme-day .message-bar {
    background: #eff6ff !important;
    border-color: rgba(37, 99, 235, 0.18) !important;
    color: #1d4ed8 !important;
  }

  @media (min-width: 1500px) {
    .admin-main {
      padding-left: 18px !important;
      padding-right: 18px !important;
    }
  }

  @media (max-width: 1180px) {
    .admin-sidebar {
      flex-basis: 200px !important;
      width: 200px !important;
      max-width: 200px !important;
    }

    .admin-main {
      width: calc(100vw - 200px - var(--bd-admin-right-gutter)) !important;
      padding: 10px 16px 14px 12px !important;
    }

    .filters-grid {
      grid-template-columns: repeat(2, minmax(160px, 1fr)) !important;
    }

    .stats-grid {
      grid-template-columns: repeat(3, minmax(120px, 1fr)) !important;
    }
  }

  @media (max-width: 900px) {
    .admin-shell {
      display: block !important;
      width: 100% !important;
      max-width: none !important;
    }

    .admin-sidebar {
      width: 100% !important;
      max-width: none !important;
      min-height: auto !important;
    }

    .admin-main {
      width: 100% !important;
      max-width: none !important;
      padding: 10px !important;
    }

    .filters-grid,
    .date-filter-row,
    .stats-grid {
      grid-template-columns: 1fr !important;
    }

    .admin-topbar {
      padding-right: 0 !important;
      padding-bottom: 40px !important;
    }

    .theme-toggle {
      right: 50% !important;
      top: auto !important;
      bottom: 0 !important;
      transform: translateX(50%) !important;
    }

    .admin-map,
    .map-shell .leaflet-container {
      height: 320px !important;
    }
  }

  /* Day-view color polish V2 */
  .theme-day.admin-shell {
    background: #eaf3ff !important;
  }

  .theme-day .admin-sidebar {
    background: #f5f9ff !important;
    border-right: 1px solid rgba(30, 64, 175, 0.16) !important;
  }

  .theme-day .admin-main {
    background: #eaf3ff !important;
  }

  .theme-day .brand-block {
    background: linear-gradient(135deg, #ffffff, #edf5ff) !important;
    border-color: rgba(37, 99, 235, 0.22) !important;
  }

  .theme-day .brand-block p {
    color: #64748b !important;
    font-weight: 700 !important;
  }

  .theme-day .sidebar-user span {
    color: #2563eb !important;
  }

  .theme-day .sidebar-user b {
    color: #0f172a !important;
  }

  .theme-day .nav-group-toggle {
    color: #1e40af !important;
    letter-spacing: 0.10em !important;
  }

  .theme-day .nav-group-toggle b {
    color: #1e40af !important;
  }

  .theme-day .nav-btn,
  .theme-day .side-nav button:not(.nav-group-toggle),
  .theme-day .dashboard-home-btn {
    color: #1e293b !important;
    background: transparent !important;
    border-color: transparent !important;
  }

  .theme-day .nav-btn:hover,
  .theme-day .side-nav button:not(.nav-group-toggle):hover,
  .theme-day .dashboard-home-btn:hover {
    background: #e0edff !important;
    border-color: rgba(37, 99, 235, 0.22) !important;
  }

  .theme-day .nav-btn.active,
  .theme-day .dashboard-home-btn.active {
    color: #0f172a !important;
    background: #dbeafe !important;
    border-color: rgba(37, 99, 235, 0.42) !important;
    box-shadow: inset 3px 0 0 #2563eb !important;
  }

  .theme-day .filters-card,
  .theme-day .stat-card,
  .theme-day .panel-card,
  .theme-day .content-area > .panel-card {
    background: #ffffff !important;
    border-color: rgba(30, 64, 175, 0.16) !important;
    box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06) !important;
  }

  .theme-day .admin-topbar h2,
  .theme-day .panel-header h2,
  .theme-day .filter-title h3 {
    color: #102033 !important;
  }

  .theme-day .workflow-ribbon,
  .theme-day .admin-topbar p {
    color: #2563eb !important;
    font-weight: 700 !important;
  }

  .theme-day .panel-header p,
  .theme-day .muted,
  .theme-day .stat-card span {
    color: #475569 !important;
  }

  .theme-day .filters-grid select,
  .theme-day .filters-grid input,
  .theme-day .date-filter-row select,
  .theme-day .date-filter-row input,
  .theme-day input,
  .theme-day select,
  .theme-day textarea {
    background: #f8fbff !important;
    border-color: rgba(30, 64, 175, 0.20) !important;
    color: #0f172a !important;
  }

  .theme-day .filters-grid select:focus,
  .theme-day .filters-grid input:focus,
  .theme-day .date-filter-row select:focus,
  .theme-day .date-filter-row input:focus,
  .theme-day input:focus,
  .theme-day select:focus,
  .theme-day textarea:focus {
    border-color: rgba(37, 99, 235, 0.55) !important;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.10) !important;
  }

  .theme-day .live-map-status-banner,
  .theme-day .timeline-map-note,
  .theme-day .message-bar {
    background: #eef6ff !important;
    color: #1e40af !important;
    border-color: rgba(30, 64, 175, 0.14) !important;
  }

  .theme-day .live-location-list h3 {
    color: #0f172a !important;
  }

  .theme-day .live-location-list .muted {
    color: #2563eb !important;
  }

  .theme-day .small-btn,
  .theme-day .theme-toggle {
    background: #ffffff !important;
    border-color: rgba(30, 64, 175, 0.22) !important;
    color: #0f172a !important;
  }

  .theme-day .small-btn:hover,
  .theme-day .theme-toggle:hover {
    background: #dbeafe !important;
    border-color: rgba(37, 99, 235, 0.42) !important;
  }



  /* Day-view contrast polish V3 */
  .theme-day .brand-block p,
  .theme-day .brand-block small,
  .theme-day .sidebar-user span {
    color: #334155 !important;
    font-weight: 700 !important;
  }

  .theme-day .panel-card label,
  .theme-day .filters-card label,
  .theme-day .content-area label,
  .theme-day .form-label,
  .theme-day label {
    color: #17324d !important;
    font-weight: 850 !important;
  }

  .theme-day .panel-card p,
  .theme-day .panel-card .muted,
  .theme-day .muted,
  .theme-day .card-text,
  .theme-day .subtitle {
    color: #475569 !important;
  }

  .theme-day .filters-card,
  .theme-day .stat-card,
  .theme-day .panel-card,
  .theme-day .content-area > .panel-card {
    background: #ffffff !important;
    border-color: rgba(30, 64, 175, 0.18) !important;
  }

  .theme-day .stat-card {
    background: linear-gradient(180deg, #ffffff 0%, #f7fbff 100%) !important;
  }

  .theme-day .stat-card b,
  .theme-day .info-box b,
  .theme-day .info-box strong {
    color: #0f172a !important;
  }

  .theme-day .info-box,
  .theme-day [class*="info-box"] {
    background: #f8fbff !important;
    border: 1px solid rgba(30, 64, 175, 0.22) !important;
    color: #0f172a !important;
    box-shadow: none !important;
  }

  .theme-day .info-box *,
  .theme-day [class*="info-box"] * {
    color: #0f172a !important;
  }

  .theme-day .filters-grid select,
  .theme-day .filters-grid input,
  .theme-day .date-filter-row select,
  .theme-day .date-filter-row input,
  .theme-day input,
  .theme-day select,
  .theme-day textarea {
    background: #ffffff !important;
    border-color: rgba(30, 64, 175, 0.24) !important;
    color: #0f172a !important;
  }

  .theme-day input::placeholder,
  .theme-day textarea::placeholder {
    color: #64748b !important;
    opacity: 1 !important;
  }

  .theme-day .small-btn,
  .theme-day .theme-toggle,
  .theme-day button:not(.nav-group-toggle):not(.logout-btn) {
    color: #0f172a !important;
  }

  .theme-day button[style*="#2563eb"],
  .theme-day button[style*="37, 99, 235"],
  .theme-day button[style*="#16a34a"],
  .theme-day button[style*="22, 163, 74"],
  .theme-day button[style*="#dc2626"],
  .theme-day button[style*="220, 38, 38"] {
    color: #ffffff !important;
  }

  .theme-day .cell-sector-legend,
  .theme-day .cell-sector-legend *,
  .theme-day .leaflet-container .cell-sector-legend,
  .theme-day .leaflet-container .cell-sector-legend * {
    color: #e5eefc !important;
  }

  .theme-day .leaflet-control-attribution,
  .theme-day .leaflet-control-attribution * {
    color: #334155 !important;
  }


  /* Day-view readability fix V4 - Task Tracking details */
  .theme-day .task-card {
    background: #ffffff !important;
    border-color: rgba(37, 99, 235, 0.18) !important;
    box-shadow: 0 8px 20px rgba(15, 23, 42, 0.045) !important;
  }

  .theme-day .task-card-top h3 {
    color: #0f172a !important;
  }

  .theme-day .task-card-top p {
    color: #334155 !important;
  }

  .theme-day .task-meta-grid > div {
    background: #f8fbff !important;
    border: 1px solid rgba(30, 64, 175, 0.20) !important;
    color: #0f172a !important;
    box-shadow: none !important;
  }

  .theme-day .task-meta-grid > div span {
    color: #2563eb !important;
    font-weight: 850 !important;
  }

  .theme-day .task-meta-grid > div b,
  .theme-day .task-meta-grid > div strong {
    color: #0f172a !important;
    font-weight: 900 !important;
  }

  .theme-day .updates-box,
  .theme-day .update-item {
    background: #f8fbff !important;
    border-color: rgba(30, 64, 175, 0.20) !important;
    color: #0f172a !important;
  }

  .theme-day .updates-box *,
  .theme-day .update-item * {
    color: #0f172a !important;
  }

  .theme-day .status-pill.completed {
    background: #dcfce7 !important;
    border: 1px solid #86efac !important;
    color: #047857 !important;
  }

  .theme-day .status-pill.in_progress {
    background: #e0f2fe !important;
    border: 1px solid #7dd3fc !important;
    color: #0369a1 !important;
  }

  .theme-day .status-pill.assigned,
  .theme-day .status-pill.pending {
    background: #fef3c7 !important;
    border: 1px solid #fde68a !important;
    color: #92400e !important;
  }

  .theme-day .task-card .small-btn {
    background: #eaf2ff !important;
    border-color: rgba(37, 99, 235, 0.30) !important;
    color: #0f172a !important;
  }


  /* Admin checklist + issue reporting V1 */
  .admin-mini-pill {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 7px 10px !important;
    border-radius: 999px !important;
    font-size: 11px !important;
    font-weight: 900 !important;
    border: 1px solid rgba(148, 163, 184, 0.28) !important;
    white-space: nowrap !important;
  }

  .admin-mini-pill.checklist-pill {
    background: rgba(34, 197, 94, 0.12) !important;
    color: #86efac !important;
    border-color: rgba(34, 197, 94, 0.35) !important;
  }

  .admin-mini-pill.issue-pill {
    background: rgba(245, 158, 11, 0.13) !important;
    color: #fde68a !important;
    border-color: rgba(245, 158, 11, 0.38) !important;
  }

  .admin-qc-summary-grid {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
    gap: 12px !important;
    margin: 12px 0 !important;
  }

  .admin-checklist-box,
  .admin-issues-box {
    border: 1px solid rgba(148, 163, 184, 0.22) !important;
    background: rgba(15, 23, 42, 0.52) !important;
    border-radius: 14px !important;
    padding: 12px !important;
    color: #e5eefc !important;
  }

  .admin-checklist-box {
    border-color: rgba(34, 197, 94, 0.26) !important;
  }

  .admin-issues-box {
    border-color: rgba(245, 158, 11, 0.28) !important;
  }

  .admin-section-head {
    display: flex !important;
    justify-content: space-between !important;
    align-items: flex-start !important;
    gap: 10px !important;
    margin-bottom: 10px !important;
  }

  .admin-section-head b {
    color: #f8fafc !important;
    font-size: 14px !important;
  }

  .admin-section-head p {
    margin: 3px 0 0 !important;
    color: #bfdbfe !important;
    font-size: 12px !important;
  }

  .admin-progress-badge {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    min-width: 42px !important;
    padding: 7px 10px !important;
    border-radius: 999px !important;
    background: rgba(34, 197, 94, 0.14) !important;
    color: #86efac !important;
    border: 1px solid rgba(34, 197, 94, 0.40) !important;
    font-weight: 900 !important;
    font-size: 12px !important;
  }

  .admin-progress-badge.has-issues {
    background: rgba(245, 158, 11, 0.14) !important;
    color: #fde68a !important;
    border-color: rgba(245, 158, 11, 0.42) !important;
  }

  .admin-checklist-list,
  .admin-issue-list {
    display: grid !important;
    gap: 8px !important;
  }

  .admin-checklist-item {
    display: grid !important;
    grid-template-columns: 22px minmax(0, 1fr) !important;
    align-items: flex-start !important;
    gap: 8px !important;
    padding: 9px 10px !important;
    border-radius: 10px !important;
    background: rgba(2, 6, 23, 0.24) !important;
    border: 1px solid rgba(148, 163, 184, 0.14) !important;
  }

  .admin-checklist-item.done {
    background: rgba(34, 197, 94, 0.10) !important;
    border-color: rgba(34, 197, 94, 0.24) !important;
  }

  .admin-checklist-item b {
    display: block !important;
    color: #e5eefc !important;
    font-size: 12px !important;
  }

  .admin-checklist-item small,
  .admin-issue-item small {
    display: block !important;
    margin-top: 3px !important;
    color: #93c5fd !important;
    font-size: 11px !important;
  }

  .admin-issue-item {
    padding: 10px !important;
    border-radius: 10px !important;
    background: rgba(2, 6, 23, 0.24) !important;
    border: 1px solid rgba(245, 158, 11, 0.20) !important;
  }

  .admin-issue-top {
    display: flex !important;
    justify-content: space-between !important;
    align-items: flex-start !important;
    gap: 8px !important;
    margin-bottom: 6px !important;
  }

  .admin-issue-top b {
    color: #f8fafc !important;
    font-size: 13px !important;
  }

  .admin-issue-item p {
    margin: 0 0 6px !important;
    color: #dbeafe !important;
    font-size: 12px !important;
    line-height: 1.35 !important;
  }

  .admin-issue-item a {
    color: #38bdf8 !important;
    font-weight: 900 !important;
    text-decoration: none !important;
  }

  .issue-severity {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 5px 8px !important;
    border-radius: 999px !important;
    font-size: 10px !important;
    font-weight: 900 !important;
    text-transform: capitalize !important;
    white-space: nowrap !important;
  }

  .issue-severity.normal {
    background: rgba(59, 130, 246, 0.14) !important;
    color: #bfdbfe !important;
    border: 1px solid rgba(59, 130, 246, 0.30) !important;
  }

  .issue-severity.low {
    background: rgba(34, 197, 94, 0.14) !important;
    color: #bbf7d0 !important;
    border: 1px solid rgba(34, 197, 94, 0.30) !important;
  }

  .issue-severity.high {
    background: rgba(245, 158, 11, 0.14) !important;
    color: #fde68a !important;
    border: 1px solid rgba(245, 158, 11, 0.35) !important;
  }

  .issue-severity.critical {
    background: rgba(239, 68, 68, 0.15) !important;
    color: #fecaca !important;
    border: 1px solid rgba(239, 68, 68, 0.35) !important;
  }

  @media (max-width: 900px) {
    .admin-qc-summary-grid {
      grid-template-columns: 1fr !important;
    }
  }

  .theme-day .admin-mini-pill.checklist-pill {
    background: #dcfce7 !important;
    color: #14532d !important;
    border-color: #86efac !important;
  }

  .theme-day .admin-mini-pill.issue-pill {
    background: #fef3c7 !important;
    color: #92400e !important;
    border-color: #fbbf24 !important;
  }

  .theme-day .admin-checklist-box,
  .theme-day .admin-issues-box {
    background: #f8fbff !important;
    border-color: rgba(30, 64, 175, 0.20) !important;
    color: #0f172a !important;
  }

  .theme-day .admin-checklist-box {
    border-color: rgba(34, 197, 94, 0.35) !important;
  }

  .theme-day .admin-issues-box {
    border-color: rgba(245, 158, 11, 0.40) !important;
  }

  .theme-day .admin-section-head b,
  .theme-day .admin-checklist-item b,
  .theme-day .admin-issue-top b,
  .theme-day .admin-issue-item p {
    color: #0f172a !important;
  }

  .theme-day .admin-section-head p,
  .theme-day .admin-checklist-item small,
  .theme-day .admin-issue-item small {
    color: #475569 !important;
  }

  .theme-day .admin-progress-badge {
    background: #dcfce7 !important;
    color: #14532d !important;
    border-color: #86efac !important;
  }

  .theme-day .admin-progress-badge.has-issues {
    background: #fef3c7 !important;
    color: #92400e !important;
    border-color: #fbbf24 !important;
  }

  .theme-day .admin-checklist-item {
    background: #ffffff !important;
    border-color: rgba(30, 64, 175, 0.16) !important;
  }

  .theme-day .admin-checklist-item.done {
    background: #f0fdf4 !important;
    border-color: #86efac !important;
  }

  .theme-day .admin-issue-item {
    background: #ffffff !important;
    border-color: rgba(245, 158, 11, 0.32) !important;
  }

  .theme-day .issue-severity.normal {
    background: #dbeafe !important;
    color: #1e3a8a !important;
    border-color: #93c5fd !important;
  }

  .theme-day .issue-severity.low {
    background: #dcfce7 !important;
    color: #14532d !important;
    border-color: #86efac !important;
  }

  .theme-day .issue-severity.high {
    background: #fef3c7 !important;
    color: #92400e !important;
    border-color: #fbbf24 !important;
  }

  .theme-day .issue-severity.critical {
    background: #fee2e2 !important;
    color: #991b1b !important;
    border-color: #fca5a5 !important;
  }

  @media (max-width: 1200px) {
    .dashboard-chart-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    }
  }

  @media (max-width: 760px) {
    .dashboard-exec-header,
    .dashboard-chart-grid {
      grid-template-columns: 1fr !important;
    }
  }



  /* Dashboard overview map polish V1.3 */
  .dashboard-overview-stack .map-shell {
    border: 1px solid rgba(96, 165, 250, 0.24) !important;
  }

  .theme-day .live-location-list [style*="background"],
  body.bd-theme-day .live-location-list [style*="background"] {
    background: #f8fbff !important;
    color: #0f172a !important;
    border: 1px solid #bfdbfe !important;
    box-shadow: 0 10px 22px rgba(15, 23, 42, 0.06) !important;
    opacity: 1 !important;
  }

  .theme-day .live-location-list [style*="background"] *,
  body.bd-theme-day .live-location-list [style*="background"] * {
    color: #0f172a !important;
    opacity: 1 !important;
    text-shadow: none !important;
  }

  .theme-day .live-location-list a,
  body.bd-theme-day .live-location-list a {
    color: #1d4ed8 !important;
    font-weight: 900 !important;
  }

  .theme-day .live-location-list .muted,
  body.bd-theme-day .live-location-list .muted {
    color: #1e40af !important;
    font-weight: 800 !important;
  }


  /* Dashboard overview FE location readability V1.4 */
  body.bd-theme-day .dashboard-overview-stack .live-location-list,
  .theme-day .dashboard-overview-stack .live-location-list {
    color: #0f172a !important;
  }

  body.bd-theme-day .dashboard-overview-stack .live-location-list h3,
  .theme-day .dashboard-overview-stack .live-location-list h3 {
    color: #0f172a !important;
    font-weight: 950 !important;
  }

  body.bd-theme-day .dashboard-overview-stack .live-location-list > div,
  .theme-day .dashboard-overview-stack .live-location-list > div,
  body.bd-theme-day .dashboard-overview-stack .live-location-list article,
  .theme-day .dashboard-overview-stack .live-location-list article,
  body.bd-theme-day .dashboard-overview-stack .live-location-list section,
  .theme-day .dashboard-overview-stack .live-location-list section {
    background: #f8fbff !important;
    color: #0f172a !important;
    border: 1px solid #bfdbfe !important;
    box-shadow: 0 10px 22px rgba(15, 23, 42, 0.06) !important;
    opacity: 1 !important;
  }

  body.bd-theme-day .dashboard-overview-stack .live-location-list *,
  .theme-day .dashboard-overview-stack .live-location-list * {
    color: #0f172a !important;
    opacity: 1 !important;
    text-shadow: none !important;
  }

  body.bd-theme-day .dashboard-overview-stack .live-location-list .muted,
  .theme-day .dashboard-overview-stack .live-location-list .muted,
  body.bd-theme-day .dashboard-overview-stack .live-location-list small,
  .theme-day .dashboard-overview-stack .live-location-list small {
    color: #1d4ed8 !important;
    font-weight: 850 !important;
  }

  body.bd-theme-day .dashboard-overview-stack .live-location-list a,
  .theme-day .dashboard-overview-stack .live-location-list a {
    color: #1d4ed8 !important;
    font-weight: 950 !important;
  }



  /* Dashboard overview FE location alignment V1.5 */
  .dashboard-overview-stack .live-location-list {
    width: 100% !important;
  }

  .dashboard-overview-stack .live-location-list h3 {
    text-align: center !important;
    margin-bottom: 8px !important;
  }

  .dashboard-overview-stack .live-location-list > div,
  .dashboard-overview-stack .live-location-list article,
  .dashboard-overview-stack .live-location-list section {
    position: relative !important;
    text-align: center !important;
    padding: 18px 96px 18px 24px !important;
    min-height: 76px !important;
    display: grid !important;
    place-items: center !important;
    gap: 4px !important;
  }

  .dashboard-overview-stack .live-location-list > div > *,
  .dashboard-overview-stack .live-location-list article > *,
  .dashboard-overview-stack .live-location-list section > * {
    text-align: center !important;
    justify-self: center !important;
    margin-left: auto !important;
    margin-right: auto !important;
  }

  .dashboard-overview-stack .live-location-list small,
  .dashboard-overview-stack .live-location-list time {
    position: absolute !important;
    right: 18px !important;
    top: 16px !important;
    text-align: right !important;
    margin: 0 !important;
  }

  body.bd-theme-day .dashboard-overview-stack .live-location-list > div,
  .theme-day .dashboard-overview-stack .live-location-list > div,
  body.bd-theme-day .dashboard-overview-stack .live-location-list article,
  .theme-day .dashboard-overview-stack .live-location-list article,
  body.bd-theme-day .dashboard-overview-stack .live-location-list section,
  .theme-day .dashboard-overview-stack .live-location-list section {
    background: #ffffff !important;
    color: #0f172a !important;
    border: 1px solid #bfdbfe !important;
  }

  body.bd-theme-day .dashboard-overview-stack .live-location-list b,
  .theme-day .dashboard-overview-stack .live-location-list b,
  body.bd-theme-day .dashboard-overview-stack .live-location-list strong,
  .theme-day .dashboard-overview-stack .live-location-list strong {
    color: #020617 !important;
    font-weight: 950 !important;
  }

  body.bd-theme-day .dashboard-overview-stack .live-location-list p,
  .theme-day .dashboard-overview-stack .live-location-list p,
  body.bd-theme-day .dashboard-overview-stack .live-location-list span,
  .theme-day .dashboard-overview-stack .live-location-list span {
    color: #0f172a !important;
    font-weight: 800 !important;
  }


  /* Dashboard Overview cosmetic V1.6: compact FE location row + tighter map */
  .dashboard-overview-stack .map-shell {
    margin-top: 6px !important;
  }

  .dashboard-overview-stack .admin-map,
  .dashboard-overview-stack .map-shell .leaflet-container {
    height: clamp(235px, 29vh, 320px) !important;
    min-height: 235px !important;
  }

  .dashboard-overview-stack .live-location-list {
    margin-top: 8px !important;
  }

  .dashboard-overview-stack .live-location-list h3 {
    margin: 0 0 7px !important;
    font-size: 14px !important;
    line-height: 1.1 !important;
  }

  .dashboard-overview-stack .live-location-row-compact,
  .dashboard-overview-stack .live-location-list .live-location-row-compact {
    display: grid !important;
    grid-template-columns: minmax(220px, 1.1fr) minmax(230px, 0.9fr) 125px !important;
    align-items: center !important;
    gap: 14px !important;
    min-height: auto !important;
    padding: 12px 16px !important;
    text-align: left !important;
    place-items: stretch !important;
    border-radius: 16px !important;
    background: rgba(15, 23, 42, 0.42) !important;
    border: 1px solid rgba(96, 165, 250, 0.26) !important;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.12) !important;
  }

  .dashboard-overview-stack .live-location-row-compact > *,
  .dashboard-overview-stack .live-location-list .live-location-row-compact > * {
    margin: 0 !important;
    text-align: left !important;
    justify-self: stretch !important;
  }

  .live-location-main,
  .live-location-gps,
  .live-location-age {
    display: grid !important;
    gap: 3px !important;
  }

  .live-location-main b {
    font-size: 15px !important;
    line-height: 1.1 !important;
    font-weight: 950 !important;
    color: #f8fbff !important;
  }

  .live-location-main span,
  .live-location-gps span,
  .live-location-age span {
    font-size: 11px !important;
    font-weight: 900 !important;
    color: #93c5fd !important;
    letter-spacing: 0.04em !important;
  }

  .live-location-gps strong,
  .live-location-age strong {
    font-size: 13px !important;
    line-height: 1.1 !important;
    color: #e8f1ff !important;
    font-weight: 900 !important;
  }

  .live-location-age {
    text-align: right !important;
  }

  .live-location-age span,
  .live-location-age strong {
    text-align: right !important;
  }

  body.bd-theme-day .dashboard-overview-stack .live-location-row-compact,
  .theme-day .dashboard-overview-stack .live-location-row-compact,
  body.bd-theme-day .dashboard-overview-stack .live-location-list .live-location-row-compact,
  .theme-day .dashboard-overview-stack .live-location-list .live-location-row-compact {
    background: linear-gradient(135deg, #ffffff, #f8fbff) !important;
    border: 1px solid #bfdbfe !important;
    box-shadow: 0 10px 22px rgba(15, 23, 42, 0.06) !important;
  }

  body.bd-theme-day .live-location-main b,
  .theme-day .live-location-main b,
  body.bd-theme-day .live-location-gps strong,
  .theme-day .live-location-gps strong,
  body.bd-theme-day .live-location-age strong,
  .theme-day .live-location-age strong {
    color: #0f172a !important;
  }

  body.bd-theme-day .live-location-main span,
  .theme-day .live-location-main span,
  body.bd-theme-day .live-location-gps span,
  .theme-day .live-location-gps span,
  body.bd-theme-day .live-location-age span,
  .theme-day .live-location-age span {
    color: #1d4ed8 !important;
  }

  @media (max-width: 900px) {
    .dashboard-overview-stack .live-location-row-compact,
    .dashboard-overview-stack .live-location-list .live-location-row-compact {
      grid-template-columns: 1fr !important;
      gap: 8px !important;
    }

    .live-location-age,
    .live-location-age span,
    .live-location-age strong {
      text-align: left !important;
    }
  }

`;
