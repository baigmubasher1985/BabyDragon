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
import UserManagement from "./pages/UserManagement";

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
    if (!saved) return emptyProject;

    try {
      return JSON.parse(saved);
    } catch {
      localStorage.removeItem("adminProjectForm");
      return emptyProject;
    }
  });

  const [message, setMessage] = useState("");
  const [expandedTaskId, setExpandedTaskId] = useState("");
  const [taskRecordsVisible, setTaskRecordsVisible] = useState(false);
  const [taskListLimit, setTaskListLimit] = useState(25);
  const [expandedTimelineTaskIds, setExpandedTimelineTaskIds] = useState({});
  const [updateRecordsVisible, setUpdateRecordsVisible] = useState(true);
  const [updateSearch, setUpdateSearch] = useState("");
  const [updateTypeFilter, setUpdateTypeFilter] = useState("all");
  const [updateListLimit, setUpdateListLimit] = useState(25);

  const [filters, setFilters] = useState({
    projectId: "",
    market: "",
    status: "",
    feId: "",
    dateMode: "all",
    dateFrom: "",
    dateTo: "",
  });

  const [taskTrackingFilter, setTaskTrackingFilter] = useState("all");

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
    // Supabase returns 1,000 rows by default. BabyDragon GPS logs can fill that
    // quickly, which can hide older photos/comments from other tasks. Pull pages
    // so Evidence Review does not become a one-task GPS tunnel.
    const pageSize = 1000;
    const maxPages = 20;
    let from = 0;
    let allUpdates = [];

    for (let page = 0; page < maxPages; page += 1) {
      const { data, error } = await supabase
        .from("task_updates")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);

      if (error) {
        console.error("Task updates error:", error);
        return;
      }

      const pageRows = data || [];
      allUpdates = allUpdates.concat(pageRows);

      if (pageRows.length < pageSize) break;
      from += pageSize;
    }

    const grouped = {};
    allUpdates.forEach((update) => {
      const key = update.task_id || `unlinked-${update.id}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(update);
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

  function getTaskDisplayName(task) {
    const projectName = task?.projects?.name || task?.project_name || "";
    const targetName = task?.target_name || task?.grid_name || task?.name || "";

    if (projectName && targetName) return `${projectName} • ${targetName}`;
    return targetName || projectName || "Unlinked FE Update";
  }

  function getTaskMetaLine(task) {
    if (!task) return "No task link found for this update";

    return [
      task.market || task.projects?.market || "No Market",
      task.test_type || task.testing_type || task.projects?.testing_type || "No Scope",
      `FE: ${getFeEmail(task.assigned_to)}`,
      statusLabel(task.status),
    ]
      .filter(Boolean)
      .join(" • ");
  }

  function getUpdateText(update) {
    return (
      update?.comment ||
      update?.note ||
      update?.message ||
      update?.description ||
      "No comment provided"
    );
  }

  function getUpdatePhotoUrl(update) {
    return update?.photo_url || update?.image_url || update?.file_url || "";
  }

  function getUpdateKind(update) {
    const text = String(getUpdateText(update) || "").toLowerCase();

    if (getUpdatePhotoUrl(update)) return "photo";
    if (update?.latitude && update?.longitude && text.includes("auto gps")) return "gps";
    if (update?.latitude && update?.longitude && !update?.comment) return "gps";
    if (update?.latitude && update?.longitude && text === "no comment provided") return "gps";
    return "comment";
  }

  function updateKindLabel(kind) {
    if (kind === "photo") return "Photo Evidence";
    if (kind === "gps") return "GPS Point";
    return "Field Comment";
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
      <div className="create-project-page">
        <div className="create-project-hero">
          <div>
            <span className="section-kicker">Project Management</span>
            <h2>Create Project</h2>
            <p>
              Start the BabyDragon workflow by defining the customer, market, and testing scope.
            </p>
          </div>

          <div className="create-project-flow">
            <span>Project</span>
            <b>→</b>
            <span>Scope</span>
            <b>→</b>
            <span>Route</span>
            <b>→</b>
            <span>Assignment</span>
          </div>
        </div>

        <form onSubmit={createProject} className="create-project-card">
          <div className="create-project-card-header">
            <div>
              <h3>Project Details</h3>
              <p>Use a clear name and market so reports, routes, grids, and QC stay organized.</p>
            </div>
            <span className="required-pill">Required fields marked *</span>
          </div>

          <div className="create-project-grid">
            <label className="field-block">
              <span>Project Name *</span>
              <input
                placeholder="Example: Dallas SSV Testing"
                value={projectForm.name}
                onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })}
                required
              />
            </label>

            <label className="field-block">
              <span>Customer</span>
              <input
                placeholder="Example: TMO, GCI, Verizon"
                value={projectForm.customer}
                onChange={(e) => setProjectForm({ ...projectForm, customer: e.target.value })}
              />
            </label>

            <label className="field-block">
              <span>Market *</span>
              <input
                placeholder="Example: Dallas, Alaska, Josephine TX"
                value={projectForm.market}
                onChange={(e) => setProjectForm({ ...projectForm, market: e.target.value })}
                required
              />
            </label>

            <label className="field-block">
              <span>Testing Type</span>
              <input
                placeholder="Example: SSV, Cluster Drive, BM Testing"
                value={projectForm.testing_type}
                onChange={(e) =>
                  setProjectForm({
                    ...projectForm,
                    testing_type: e.target.value,
                  })
                }
              />
            </label>
          </div>

          <div className="create-project-actions">
            <button
              type="button"
              className="secondary-action-btn"
              onClick={() => {
                setProjectForm(emptyProject);
                localStorage.removeItem("adminProjectForm");
                setMessage("Create Project form cleared.");
              }}
            >
              Clear Form
            </button>

            <button type="submit" className="primary-action-btn">
              Create Project
            </button>
          </div>
        </form>
      </div>
    );
  }

  function renderTaskTracking() {
    const baseTasks = filteredTasks;

    function isAutoGpsTaskUpdate(update) {
      const comment = String(update?.comment || "").trim().toLowerCase();

      if (update?.photo_url) return false;

      return (
        comment === "auto gps point" ||
        comment.startsWith("auto gps") ||
        comment.startsWith("checklist gps:")
      );
    }

    function getVisibleAdminUpdates(task) {
      return (taskUpdates[task.id] || []).filter((update) => !isAutoGpsTaskUpdate(update));
    }

    const assignedTaskRecords = baseTasks.filter(
      (task) => task.status === "assigned" || task.status === "pending"
    );
    const inProgressTaskRecords = baseTasks.filter((task) => task.status === "in_progress");
    const completedTaskRecords = baseTasks.filter((task) => task.status === "completed");
    const issueTaskRecords = baseTasks.filter((task) => (taskIssues[task.id] || []).length > 0);
    const updateTaskRecords = baseTasks.filter((task) => getVisibleAdminUpdates(task).length > 0);

    const totalIssues = baseTasks.reduce(
      (sum, task) => sum + (taskIssues[task.id] || []).length,
      0
    );

    const taskTrackingFilterOptions = [
      {
        id: "all",
        label: "All Filtered Tasks",
        count: baseTasks.length,
        helper: "Shows all tasks matching the global filters.",
        records: baseTasks,
      },
      {
        id: "assigned",
        label: "Assigned / Pending",
        count: assignedTaskRecords.length,
        helper: "Tasks waiting for FE start.",
        records: assignedTaskRecords,
      },
      {
        id: "in_progress",
        label: "In Progress",
        count: inProgressTaskRecords.length,
        helper: "Tasks currently active in the field.",
        records: inProgressTaskRecords,
      },
      {
        id: "completed",
        label: "Completed",
        count: completedTaskRecords.length,
        helper: "Tasks marked complete by FE.",
        records: completedTaskRecords,
      },
      {
        id: "issues",
        label: "Issues",
        count: totalIssues,
        helper: "Tasks with reported field issues.",
        records: issueTaskRecords,
        tone: "issue",
      },
      {
        id: "updates",
        label: "Tasks With Updates",
        count: updateTaskRecords.length,
        helper: "Tasks with notes, photos, or manual GPS checkpoints.",
        records: updateTaskRecords,
      },
    ];

    const selectedTrackingFilter =
      taskTrackingFilterOptions.find((option) => option.id === taskTrackingFilter) ||
      taskTrackingFilterOptions[0];

    const taskTrackingRecords = selectedTrackingFilter.records;
    const totalTaskRecords = taskTrackingRecords.length;
    const autoShowSmallList = totalTaskRecords > 0 && totalTaskRecords <= 10;
    const showTaskRecords = taskRecordsVisible || autoShowSmallList;
    const visibleTaskRecords = taskTrackingRecords.slice(0, taskListLimit);

    function applyTaskTrackingFilter(filterId) {
      setTaskTrackingFilter(filterId);
      setTaskRecordsVisible(true);
      setExpandedTaskId("");
    }

    return (
      <div className="panel-card task-tracking-panel">
        <div className="panel-header task-tracking-header">
          <div>
            <span className="module-kicker">FIELD OPERATIONS</span>
            <h2>Task Tracking</h2>
            <p>Track FE task status, checklist progress, issues, photos, notes, and GPS/map evidence.</p>
          </div>
          <div className="task-tracking-header-actions">
            <span className="task-count-pill">{baseTasks.length} global-filtered task(s)</span>
          </div>
        </div>

        <div className="task-filter-band-title">
          <span>Task Tracking Filters</span>
          <b>Module controls. Click a card to filter task records below.</b>
        </div>

        <div className="task-tracking-summary-grid task-tracking-click-grid">
          {taskTrackingFilterOptions.map((option) => {
            const isActive = selectedTrackingFilter.id === option.id;

            return (
              <button
                key={option.id}
                type="button"
                className={`task-tracking-summary-card task-filter-card ${isActive ? "active" : ""} ${option.tone === "issue" ? "issue-summary" : ""}`}
                onClick={() => applyTaskTrackingFilter(option.id)}
              >
                <span>{option.label}</span>
                <b>{option.count}</b>
                <small>{option.helper}</small>
              </button>
            );
          })}
        </div>

        <div className="task-current-filter-line">
          <div>
            Current View: <b>{selectedTrackingFilter.label}</b>
            <span>{selectedTrackingFilter.helper}</span>
          </div>
          {selectedTrackingFilter.id !== "all" && (
            <button type="button" className="small-btn" onClick={() => applyTaskTrackingFilter("all")}>
              Clear Task Filter
            </button>
          )}
        </div>

        <div className="task-records-shell">
          <div className="task-records-head">
            <div>
              <h3>Task Records</h3>
              <p>
                {totalTaskRecords > 10
                  ? "Hidden by default for large task lists. Use filters, then show records when needed."
                  : "Small filtered lists open automatically for quick review."}
              </p>
            </div>

            <div className="task-records-actions">
              <label>
                <span>Table Limit</span>
                <select
                  value={taskListLimit}
                  onChange={(event) => setTaskListLimit(Number(event.target.value))}
                >
                  <option value={25}>25 rows</option>
                  <option value={50}>50 rows</option>
                  <option value={100}>100 rows</option>
                </select>
              </label>

              {totalTaskRecords > 10 && (
                <button
                  type="button"
                  className="small-btn task-records-toggle"
                  onClick={() => setTaskRecordsVisible((current) => !current)}
                >
                  {showTaskRecords ? "Hide Task Records" : `Show Task Records (${totalTaskRecords})`}
                </button>
              )}
            </div>
          </div>

          {taskTrackingRecords.length === 0 ? (
            <div className="task-records-empty">
              No tasks match the selected Task Tracking filter.
            </div>
          ) : !showTaskRecords ? (
            <div className="task-records-hidden-note">
              <b>Task records are hidden to keep the page fast and clean.</b>
              <span>
                {totalTaskRecords} task record(s) are available in {selectedTrackingFilter.label}. Narrow with project, market, status, FE, or date filters, then open the list when needed.
              </span>
            </div>
          ) : (
            <>
              <div className="task-records-showing-line">
                Showing {Math.min(taskListLimit, totalTaskRecords)} of {totalTaskRecords} task record(s) in {selectedTrackingFilter.label}
              </div>

              <div className="task-list compact-task-list">
                {visibleTaskRecords.map((t) => {
                  const isExpanded = String(expandedTaskId) === String(t.id);
                  const updates = getVisibleAdminUpdates(t);
                  const checklist = getChecklistProgress(t.id);
                  const issues = taskIssues[t.id] || [];

                  return (
                    <div key={t.id} className="task-card compact-task-card">
                      <div className="task-card-top compact-task-card-top">
                        <div className="compact-task-main">
                          <h3>{t.projects?.name || "No Project"} • {t.target_name}</h3>
                          <p>
                            {t.market || "No Market"} • {t.test_type || "No Scope"} • FE: {getFeEmail(t.assigned_to)}
                          </p>
                        </div>

                        <div className="compact-task-actions">
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
                                    <div key={item.id} className={item.is_done ? "admin-check-item done" : "admin-check-item"}>
                                      <input type="checkbox" checked={Boolean(item.is_done)} readOnly />
                                      <span>{item.label}</span>
                                      {item.completed_at && <small>{new Date(item.completed_at).toLocaleString()}</small>}
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
                                <span className="admin-progress-badge issue-count">{issues.length}</span>
                              </div>

                              {issues.length > 0 ? (
                                <div className="admin-issue-list">
                                  {issues.slice(0, 4).map((issue) => (
                                    <div key={issue.id} className="admin-issue-card">
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
                              <p className="updates-box-note">Auto GPS trail points are hidden here and remain available on maps/timelines.</p>

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
                })}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  function renderTimeline() {
    function buildTimelineEvents(task) {
      const events = [];

      if (task.created_at) {
        events.push({
          type: "assigned",
          label: "Task Assigned",
          time: task.created_at,
          detail: `${task.projects?.name || "Project"} assigned to ${getFeEmail(task.assigned_to)}`,
        });
      }

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

      return events
        .filter((event) => event.time)
        .sort((a, b) => new Date(a.time) - new Date(b.time));
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

    function toggleTimelineTask(taskId) {
      setExpandedTimelineTaskIds((prev) => ({
        ...prev,
        [taskId]: !prev[taskId],
      }));
    }

    const timelineRows = filteredTasks.map((taskItem) => ({
      task: taskItem,
      events: buildTimelineEvents(taskItem),
    }));

    const timelineTotals = timelineRows.reduce(
      (acc, row) => {
        row.events.forEach((event) => {
          acc.events += 1;
          if (event.type === "started") acc.started += 1;
          if (event.type === "gps") acc.gps += 1;
          if (event.type === "comment" || event.type === "photo") acc.updates += 1;
          if (event.type === "completed") acc.completed += 1;
          if (event.type === "late") acc.late += 1;
        });
        return acc;
      },
      { events: 0, started: 0, gps: 0, updates: 0, completed: 0, late: 0 }
    );

    return (
      <div className="panel-card bd-timeline-v23">
        <div className="bd-timeline-hero">
          <div className="bd-timeline-heading">
            <span className="section-kicker">Field Operations</span>
            <h2>Task Timeline</h2>
            <p>
              Full execution story for task assignment, field start, GPS logs,
              FE updates, photos, completion, and late uploads.
            </p>
          </div>
          <div className="bd-timeline-flow-pill">Assign → Start → GPS → Upload → Complete</div>
        </div>

        <div className="bd-timeline-summary-grid">
          <div className="bd-timeline-summary-card">
            <span>Filtered Tasks</span>
            <b>{timelineRows.length}</b>
          </div>
          <div className="bd-timeline-summary-card">
            <span>Started</span>
            <b>{timelineTotals.started}</b>
          </div>
          <div className="bd-timeline-summary-card">
            <span>GPS Logs</span>
            <b>{timelineTotals.gps}</b>
          </div>
          <div className="bd-timeline-summary-card">
            <span>FE Updates</span>
            <b>{timelineTotals.updates}</b>
          </div>
          <div className="bd-timeline-summary-card">
            <span>Completed</span>
            <b>{timelineTotals.completed}</b>
          </div>
          <div className="bd-timeline-summary-card warn">
            <span>Late Updates</span>
            <b>{timelineTotals.late}</b>
          </div>
        </div>

        <div className="bd-timeline-records-head">
          <div>
            <h3>Task Records / Timeline</h3>
            <p>
              Latest two events are shown by default. Open full timeline only when needed.
            </p>
          </div>
          <span>{timelineTotals.events} event(s)</span>
        </div>

        {timelineRows.length === 0 ? (
          <div className="bd-timeline-empty">No tasks match the selected filters.</div>
        ) : (
          <div className="timeline-task-list">
            {timelineRows.map(({ task, events }) => {
              const isTimelineOpen = Boolean(expandedTimelineTaskIds[task.id]);
              const visibleEvents = isTimelineOpen ? events : events.slice(-2);
              const hiddenCount = Math.max(events.length - visibleEvents.length, 0);

              return (
                <div key={task.id} className="timeline-task-card bd-timeline-task-card">
                  <div className="timeline-task-header bd-timeline-task-header">
                    <div>
                      <h3>
                        {task.projects?.name || "No Project"} • {task.target_name || "No Target"}
                      </h3>
                      <p>
                        {task.market || "No Market"} • {task.test_type || "No Scope"} • FE: {getFeEmail(task.assigned_to)}
                      </p>
                    </div>

                    <div className="bd-timeline-task-actions">
                      <span className={`status-pill ${task.status}`}>{statusLabel(task.status)}</span>
                      <button
                        type="button"
                        className="small-btn bd-timeline-toggle-btn"
                        onClick={() => toggleTimelineTask(task.id)}
                      >
                        {isTimelineOpen ? "Hide Timeline" : "Show Timeline"}
                      </button>
                    </div>
                  </div>

                  {events.length === 0 ? (
                    <div className="bd-timeline-empty small">No timeline events found for this task.</div>
                  ) : (
                    <>
                      {!isTimelineOpen && hiddenCount > 0 && (
                        <div className="bd-timeline-collapsed-note">
                          {hiddenCount} older event(s) hidden. Click Show Timeline for the full execution trail.
                        </div>
                      )}

                      <div className={`timeline-line-wrap ${isTimelineOpen ? "open" : "compact"}`}>
                        {visibleEvents.map((event, index) => (
                          <div key={`${event.type}-${event.time}-${index}`} className="timeline-row">
                            <div className={`timeline-icon ${event.type}`}>{getTimelineIcon(event.type)}</div>

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
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function renderUpdates() {
    const taskById = new Map(tasks.map((taskItem) => [String(taskItem.id), taskItem]));

    const allUpdatesRaw = Object.values(taskUpdates)
      .flatMap((items) => items || [])
      .map((update) => ({
        ...update,
        task: taskById.get(String(update.task_id)) || null,
        kind: getUpdateKind(update),
      }))
      .filter((update) => {
        if (!update.task) return true;
        return filteredTasks.some((taskItem) => String(taskItem.id) === String(update.task.id));
      });

    const evidenceSearch = updateSearch.trim().toLowerCase();

    const filteredUpdates = allUpdatesRaw.filter((update) => {
      const matchesType = updateTypeFilter === "all" || update.kind === updateTypeFilter;
      if (!matchesType) return false;

      if (!evidenceSearch) return true;

      const haystack = [
        getTaskDisplayName(update.task),
        getTaskMetaLine(update.task),
        getUpdateText(update),
        update.task?.target_type,
        update.task?.target_name,
        update.task?.market,
        update.task?.projects?.name,
        update.task?.projects?.customer,
        update.task ? getFeEmail(update.task.assigned_to) : "unlinked",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(evidenceSearch);
    });

    const evidenceTotals = filteredUpdates.reduce(
      (acc, update) => {
        acc.total += 1;
        acc[update.kind] += 1;
        if (update.task?.id) acc.taskIds.add(update.task.id);
        return acc;
      },
      { total: 0, photo: 0, comment: 0, gps: 0, taskIds: new Set() }
    );

    const groupedEvidence = Array.from(
      filteredUpdates.reduce((map, update) => {
        const key = update.task?.id || `unlinked-${update.id}`;

        if (!map.has(key)) {
          map.set(key, {
            key,
            task: update.task,
            updates: [],
          });
        }

        map.get(key).updates.push(update);
        return map;
      }, new Map()).values()
    ).sort((a, b) => {
      const aTime = new Date(a.updates[0]?.created_at || 0).getTime();
      const bTime = new Date(b.updates[0]?.created_at || 0).getTime();
      return bTime - aTime;
    });

    const visibleGroups = groupedEvidence.slice(0, updateListLimit);
    const shouldShowEvidence = updateRecordsVisible;

    return (
      <div className="panel-card evidence-review-panel">
        <div className="evidence-review-hero">
          <div className="evidence-review-heading">
            <span className="module-kicker">Field Operations</span>
            <h2>FE Updates / Photos</h2>
            <p>Review field comments, GPS points, uploaded photos, and task evidence.</p>
          </div>
          <div className="evidence-review-pill">
            <span>Evidence Records</span>
            <b>{filteredUpdates.length}</b>
          </div>
        </div>

        <div className="evidence-summary-grid">
          <div className="evidence-summary-card">
            <span>Total Updates</span>
            <b>{evidenceTotals.total}</b>
          </div>
          <div className="evidence-summary-card photo">
            <span>Photos</span>
            <b>{evidenceTotals.photo}</b>
          </div>
          <div className="evidence-summary-card comment">
            <span>Comments</span>
            <b>{evidenceTotals.comment}</b>
          </div>
          <div className="evidence-summary-card gps">
            <span>GPS Points</span>
            <b>{evidenceTotals.gps}</b>
          </div>
          <div className="evidence-summary-card">
            <span>Tasks With Evidence</span>
            <b>{evidenceTotals.taskIds.size}</b>
          </div>
        </div>

        <div className="evidence-toolbar">
          <input
            value={updateSearch}
            onChange={(e) => setUpdateSearch(e.target.value)}
            placeholder="Search task, grid, market, FE, or comment..."
          />

          <select
            value={updateTypeFilter}
            onChange={(e) => setUpdateTypeFilter(e.target.value)}
          >
            <option value="all">All update types</option>
            <option value="photo">Photos only</option>
            <option value="comment">Comments only</option>
            <option value="gps">GPS points only</option>
          </select>

          <select
            value={updateListLimit}
            onChange={(e) => setUpdateListLimit(Number(e.target.value))}
          >
            <option value={10}>10 task groups</option>
            <option value={25}>25 task groups</option>
            <option value={50}>50 task groups</option>
            <option value={100}>100 task groups</option>
          </select>

          <button
            type="button"
            className="secondary-action-btn evidence-toggle-btn"
            onClick={() => setUpdateRecordsVisible((current) => !current)}
          >
            {updateRecordsVisible ? "Hide Evidence" : "Show Evidence"}
          </button>
        </div>

        <div className="evidence-records-shell">
          <div className="evidence-records-head">
            <div>
              <h3>Task Evidence Records</h3>
              <p>
                Updates are grouped by task so photos, comments, and GPS points do not float without ownership.
              </p>
            </div>
            <span>
              Showing {shouldShowEvidence ? Math.min(visibleGroups.length, groupedEvidence.length) : 0} of {groupedEvidence.length} task group(s)
            </span>
          </div>

          {filteredUpdates.length === 0 ? (
            <div className="evidence-empty-note">
              No FE updates found for the selected project, market, FE, status, date, or evidence filter.
            </div>
          ) : !shouldShowEvidence ? (
            <div className="evidence-hidden-note">
              <b>Evidence records are hidden to keep the page clean.</b>
              <span>
                {filteredUpdates.length} update(s) are available across {groupedEvidence.length} task group(s). Use search/type filters, then click Show Evidence when needed.
              </span>
            </div>
          ) : (
            <div className="evidence-task-list">
              {visibleGroups.map((group) => {
                const latestUpdates = group.updates.slice(0, 3);
                const photoUpdates = group.updates.filter((update) => getUpdatePhotoUrl(update)).slice(0, 4);
                const hiddenCount = Math.max(group.updates.length - latestUpdates.length, 0);

                return (
                  <div key={group.key} className={`evidence-task-card ${group.task ? "" : "unlinked"}`}>
                    <div className="evidence-task-topline">
                      <div>
                        <h3>{getTaskDisplayName(group.task)}</h3>
                        <p>{getTaskMetaLine(group.task)}</p>
                      </div>
                      <div className="evidence-task-badges">
                        <span className="status-pill">{group.task ? statusLabel(group.task.status) : "Unlinked"}</span>
                        <span>{group.updates.length} update(s)</span>
                      </div>
                    </div>

                    <div className="evidence-update-list">
                      {latestUpdates.map((update) => {
                        const photoUrl = getUpdatePhotoUrl(update);

                        return (
                          <div key={update.id} className={`evidence-update-row ${update.kind}`}>
                            <div className="evidence-update-kind">
                              <b>{updateKindLabel(update.kind)}</b>
                              <span>{new Date(update.created_at).toLocaleString()}</span>
                            </div>

                            <div className="evidence-update-body">
                              <p>{getUpdateText(update)}</p>

                              <div className="evidence-update-actions">
                                {update.latitude && update.longitude && (
                                  <a
                                    href={`https://www.google.com/maps?q=${update.latitude},${update.longitude}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open GPS Location
                                  </a>
                                )}

                                {photoUrl && (
                                  <button
                                    type="button"
                                    onClick={() => window.open(photoUrl, "_blank")}
                                  >
                                    View Photo
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {photoUpdates.length > 0 && (
                      <div className="evidence-photo-strip">
                        {photoUpdates.map((update) => {
                          const photoUrl = getUpdatePhotoUrl(update);
                          return (
                            <button
                              type="button"
                              key={`photo-${update.id}`}
                              className="evidence-photo-thumb"
                              onClick={() => window.open(photoUrl, "_blank")}
                            >
                              <img src={photoUrl} alt="FE upload evidence" />
                              <span>{new Date(update.created_at).toLocaleDateString()}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {hiddenCount > 0 && (
                      <div className="evidence-more-note">
                        {hiddenCount} older update(s) hidden for this task group. Use the task timeline for the full execution trail.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
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

    if (activeView === "userManagement") return <UserManagement />;
    if (activeView === "createProject") return renderCreateProject();

    if (activeView === "assignTask") {
      return (
        <div className="assign-task-polish-shell">
          <AssignTask
            projects={projects}
            fieldEngineers={fieldEngineers}
            onTaskCreated={fetchAll}
            setActiveView={setActiveView}
            setMessage={setMessage}
          />
        </div>
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

  const pagesWithPageFilters = new Set([
    "overview",
    "taskTracking",
    "liveMap",
    "timeline",
    "updates",
    "qc",
    "reports",
  ]);

  const showPageFilters = pagesWithPageFilters.has(activeView);

  const pageFilterTitles = {
    overview: "Dashboard Filters",
    taskTracking: "Task Tracking Filters",
    liveMap: "Live Map Filters",
    timeline: "Timeline Filters",
    updates: "FE Updates Filters",
    qc: "QC Review Filters",
    reports: "Report Filters",
  };

  const pageFilterTitle = pageFilterTitles[activeView] || "Page Filters";

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

        {showPageFilters && (
          <section className={`filters-card ${activeView === "overview" ? "global-filter-card" : "module-filter-card"}`}>
            <div className="filter-title">
              <h3>{pageFilterTitle} <span className="date-filter-pill">{getDashboardDateLabel(filters)}</span></h3>
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
        )}

        {activeView === "overview" && (
          <div className="stat-band stat-band-executive">
            <div className="stat-band-title">
              <span>Executive Summary</span>
              <b>Full operational snapshot</b>
            </div>

            <section className="stats-grid stats-grid-executive">
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
          </div>
        )}

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



  /* Create Project cosmetic polish */
  .create-project-page {
    width: 100% !important;
    display: grid !important;
    gap: 14px !important;
  }

  .create-project-hero,
  .create-project-card {
    width: 100% !important;
    border: 1px solid rgba(96, 165, 250, 0.24) !important;
    border-radius: 18px !important;
    background: linear-gradient(180deg, rgba(15, 23, 42, 0.72), rgba(15, 23, 42, 0.42)) !important;
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.16) !important;
    box-sizing: border-box !important;
  }

  .create-project-hero {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) auto !important;
    gap: 18px !important;
    align-items: center !important;
    padding: 18px 20px !important;
  }

  .section-kicker {
    display: inline-flex !important;
    align-items: center !important;
    gap: 6px !important;
    margin-bottom: 6px !important;
    color: #60a5fa !important;
    font-size: 11px !important;
    font-weight: 950 !important;
    letter-spacing: 0.12em !important;
    text-transform: uppercase !important;
  }

  .create-project-hero h2 {
    margin: 0 0 5px !important;
    color: #f8fbff !important;
    font-size: clamp(22px, 1.8vw, 30px) !important;
    line-height: 1.1 !important;
  }

  .create-project-hero p,
  .create-project-card-header p {
    margin: 0 !important;
    color: #bfd0e8 !important;
    font-size: 13px !important;
    line-height: 1.45 !important;
    font-weight: 700 !important;
  }

  .create-project-flow {
    display: inline-flex !important;
    align-items: center !important;
    gap: 8px !important;
    flex-wrap: wrap !important;
    padding: 9px 12px !important;
    border: 1px solid rgba(96, 165, 250, 0.24) !important;
    border-radius: 999px !important;
    background: rgba(37, 99, 235, 0.12) !important;
    color: #dbeafe !important;
    white-space: nowrap !important;
  }

  .create-project-flow span,
  .create-project-flow b {
    font-size: 12px !important;
    font-weight: 950 !important;
  }

  .create-project-card {
    padding: 18px 20px 20px !important;
  }

  .create-project-card-header {
    display: flex !important;
    justify-content: space-between !important;
    align-items: flex-start !important;
    gap: 16px !important;
    padding-bottom: 14px !important;
    margin-bottom: 16px !important;
    border-bottom: 1px solid rgba(96, 165, 250, 0.18) !important;
  }

  .create-project-card-header h3 {
    margin: 0 0 4px !important;
    color: #f8fbff !important;
    font-size: 18px !important;
    line-height: 1.15 !important;
  }

  .required-pill {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    flex: 0 0 auto !important;
    padding: 7px 10px !important;
    border-radius: 999px !important;
    border: 1px solid rgba(34, 197, 94, 0.30) !important;
    background: rgba(34, 197, 94, 0.10) !important;
    color: #bbf7d0 !important;
    font-size: 11px !important;
    font-weight: 950 !important;
  }

  .create-project-grid {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(220px, 1fr)) !important;
    gap: 14px !important;
  }

  .field-block {
    display: grid !important;
    gap: 7px !important;
    margin: 0 !important;
  }

  .field-block span {
    color: #dbeafe !important;
    font-size: 12px !important;
    font-weight: 950 !important;
    letter-spacing: 0.02em !important;
  }

  .field-block input {
    min-height: 42px !important;
    height: 42px !important;
    border-radius: 12px !important;
    padding: 10px 12px !important;
    background: rgba(2, 6, 23, 0.44) !important;
    border: 1px solid rgba(96, 165, 250, 0.26) !important;
    color: #f8fbff !important;
    font-size: 13px !important;
    font-weight: 750 !important;
  }

  .field-block input::placeholder {
    color: #7f93b5 !important;
    opacity: 1 !important;
  }

  .field-block input:focus {
    outline: none !important;
    border-color: rgba(59, 130, 246, 0.75) !important;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16) !important;
  }

  .create-project-actions {
    display: flex !important;
    justify-content: flex-end !important;
    align-items: center !important;
    gap: 10px !important;
    margin-top: 18px !important;
  }

  .primary-action-btn,
  .secondary-action-btn {
    min-height: 40px !important;
    border-radius: 12px !important;
    padding: 10px 18px !important;
    font-weight: 950 !important;
    cursor: pointer !important;
    border: 1px solid transparent !important;
  }

  .primary-action-btn {
    min-width: 180px !important;
    color: #ffffff !important;
    background: linear-gradient(90deg, #2563eb, #06b6d4) !important;
    box-shadow: 0 12px 26px rgba(37, 99, 235, 0.22) !important;
  }

  .secondary-action-btn {
    color: #bfdbfe !important;
    background: rgba(15, 23, 42, 0.44) !important;
    border-color: rgba(96, 165, 250, 0.26) !important;
  }

  .primary-action-btn:hover,
  .secondary-action-btn:hover {
    transform: translateY(-1px) !important;
  }

  .theme-day .create-project-hero,
  .theme-day .create-project-card {
    background: #ffffff !important;
    border-color: rgba(30, 64, 175, 0.16) !important;
    box-shadow: 0 16px 36px rgba(15, 23, 42, 0.07) !important;
  }

  .theme-day .section-kicker {
    color: #2563eb !important;
  }

  .theme-day .create-project-hero h2,
  .theme-day .create-project-card-header h3 {
    color: #0f172a !important;
  }

  .theme-day .create-project-hero p,
  .theme-day .create-project-card-header p {
    color: #475569 !important;
  }

  .theme-day .create-project-flow {
    background: #eff6ff !important;
    border-color: rgba(37, 99, 235, 0.20) !important;
    color: #1e40af !important;
  }

  .theme-day .create-project-card-header {
    border-bottom-color: rgba(30, 64, 175, 0.14) !important;
  }

  .theme-day .required-pill {
    background: #ecfdf5 !important;
    border-color: rgba(34, 197, 94, 0.24) !important;
    color: #166534 !important;
  }

  .theme-day .field-block span {
    color: #17324d !important;
  }

  .theme-day .field-block input {
    background: #f8fbff !important;
    border-color: rgba(30, 64, 175, 0.22) !important;
    color: #0f172a !important;
  }

  .theme-day .field-block input::placeholder {
    color: #64748b !important;
  }

  .theme-day .secondary-action-btn {
    color: #1e40af !important;
    background: #eff6ff !important;
    border-color: rgba(37, 99, 235, 0.22) !important;
  }

  @media (max-width: 900px) {
    .create-project-hero,
    .create-project-card-header {
      grid-template-columns: 1fr !important;
      display: grid !important;
    }

    .create-project-flow {
      justify-content: center !important;
      white-space: normal !important;
    }

    .create-project-grid {
      grid-template-columns: 1fr !important;
    }

    .create-project-actions {
      justify-content: stretch !important;
      flex-direction: column-reverse !important;
    }

    .primary-action-btn,
    .secondary-action-btn {
      width: 100% !important;
    }
  }


  /* Create Project V18: align hero copy to the left like other module headers */
  .create-project-hero {
    text-align: left !important;
    justify-items: stretch !important;
  }

  .create-project-hero > div:first-child {
    text-align: left !important;
    justify-self: start !important;
    width: 100% !important;
  }

  .create-project-hero .section-kicker,
  .create-project-hero h2,
  .create-project-hero p {
    text-align: left !important;
    justify-content: flex-start !important;
  }

  .create-project-hero p {
    max-width: 720px !important;
  }

  .create-project-flow {
    justify-self: end !important;
  }

  @media (max-width: 900px) {
    .create-project-flow {
      justify-self: start !important;
      justify-content: flex-start !important;
    }
  }


  /* Create Project V20: compact enough for 100% zoom without losing polish */
  .create-project-page {
    gap: 10px !important;
  }

  .create-project-hero {
    min-height: unset !important;
    padding: 13px 18px !important;
    border-radius: 16px !important;
  }

  .create-project-hero h2 {
    font-size: clamp(20px, 1.45vw, 26px) !important;
    margin-bottom: 3px !important;
  }

  .create-project-hero p {
    font-size: 12px !important;
    line-height: 1.28 !important;
  }

  .create-project-flow {
    padding: 7px 11px !important;
  }

  .create-project-card {
    padding: 13px 18px 14px !important;
    border-radius: 16px !important;
  }

  .create-project-card-header {
    padding-bottom: 9px !important;
    margin-bottom: 10px !important;
    align-items: center !important;
  }

  .create-project-card-header h3 {
    font-size: 17px !important;
    margin-bottom: 2px !important;
  }

  .create-project-card-header p {
    font-size: 12px !important;
    line-height: 1.25 !important;
  }

  .required-pill {
    padding: 6px 9px !important;
    font-size: 10px !important;
  }

  .create-project-grid {
    gap: 9px 12px !important;
  }

  .field-block {
    gap: 4px !important;
  }

  .field-block span {
    font-size: 11px !important;
  }

  .field-block input {
    min-height: 36px !important;
    height: 36px !important;
    border-radius: 10px !important;
    padding: 8px 11px !important;
    font-size: 12px !important;
  }

  .create-project-actions {
    margin-top: 12px !important;
    gap: 8px !important;
  }

  .primary-action-btn,
  .secondary-action-btn {
    min-height: 36px !important;
    border-radius: 10px !important;
    padding: 8px 16px !important;
  }

  /* Assign Task V20: align with the polished page language */
  .assign-task-polish-shell {
    width: 100% !important;
  }

  .assign-task-polish-shell > .panel-card,
  .assign-task-polish-shell .panel-card {
    width: 100% !important;
    border-radius: 16px !important;
    padding: 14px 16px !important;
    border: 1px solid rgba(96, 165, 250, 0.24) !important;
    background: linear-gradient(180deg, rgba(15, 23, 42, 0.72), rgba(15, 23, 42, 0.42)) !important;
    box-shadow: 0 14px 34px rgba(0,0,0,.14) !important;
  }

  .theme-day .assign-task-polish-shell > .panel-card,
  .theme-day .assign-task-polish-shell .panel-card {
    background: #ffffff !important;
    border-color: rgba(30, 64, 175, 0.16) !important;
    box-shadow: 0 14px 30px rgba(15, 23, 42, 0.06) !important;
  }

  .assign-task-polish-shell h2 {
    text-align: left !important;
    margin: 0 0 4px !important;
    color: #f8fbff !important;
    font-size: clamp(20px, 1.45vw, 26px) !important;
    line-height: 1.1 !important;
  }

  .theme-day .assign-task-polish-shell h2 {
    color: #0f172a !important;
  }

  .assign-task-polish-shell p {
    text-align: left !important;
    margin-top: 0 !important;
    margin-bottom: 10px !important;
    color: #bfd0e8 !important;
    font-size: 12px !important;
    font-weight: 700 !important;
  }

  .theme-day .assign-task-polish-shell p {
    color: #475569 !important;
  }

  .assign-task-polish-shell label,
  .assign-task-polish-shell h3 {
    text-align: left !important;
    justify-content: flex-start !important;
    color: #dbeafe !important;
    font-size: 12px !important;
    font-weight: 950 !important;
    letter-spacing: .01em !important;
  }

  .theme-day .assign-task-polish-shell label,
  .theme-day .assign-task-polish-shell h3 {
    color: #17324d !important;
  }

  .assign-task-polish-shell input,
  .assign-task-polish-shell select,
  .assign-task-polish-shell textarea {
    min-height: 36px !important;
    border-radius: 10px !important;
    font-size: 12px !important;
    font-weight: 750 !important;
  }

  .assign-task-polish-shell textarea {
    min-height: 74px !important;
  }

  .assign-task-polish-shell button[type=submit],
  .assign-task-polish-shell .primary-action-btn {
    min-height: 38px !important;
    border-radius: 10px !important;
    font-weight: 950 !important;
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


  /* Dashboard Overview V19: left-align executive and map headers */
  .dashboard-overview-stack .dashboard-exec-header {
    grid-template-columns: minmax(0, 1fr) 150px !important;
    align-items: center !important;
    text-align: left !important;
  }

  .dashboard-overview-stack .dashboard-exec-header > div:first-child {
    text-align: left !important;
    justify-self: stretch !important;
    align-self: center !important;
    padding-left: 4px !important;
  }

  .dashboard-overview-stack .dashboard-exec-header p,
  .dashboard-overview-stack .dashboard-exec-header h2,
  .dashboard-overview-stack .dashboard-exec-header span {
    text-align: left !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
  }

  .dashboard-overview-stack .dashboard-exec-header p {
    display: block !important;
  }

  .dashboard-overview-stack .panel-card .panel-header,
  .dashboard-overview-stack .map-panel-header {
    display: flex !important;
    justify-content: flex-start !important;
    align-items: flex-start !important;
    text-align: left !important;
  }

  .dashboard-overview-stack .panel-card .panel-header > div,
  .dashboard-overview-stack .map-panel-header > div {
    text-align: left !important;
    width: 100% !important;
  }

  .dashboard-overview-stack .panel-card .panel-header h2,
  .dashboard-overview-stack .panel-card .panel-header p,
  .dashboard-overview-stack .map-panel-header h2,
  .dashboard-overview-stack .map-panel-header p {
    text-align: left !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
  }

  @media (max-width: 760px) {
    .dashboard-overview-stack .dashboard-exec-header {
      grid-template-columns: 1fr !important;
    }
  }


  /* Task Tracking V21: hidden records + compact operations list */
  .task-tracking-panel {
    padding: 14px 16px 16px !important;
  }

  .task-tracking-header {
    align-items: center !important;
    border-bottom: 1px solid rgba(148, 163, 184, 0.20) !important;
    padding-bottom: 10px !important;
    margin-bottom: 12px !important;
  }

  .module-kicker {
    display: block !important;
    margin-bottom: 5px !important;
    color: #60a5fa !important;
    font-size: 11px !important;
    font-weight: 950 !important;
    letter-spacing: 0.16em !important;
    text-transform: uppercase !important;
  }

  .task-tracking-header h2,
  .task-tracking-header p {
    text-align: left !important;
  }

  .task-tracking-header-actions {
    display: flex !important;
    justify-content: flex-end !important;
    align-items: center !important;
    min-width: max-content !important;
  }

  .task-count-pill {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    min-height: 34px !important;
    padding: 8px 14px !important;
    border-radius: 999px !important;
    border: 1px solid rgba(96, 165, 250, 0.35) !important;
    background: rgba(37, 99, 235, 0.12) !important;
    color: #bfdbfe !important;
    font-size: 12px !important;
    font-weight: 950 !important;
    white-space: nowrap !important;
  }

  .task-tracking-summary-grid {
    display: grid !important;
    grid-template-columns: repeat(5, minmax(120px, 1fr)) !important;
    gap: 10px !important;
    margin: 0 0 12px !important;
  }

  .task-tracking-summary-card {
    min-height: 74px !important;
    border-radius: 14px !important;
    border: 1px solid rgba(96, 165, 250, 0.26) !important;
    background: rgba(15, 23, 42, 0.42) !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 5px !important;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.04) !important;
  }

  .task-tracking-summary-card span {
    color: #93c5fd !important;
    font-size: 11px !important;
    font-weight: 850 !important;
    text-align: center !important;
  }

  .task-tracking-summary-card b {
    color: #e8f1ff !important;
    font-size: 25px !important;
    line-height: 1 !important;
    font-weight: 950 !important;
  }

  .task-tracking-summary-card.issue-summary b {
    color: #f59e0b !important;
  }

  .task-records-shell {
    border: 1px solid rgba(96, 165, 250, 0.22) !important;
    background: rgba(15, 23, 42, 0.28) !important;
    border-radius: 16px !important;
    padding: 12px !important;
  }

  .task-records-head {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 14px !important;
    padding-bottom: 10px !important;
    border-bottom: 1px solid rgba(148, 163, 184, 0.18) !important;
    margin-bottom: 10px !important;
  }

  .task-records-head h3 {
    margin: 0 0 4px !important;
    color: #e8f1ff !important;
    font-size: 18px !important;
    line-height: 1.1 !important;
    text-align: left !important;
  }

  .task-records-head p {
    margin: 0 !important;
    color: #93c5fd !important;
    font-size: 12px !important;
    line-height: 1.25 !important;
    text-align: left !important;
  }

  .task-records-actions {
    display: flex !important;
    align-items: flex-end !important;
    justify-content: flex-end !important;
    gap: 10px !important;
    flex-wrap: wrap !important;
  }

  .task-records-actions label {
    display: flex !important;
    flex-direction: column !important;
    gap: 4px !important;
    min-width: 125px !important;
  }

  .task-records-actions label span {
    color: #93c5fd !important;
    font-size: 10px !important;
    font-weight: 900 !important;
    letter-spacing: 0.08em !important;
    text-transform: uppercase !important;
  }

  .task-records-actions select {
    height: 34px !important;
    border-radius: 10px !important;
    border: 1px solid rgba(96, 165, 250, 0.35) !important;
    background: rgba(2, 6, 23, 0.35) !important;
    color: #e8f1ff !important;
    padding: 6px 10px !important;
    font-size: 12px !important;
    font-weight: 800 !important;
  }

  .task-records-toggle {
    min-height: 34px !important;
    padding: 7px 12px !important;
    white-space: nowrap !important;
  }

  .task-records-hidden-note,
  .task-records-empty {
    min-height: 72px !important;
    display: flex !important;
    flex-direction: column !important;
    justify-content: center !important;
    align-items: center !important;
    gap: 7px !important;
    text-align: center !important;
    border-radius: 14px !important;
    border: 1px dashed rgba(96, 165, 250, 0.34) !important;
    background: rgba(2, 6, 23, 0.20) !important;
    color: #bfdbfe !important;
    padding: 12px !important;
  }

  .task-records-hidden-note b {
    color: #e8f1ff !important;
    font-size: 14px !important;
  }

  .task-records-hidden-note span,
  .task-records-empty {
    color: #93c5fd !important;
    font-size: 12px !important;
    line-height: 1.35 !important;
  }

  .task-records-showing-line {
    display: flex !important;
    justify-content: flex-end !important;
    margin: 0 0 8px !important;
    color: #93c5fd !important;
    font-size: 11px !important;
    font-weight: 900 !important;
  }

  .compact-task-list {
    display: grid !important;
    gap: 10px !important;
  }

  .compact-task-card {
    border-radius: 16px !important;
    padding: 12px 14px !important;
    background: rgba(2, 6, 23, 0.32) !important;
    border: 1px solid rgba(96, 165, 250, 0.24) !important;
  }

  .compact-task-card-top {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) auto !important;
    align-items: center !important;
    gap: 14px !important;
  }

  .compact-task-main h3 {
    margin: 0 0 5px !important;
    color: #e8f1ff !important;
    font-size: 18px !important;
    line-height: 1.1 !important;
    text-align: left !important;
  }

  .compact-task-main p {
    margin: 0 !important;
    color: #93c5fd !important;
    font-size: 13px !important;
    line-height: 1.25 !important;
    text-align: left !important;
  }

  .compact-task-actions {
    display: flex !important;
    gap: 8px !important;
    align-items: center !important;
    justify-content: flex-end !important;
    flex-wrap: wrap !important;
  }

  body.bd-theme-day .task-count-pill,
  .theme-day .task-count-pill {
    background: #eef6ff !important;
    border-color: #bfdbfe !important;
    color: #1d4ed8 !important;
  }

  body.bd-theme-day .task-tracking-summary-card,
  .theme-day .task-tracking-summary-card {
    background: linear-gradient(135deg, #ffffff, #f8fbff) !important;
    border-color: #bfdbfe !important;
    box-shadow: 0 10px 20px rgba(15, 23, 42, 0.045) !important;
  }

  body.bd-theme-day .task-tracking-summary-card span,
  .theme-day .task-tracking-summary-card span,
  body.bd-theme-day .task-records-head p,
  .theme-day .task-records-head p,
  body.bd-theme-day .task-records-actions label span,
  .theme-day .task-records-actions label span,
  body.bd-theme-day .task-records-showing-line,
  .theme-day .task-records-showing-line {
    color: #2563eb !important;
  }

  body.bd-theme-day .task-tracking-summary-card b,
  .theme-day .task-tracking-summary-card b,
  body.bd-theme-day .task-records-head h3,
  .theme-day .task-records-head h3,
  body.bd-theme-day .compact-task-main h3,
  .theme-day .compact-task-main h3 {
    color: #0f172a !important;
  }

  body.bd-theme-day .task-records-shell,
  .theme-day .task-records-shell {
    background: #ffffff !important;
    border-color: #bfdbfe !important;
  }

  body.bd-theme-day .task-records-actions select,
  .theme-day .task-records-actions select {
    background: #ffffff !important;
    color: #0f172a !important;
    border-color: #bfdbfe !important;
  }

  body.bd-theme-day .task-records-hidden-note,
  .theme-day .task-records-hidden-note,
  body.bd-theme-day .task-records-empty,
  .theme-day .task-records-empty {
    background: #f8fbff !important;
    border-color: #bfdbfe !important;
    color: #1d4ed8 !important;
  }

  body.bd-theme-day .task-records-hidden-note b,
  .theme-day .task-records-hidden-note b {
    color: #0f172a !important;
  }

  body.bd-theme-day .task-records-hidden-note span,
  .theme-day .task-records-hidden-note span {
    color: #334155 !important;
  }

  body.bd-theme-day .compact-task-card,
  .theme-day .compact-task-card {
    background: #ffffff !important;
    border-color: #bfdbfe !important;
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.045) !important;
  }

  body.bd-theme-day .compact-task-main p,
  .theme-day .compact-task-main p {
    color: #334155 !important;
  }

  @media (max-width: 960px) {
    .task-tracking-summary-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    }

    .task-records-head,
    .compact-task-card-top {
      grid-template-columns: 1fr !important;
      display: grid !important;
    }

    .task-records-actions,
    .compact-task-actions {
      justify-content: flex-start !important;
    }
  }


  /* Task Timeline polish V23 */
  .bd-timeline-v23 {
    display: grid !important;
    gap: 12px !important;
  }

  .bd-timeline-hero {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 16px !important;
    padding: 4px 2px 12px !important;
    border-bottom: 1px solid rgba(148, 163, 184, 0.22) !important;
  }

  .bd-timeline-heading {
    text-align: left !important;
    min-width: 0 !important;
  }

  .bd-timeline-heading h2 {
    margin: 2px 0 3px !important;
    text-align: left !important;
    font-size: clamp(22px, 1.55vw, 28px) !important;
    line-height: 1.05 !important;
    color: #f8fbff !important;
  }

  .bd-timeline-heading p {
    margin: 0 !important;
    text-align: left !important;
    color: #bfdbfe !important;
    font-size: 13px !important;
    font-weight: 750 !important;
    line-height: 1.35 !important;
  }

  .bd-timeline-flow-pill {
    flex: 0 0 auto !important;
    border: 1px solid rgba(96, 165, 250, 0.35) !important;
    border-radius: 999px !important;
    padding: 11px 15px !important;
    color: #dbeafe !important;
    background: rgba(37, 99, 235, 0.12) !important;
    font-size: 12px !important;
    font-weight: 950 !important;
    white-space: nowrap !important;
  }

  .bd-timeline-summary-grid {
    display: grid !important;
    grid-template-columns: repeat(6, minmax(110px, 1fr)) !important;
    gap: 10px !important;
  }

  .bd-timeline-summary-card {
    min-height: 64px !important;
    border: 1px solid rgba(96, 165, 250, 0.22) !important;
    border-radius: 14px !important;
    background: rgba(15, 23, 42, 0.28) !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 10px 12px !important;
  }

  .bd-timeline-summary-card span {
    color: #93c5fd !important;
    font-size: 11px !important;
    font-weight: 900 !important;
    text-align: center !important;
  }

  .bd-timeline-summary-card b {
    color: #eaf2ff !important;
    font-size: 24px !important;
    line-height: 1 !important;
    margin-top: 4px !important;
  }

  .bd-timeline-summary-card.warn b {
    color: #f59e0b !important;
  }

  .bd-timeline-records-head {
    display: flex !important;
    align-items: flex-end !important;
    justify-content: space-between !important;
    gap: 12px !important;
    padding: 2px 2px 10px !important;
    border-bottom: 1px solid rgba(148, 163, 184, 0.18) !important;
  }

  .bd-timeline-records-head h3 {
    margin: 0 0 3px !important;
    color: #f8fbff !important;
    font-size: 18px !important;
    text-align: left !important;
  }

  .bd-timeline-records-head p {
    margin: 0 !important;
    color: #9fb7d6 !important;
    font-size: 12px !important;
    font-weight: 750 !important;
    text-align: left !important;
  }

  .bd-timeline-records-head > span {
    border: 1px solid rgba(96, 165, 250, 0.28) !important;
    background: rgba(37, 99, 235, 0.12) !important;
    color: #bfdbfe !important;
    border-radius: 999px !important;
    padding: 8px 12px !important;
    font-size: 12px !important;
    font-weight: 950 !important;
    white-space: nowrap !important;
  }

  .timeline-task-list {
    display: grid !important;
    gap: 10px !important;
  }

  .bd-timeline-task-card {
    border: 1px solid rgba(96, 165, 250, 0.22) !important;
    border-radius: 16px !important;
    background: rgba(15, 23, 42, 0.18) !important;
    padding: 12px 14px !important;
    box-shadow: none !important;
  }

  .bd-timeline-task-header {
    display: flex !important;
    align-items: flex-start !important;
    justify-content: space-between !important;
    gap: 14px !important;
    margin-bottom: 10px !important;
    text-align: left !important;
  }

  .bd-timeline-task-header h3 {
    margin: 0 0 4px !important;
    color: #f8fbff !important;
    font-size: 17px !important;
    line-height: 1.15 !important;
    text-align: left !important;
  }

  .bd-timeline-task-header p {
    margin: 0 !important;
    color: #bfdbfe !important;
    font-size: 13px !important;
    font-weight: 750 !important;
    text-align: left !important;
  }

  .bd-timeline-task-actions {
    display: flex !important;
    align-items: center !important;
    justify-content: flex-end !important;
    gap: 8px !important;
    flex-wrap: wrap !important;
  }

  .bd-timeline-toggle-btn {
    border-radius: 999px !important;
    padding: 8px 12px !important;
    font-size: 11px !important;
    font-weight: 950 !important;
  }

  .bd-timeline-collapsed-note {
    margin: 2px 0 10px !important;
    padding: 8px 10px !important;
    border: 1px dashed rgba(96, 165, 250, 0.32) !important;
    border-radius: 12px !important;
    background: rgba(37, 99, 235, 0.08) !important;
    color: #bfdbfe !important;
    font-size: 12px !important;
    font-weight: 800 !important;
    text-align: left !important;
  }

  .timeline-line-wrap {
    display: grid !important;
    gap: 10px !important;
    position: relative !important;
  }

  .timeline-row {
    display: grid !important;
    grid-template-columns: 42px minmax(0, 1fr) !important;
    gap: 10px !important;
    align-items: stretch !important;
    position: relative !important;
  }

  .timeline-row::before {
    content: "" !important;
    position: absolute !important;
    left: 20px !important;
    top: 42px !important;
    bottom: -10px !important;
    width: 2px !important;
    background: rgba(59, 130, 246, 0.25) !important;
  }

  .timeline-row:last-child::before {
    display: none !important;
  }

  .timeline-icon {
    width: 30px !important;
    height: 30px !important;
    margin: 2px auto 0 !important;
    border-radius: 999px !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    background: rgba(15, 23, 42, 0.80) !important;
    border: 1px solid rgba(96, 165, 250, 0.40) !important;
    color: #eaf2ff !important;
    font-size: 13px !important;
    box-shadow: 0 8px 16px rgba(0,0,0,0.12) !important;
    z-index: 1 !important;
  }

  .timeline-icon.assigned { border-color: rgba(250, 204, 21, 0.58) !important; }
  .timeline-icon.started { border-color: rgba(34, 197, 94, 0.58) !important; }
  .timeline-icon.gps { border-color: rgba(56, 189, 248, 0.58) !important; }
  .timeline-icon.comment { border-color: rgba(168, 85, 247, 0.58) !important; }
  .timeline-icon.photo { border-color: rgba(236, 72, 153, 0.58) !important; }
  .timeline-icon.completed { border-color: rgba(34, 197, 94, 0.72) !important; }
  .timeline-icon.late { border-color: rgba(245, 158, 11, 0.72) !important; }

  .timeline-event-card {
    min-height: 58px !important;
    border: 1px solid rgba(96, 165, 250, 0.22) !important;
    border-radius: 13px !important;
    background: rgba(15, 23, 42, 0.42) !important;
    padding: 11px 12px !important;
    color: #eaf2ff !important;
  }

  .timeline-event-top {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 12px !important;
    margin-bottom: 6px !important;
  }

  .timeline-event-top strong {
    color: #f8fbff !important;
    font-size: 13px !important;
  }

  .timeline-event-top span {
    color: #93c5fd !important;
    font-size: 11px !important;
    font-weight: 850 !important;
    white-space: nowrap !important;
  }

  .timeline-event-card p {
    margin: 0 !important;
    color: #dbeafe !important;
    font-size: 13px !important;
    font-weight: 700 !important;
    line-height: 1.35 !important;
  }

  .timeline-link {
    margin-top: 8px !important;
    border: 1px solid rgba(56, 189, 248, 0.35) !important;
    background: rgba(14, 165, 233, 0.14) !important;
    color: #bae6fd !important;
    border-radius: 999px !important;
    padding: 7px 10px !important;
    font-size: 11px !important;
    font-weight: 950 !important;
    cursor: pointer !important;
  }

  .timeline-photo {
    display: block !important;
    max-width: 260px !important;
    max-height: 180px !important;
    object-fit: cover !important;
    border-radius: 12px !important;
    margin-top: 10px !important;
    border: 1px solid rgba(96, 165, 250, 0.25) !important;
    cursor: pointer !important;
  }

  .bd-timeline-empty {
    border: 1px dashed rgba(96, 165, 250, 0.30) !important;
    border-radius: 14px !important;
    padding: 14px !important;
    color: #bfdbfe !important;
    background: rgba(37, 99, 235, 0.08) !important;
    font-weight: 850 !important;
    text-align: left !important;
  }

  .bd-timeline-empty.small {
    padding: 10px 12px !important;
    font-size: 12px !important;
  }

  .theme-day .bd-timeline-heading h2,
  .theme-day .bd-timeline-records-head h3,
  .theme-day .bd-timeline-task-header h3 {
    color: #0f172a !important;
  }

  .theme-day .bd-timeline-heading p,
  .theme-day .bd-timeline-records-head p,
  .theme-day .bd-timeline-task-header p {
    color: #334155 !important;
  }

  .theme-day .bd-timeline-flow-pill,
  .theme-day .bd-timeline-records-head > span {
    color: #1d4ed8 !important;
    background: #eff6ff !important;
    border-color: rgba(37, 99, 235, 0.24) !important;
  }

  .theme-day .bd-timeline-summary-card,
  .theme-day .bd-timeline-task-card,
  .theme-day .timeline-event-card {
    background: #f8fbff !important;
    border-color: rgba(30, 64, 175, 0.18) !important;
    color: #0f172a !important;
    box-shadow: none !important;
  }

  .theme-day .bd-timeline-summary-card span,
  .theme-day .timeline-event-top span {
    color: #2563eb !important;
  }

  .theme-day .bd-timeline-summary-card b,
  .theme-day .timeline-event-top strong,
  .theme-day .timeline-event-card p {
    color: #0f172a !important;
  }

  .theme-day .bd-timeline-summary-card.warn b {
    color: #d97706 !important;
  }

  .theme-day .timeline-icon {
    background: #ffffff !important;
    color: #0f172a !important;
    border-color: rgba(37, 99, 235, 0.30) !important;
    box-shadow: 0 6px 14px rgba(15, 23, 42, 0.08) !important;
  }

  .theme-day .timeline-row::before {
    background: rgba(37, 99, 235, 0.18) !important;
  }

  .theme-day .bd-timeline-collapsed-note,
  .theme-day .bd-timeline-empty {
    background: #eff6ff !important;
    border-color: rgba(37, 99, 235, 0.24) !important;
    color: #1e3a8a !important;
  }

  .theme-day .timeline-link {
    background: #eff6ff !important;
    border-color: rgba(37, 99, 235, 0.26) !important;
    color: #1d4ed8 !important;
  }

  @media (max-width: 1180px) {
    .bd-timeline-summary-grid {
      grid-template-columns: repeat(3, minmax(120px, 1fr)) !important;
    }
  }

  @media (max-width: 760px) {
    .bd-timeline-hero,
    .bd-timeline-task-header,
    .bd-timeline-records-head {
      align-items: flex-start !important;
      flex-direction: column !important;
    }

    .bd-timeline-flow-pill {
      white-space: normal !important;
    }

    .bd-timeline-summary-grid {
      grid-template-columns: 1fr !important;
    }

    .timeline-event-top {
      align-items: flex-start !important;
      flex-direction: column !important;
      gap: 3px !important;
    }
  }


  /* FE Updates / Photos V24: grouped Evidence Review */
  .evidence-review-panel {
    padding: 14px 16px 16px !important;
    display: grid !important;
    gap: 12px !important;
  }

  .evidence-review-hero {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 16px !important;
    padding: 4px 2px 12px !important;
    border-bottom: 1px solid rgba(148, 163, 184, 0.22) !important;
  }

  .evidence-review-heading {
    text-align: left !important;
    min-width: 0 !important;
  }

  .evidence-review-heading h2 {
    margin: 2px 0 4px !important;
    text-align: left !important;
    font-size: clamp(22px, 1.55vw, 28px) !important;
    line-height: 1.05 !important;
    color: #f8fbff !important;
  }

  .evidence-review-heading p {
    margin: 0 !important;
    text-align: left !important;
    color: #bfdbfe !important;
    font-size: 13px !important;
    font-weight: 750 !important;
    line-height: 1.35 !important;
  }

  .evidence-review-pill {
    min-width: 140px !important;
    min-height: 56px !important;
    display: grid !important;
    place-items: center !important;
    border: 1px solid rgba(96, 165, 250, 0.35) !important;
    border-radius: 18px !important;
    background: rgba(37, 99, 235, 0.12) !important;
    padding: 10px 14px !important;
  }

  .evidence-review-pill span {
    color: #93c5fd !important;
    font-size: 11px !important;
    font-weight: 900 !important;
  }

  .evidence-review-pill b {
    color: #eaf2ff !important;
    font-size: 24px !important;
    line-height: 1 !important;
  }

  .evidence-summary-grid {
    display: grid !important;
    grid-template-columns: repeat(5, minmax(120px, 1fr)) !important;
    gap: 10px !important;
  }

  .evidence-summary-card {
    min-height: 64px !important;
    border: 1px solid rgba(96, 165, 250, 0.22) !important;
    border-radius: 14px !important;
    background: rgba(15, 23, 42, 0.28) !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 10px 12px !important;
  }

  .evidence-summary-card span {
    color: #93c5fd !important;
    font-size: 11px !important;
    font-weight: 900 !important;
    text-align: center !important;
  }

  .evidence-summary-card b {
    color: #eaf2ff !important;
    font-size: 24px !important;
    line-height: 1 !important;
    margin-top: 4px !important;
  }

  .evidence-summary-card.photo b { color: #f472b6 !important; }
  .evidence-summary-card.comment b { color: #a78bfa !important; }
  .evidence-summary-card.gps b { color: #38bdf8 !important; }

  .evidence-toolbar {
    display: grid !important;
    grid-template-columns: minmax(220px, 1fr) 180px 160px auto !important;
    gap: 10px !important;
    align-items: center !important;
  }

  .evidence-toolbar input,
  .evidence-toolbar select {
    width: 100% !important;
  }

  .evidence-toggle-btn {
    min-height: 38px !important;
    white-space: nowrap !important;
  }

  .evidence-records-shell {
    border: 1px solid rgba(96, 165, 250, 0.22) !important;
    border-radius: 16px !important;
    background: rgba(15, 23, 42, 0.18) !important;
    padding: 12px !important;
  }

  .evidence-records-head {
    display: flex !important;
    align-items: flex-end !important;
    justify-content: space-between !important;
    gap: 12px !important;
    padding: 0 0 10px !important;
    margin-bottom: 10px !important;
    border-bottom: 1px solid rgba(148, 163, 184, 0.18) !important;
  }

  .evidence-records-head h3 {
    margin: 0 0 3px !important;
    color: #f8fbff !important;
    font-size: 18px !important;
    text-align: left !important;
  }

  .evidence-records-head p {
    margin: 0 !important;
    color: #9fb7d6 !important;
    font-size: 12px !important;
    font-weight: 750 !important;
    text-align: left !important;
  }

  .evidence-records-head > span {
    color: #bfdbfe !important;
    font-size: 12px !important;
    font-weight: 950 !important;
    white-space: nowrap !important;
  }

  .evidence-hidden-note,
  .evidence-empty-note {
    border: 1px dashed rgba(96, 165, 250, 0.30) !important;
    border-radius: 14px !important;
    padding: 14px !important;
    background: rgba(37, 99, 235, 0.08) !important;
    color: #bfdbfe !important;
    text-align: left !important;
    font-weight: 850 !important;
  }

  .evidence-hidden-note {
    display: grid !important;
    gap: 4px !important;
  }

  .evidence-hidden-note b {
    color: #f8fbff !important;
  }

  .evidence-hidden-note span {
    color: #bfdbfe !important;
    font-size: 12px !important;
  }

  .evidence-task-list {
    display: grid !important;
    gap: 10px !important;
  }

  .evidence-task-card {
    border: 1px solid rgba(96, 165, 250, 0.22) !important;
    border-radius: 16px !important;
    background: rgba(15, 23, 42, 0.30) !important;
    padding: 12px 14px !important;
  }

  .evidence-task-card.unlinked {
    border-color: rgba(245, 158, 11, 0.45) !important;
  }

  .evidence-task-topline {
    display: flex !important;
    align-items: flex-start !important;
    justify-content: space-between !important;
    gap: 12px !important;
    margin-bottom: 10px !important;
    text-align: left !important;
  }

  .evidence-task-topline h3 {
    margin: 0 0 4px !important;
    color: #f8fbff !important;
    font-size: 17px !important;
    line-height: 1.15 !important;
    text-align: left !important;
  }

  .evidence-task-topline p {
    margin: 0 !important;
    color: #bfdbfe !important;
    font-size: 13px !important;
    font-weight: 750 !important;
    text-align: left !important;
  }

  .evidence-task-badges {
    display: flex !important;
    align-items: center !important;
    justify-content: flex-end !important;
    gap: 8px !important;
    flex-wrap: wrap !important;
    min-width: max-content !important;
  }

  .evidence-task-badges span {
    border-radius: 999px !important;
    padding: 7px 10px !important;
    border: 1px solid rgba(96, 165, 250, 0.25) !important;
    background: rgba(37, 99, 235, 0.10) !important;
    color: #bfdbfe !important;
    font-size: 11px !important;
    font-weight: 950 !important;
  }

  .evidence-update-list {
    display: grid !important;
    gap: 8px !important;
  }

  .evidence-update-row {
    display: grid !important;
    grid-template-columns: 190px minmax(0, 1fr) !important;
    gap: 12px !important;
    align-items: flex-start !important;
    border: 1px solid rgba(96, 165, 250, 0.18) !important;
    border-radius: 13px !important;
    background: rgba(2, 6, 23, 0.22) !important;
    padding: 10px 12px !important;
  }

  .evidence-update-kind {
    display: grid !important;
    gap: 3px !important;
    text-align: left !important;
  }

  .evidence-update-kind b {
    color: #f8fbff !important;
    font-size: 12px !important;
  }

  .evidence-update-kind span {
    color: #93c5fd !important;
    font-size: 11px !important;
    font-weight: 850 !important;
  }

  .evidence-update-body {
    text-align: left !important;
  }

  .evidence-update-body p {
    margin: 0 !important;
    color: #dbeafe !important;
    font-size: 13px !important;
    font-weight: 700 !important;
    line-height: 1.35 !important;
  }

  .evidence-update-actions {
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
    flex-wrap: wrap !important;
    margin-top: 8px !important;
  }

  .evidence-update-actions a,
  .evidence-update-actions button {
    border: 1px solid rgba(56, 189, 248, 0.35) !important;
    background: rgba(14, 165, 233, 0.14) !important;
    color: #bae6fd !important;
    border-radius: 999px !important;
    padding: 7px 10px !important;
    font-size: 11px !important;
    font-weight: 950 !important;
    cursor: pointer !important;
    text-decoration: none !important;
  }

  .evidence-photo-strip {
    display: flex !important;
    gap: 8px !important;
    flex-wrap: wrap !important;
    margin-top: 10px !important;
    padding-top: 10px !important;
    border-top: 1px solid rgba(148, 163, 184, 0.16) !important;
  }

  .evidence-photo-thumb {
    width: 118px !important;
    border: 1px solid rgba(96, 165, 250, 0.25) !important;
    border-radius: 12px !important;
    background: rgba(37, 99, 235, 0.08) !important;
    padding: 6px !important;
    cursor: pointer !important;
  }

  .evidence-photo-thumb img {
    display: block !important;
    width: 100% !important;
    height: 70px !important;
    object-fit: cover !important;
    border-radius: 9px !important;
  }

  .evidence-photo-thumb span {
    display: block !important;
    margin-top: 5px !important;
    color: #bfdbfe !important;
    font-size: 10px !important;
    font-weight: 900 !important;
    text-align: center !important;
  }

  .evidence-more-note {
    margin-top: 10px !important;
    padding: 8px 10px !important;
    border: 1px dashed rgba(96, 165, 250, 0.30) !important;
    border-radius: 12px !important;
    background: rgba(37, 99, 235, 0.08) !important;
    color: #bfdbfe !important;
    font-size: 12px !important;
    font-weight: 800 !important;
    text-align: left !important;
  }

  .theme-day .evidence-review-heading h2,
  .theme-day .evidence-records-head h3,
  .theme-day .evidence-task-topline h3,
  .theme-day .evidence-update-kind b {
    color: #0f172a !important;
  }

  .theme-day .evidence-review-heading p,
  .theme-day .evidence-records-head p,
  .theme-day .evidence-task-topline p,
  .theme-day .evidence-update-body p {
    color: #334155 !important;
  }

  .theme-day .evidence-review-pill,
  .theme-day .evidence-summary-card,
  .theme-day .evidence-records-shell,
  .theme-day .evidence-task-card,
  .theme-day .evidence-update-row {
    background: #ffffff !important;
    border-color: #bfdbfe !important;
    color: #0f172a !important;
    box-shadow: none !important;
  }

  .theme-day .evidence-review-pill span,
  .theme-day .evidence-summary-card span,
  .theme-day .evidence-update-kind span,
  .theme-day .evidence-records-head > span,
  .theme-day .evidence-task-badges span {
    color: #1d4ed8 !important;
  }

  .theme-day .evidence-review-pill b,
  .theme-day .evidence-summary-card b {
    color: #0f172a !important;
  }

  .theme-day .evidence-summary-card.photo b { color: #db2777 !important; }
  .theme-day .evidence-summary-card.comment b { color: #7c3aed !important; }
  .theme-day .evidence-summary-card.gps b { color: #0284c7 !important; }

  .theme-day .evidence-hidden-note,
  .theme-day .evidence-empty-note,
  .theme-day .evidence-more-note {
    background: #eff6ff !important;
    border-color: #bfdbfe !important;
    color: #1e3a8a !important;
  }

  .theme-day .evidence-hidden-note b,
  .theme-day .evidence-hidden-note span {
    color: #1e3a8a !important;
  }

  .theme-day .evidence-task-badges span,
  .theme-day .evidence-photo-thumb {
    background: #eff6ff !important;
    border-color: rgba(37, 99, 235, 0.22) !important;
  }

  .theme-day .evidence-update-actions a,
  .theme-day .evidence-update-actions button {
    background: #eff6ff !important;
    border-color: rgba(37, 99, 235, 0.26) !important;
    color: #1d4ed8 !important;
  }

  .theme-day .evidence-photo-thumb span {
    color: #1d4ed8 !important;
  }

  @media (max-width: 1180px) {
    .evidence-summary-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    }

    .evidence-toolbar {
      grid-template-columns: 1fr 1fr !important;
    }
  }

  @media (max-width: 760px) {
    .evidence-review-hero,
    .evidence-records-head,
    .evidence-task-topline {
      align-items: flex-start !important;
      flex-direction: column !important;
    }

    .evidence-toolbar,
    .evidence-summary-grid,
    .evidence-update-row {
      grid-template-columns: 1fr !important;
    }

    .evidence-task-badges {
      justify-content: flex-start !important;
    }
  }


  /* BabyDragon UX cleanup: separate global context from module filters */
  .stat-band {
    margin: 0 0 12px !important;
    padding: 10px 12px 12px !important;
    border: 1px solid rgba(59, 130, 246, 0.22) !important;
    border-radius: 18px !important;
    background: linear-gradient(135deg, rgba(15, 23, 42, 0.32), rgba(30, 41, 59, 0.16)) !important;
  }

  .stat-band-title,
  .task-filter-band-title {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 10px !important;
    margin: 0 0 9px !important;
    padding: 0 2px !important;
  }

  .stat-band-title span,
  .task-filter-band-title span {
    color: #93c5fd !important;
    font-size: 11px !important;
    font-weight: 950 !important;
    letter-spacing: 0.18em !important;
    text-transform: uppercase !important;
  }

  .stat-band-title b,
  .task-filter-band-title b {
    color: #cbd5e1 !important;
    font-size: 11px !important;
    font-weight: 800 !important;
  }

  .stat-band-context {
    background: linear-gradient(135deg, rgba(15, 23, 42, 0.22), rgba(37, 99, 235, 0.08)) !important;
    border-style: dashed !important;
  }

  .stats-grid-context {
    grid-template-columns: repeat(3, minmax(120px, 1fr)) !important;
  }

  .task-filter-band-title {
    margin-top: 4px !important;
    padding: 10px 12px !important;
    border: 1px solid rgba(34, 197, 94, 0.24) !important;
    border-radius: 14px !important;
    background: linear-gradient(135deg, rgba(20, 83, 45, 0.20), rgba(37, 99, 235, 0.10)) !important;
  }

  .task-filter-band-title span {
    color: #86efac !important;
  }

  .task-tracking-click-grid {
    padding: 10px !important;
    border: 1px solid rgba(34, 197, 94, 0.22) !important;
    border-radius: 18px !important;
    background: rgba(2, 6, 23, 0.16) !important;
  }

  .task-filter-card {
    cursor: pointer !important;
    transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease, background 140ms ease !important;
    text-align: center !important;
  }

  .task-filter-card:hover {
    transform: translateY(-2px) !important;
    border-color: rgba(34, 197, 94, 0.48) !important;
    box-shadow: 0 12px 24px rgba(15, 23, 42, 0.20) !important;
  }

  .task-filter-card.active {
    border-color: rgba(34, 197, 94, 0.72) !important;
    background: linear-gradient(135deg, rgba(20, 83, 45, 0.42), rgba(37, 99, 235, 0.22)) !important;
    box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.12), 0 16px 28px rgba(15, 23, 42, 0.22) !important;
  }

  .task-filter-card small {
    color: #94a3b8 !important;
    font-size: 10px !important;
    line-height: 1.25 !important;
    font-weight: 750 !important;
  }

  .task-current-filter-line {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 12px !important;
    margin: 0 0 12px !important;
    padding: 10px 12px !important;
    border: 1px solid rgba(96, 165, 250, 0.28) !important;
    border-radius: 14px !important;
    background: rgba(37, 99, 235, 0.10) !important;
    color: #dbeafe !important;
  }

  .task-current-filter-line b {
    color: #ffffff !important;
  }

  .task-current-filter-line span {
    display: block !important;
    margin-top: 3px !important;
    color: #93c5fd !important;
    font-size: 11px !important;
  }

  .updates-box-note {
    margin: 4px 0 10px !important;
    color: #94a3b8 !important;
    font-size: 11px !important;
    font-weight: 750 !important;
  }

  body.bd-theme-day .stat-band,
  .theme-day .stat-band {
    background: linear-gradient(135deg, #ffffff, #f8fbff) !important;
    border-color: #bfdbfe !important;
  }

  body.bd-theme-day .stat-band-context,
  .theme-day .stat-band-context {
    background: linear-gradient(135deg, #ffffff, #eef6ff) !important;
  }

  body.bd-theme-day .stat-band-title span,
  .theme-day .stat-band-title span {
    color: #1d4ed8 !important;
  }

  body.bd-theme-day .stat-band-title b,
  .theme-day .stat-band-title b,
  body.bd-theme-day .task-filter-band-title b,
  .theme-day .task-filter-band-title b {
    color: #334155 !important;
  }

  body.bd-theme-day .task-filter-band-title,
  .theme-day .task-filter-band-title,
  body.bd-theme-day .task-tracking-click-grid,
  .theme-day .task-tracking-click-grid {
    background: #f0fdf4 !important;
    border-color: #bbf7d0 !important;
  }

  body.bd-theme-day .task-filter-band-title span,
  .theme-day .task-filter-band-title span {
    color: #15803d !important;
  }

  body.bd-theme-day .task-filter-card.active,
  .theme-day .task-filter-card.active {
    background: linear-gradient(135deg, #dcfce7, #eff6ff) !important;
    border-color: #22c55e !important;
  }

  body.bd-theme-day .task-filter-card small,
  .theme-day .task-filter-card small,
  body.bd-theme-day .updates-box-note,
  .theme-day .updates-box-note {
    color: #475569 !important;
  }

  body.bd-theme-day .task-current-filter-line,
  .theme-day .task-current-filter-line {
    background: #eff6ff !important;
    border-color: #bfdbfe !important;
    color: #1e3a8a !important;
  }

  body.bd-theme-day .task-current-filter-line b,
  .theme-day .task-current-filter-line b,
  body.bd-theme-day .task-current-filter-line span,
  .theme-day .task-current-filter-line span {
    color: #1d4ed8 !important;
  }




  /* BabyDragon Admin Structure Polish V2 - module pages stay lighter than dashboard overview */
  .module-filter-card {
    margin-bottom: 10px !important;
    border-color: rgba(96, 165, 250, 0.18) !important;
    background:
      linear-gradient(90deg, rgba(37, 99, 235, 0.10), transparent 18%),
      rgba(15, 23, 42, 0.18) !important;
  }

  .module-filter-card .filter-title h3::after {
    content: "  •  module scope";
    color: #60a5fa;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .global-filter-card {
    border-color: rgba(59, 130, 246, 0.28) !important;
  }

  .stat-band-executive {
    position: relative;
    overflow: hidden;
  }

  .stat-band-executive::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 5px;
    background: linear-gradient(180deg, #2563eb, #06b6d4, #22c55e);
    opacity: 0.9;
  }

  .task-tracking-panel {
    position: relative;
  }

  .task-tracking-panel::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: inherit;
    box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.10);
  }

  .task-filter-band-title {
    position: relative;
    box-shadow: 0 10px 24px rgba(20, 83, 45, 0.12) !important;
  }

  .task-filter-band-title::before {
    content: "MODULE FILTERS";
    position: absolute;
    top: -9px;
    left: 12px;
    padding: 2px 7px;
    border: 1px solid rgba(34, 197, 94, 0.28);
    border-radius: 999px;
    background: #020617;
    color: #86efac;
    font-size: 8px;
    font-weight: 950;
    letter-spacing: 0.12em;
  }

  .task-tracking-click-grid {
    margin-bottom: 12px !important;
    box-shadow: 0 16px 40px rgba(20, 83, 45, 0.10) !important;
  }

  .task-filter-card.active {
    transform: translateY(-1px);
  }

  body.bd-theme-day .module-filter-card,
  .theme-day .module-filter-card {
    background:
      linear-gradient(90deg, rgba(219, 234, 254, 0.78), transparent 22%),
      #ffffff !important;
    border-color: #c7d2fe !important;
  }

  body.bd-theme-day .task-filter-band-title::before,
  .theme-day .task-filter-band-title::before {
    background: #f0fdf4;
    color: #166534;
    border-color: #86efac;
  }

  @media (max-width: 820px) {
    .module-filter-card .filter-title h3::after {
      display: none;
    }
  }

  /* Admin Compact UI Density V4: operations-mode scale */
  .admin-main {
    padding: 8px 14px 12px 12px !important;
  }

  .admin-topbar {
    margin-bottom: 6px !important;
  }

  .admin-topbar h2 {
    font-size: clamp(18px, 1.2vw, 21px) !important;
    letter-spacing: 0.01em !important;
  }

  .workflow-ribbon,
  .admin-topbar p {
    font-size: clamp(10px, 0.75vw, 12px) !important;
  }

  .filters-card {
    padding: 9px 12px !important;
    margin-bottom: 8px !important;
    border-radius: 14px !important;
  }

  .filter-title {
    margin-bottom: 6px !important;
  }

  .filter-title h3 {
    font-size: 14px !important;
  }

  .filters-grid {
    gap: 8px !important;
  }

  .date-filter-row {
    gap: 8px !important;
    margin-top: 8px !important;
  }

  .filters-grid select,
  .filters-grid input,
  .date-filter-row select,
  .date-filter-row input,
  input,
  select,
  textarea {
    min-height: 31px !important;
    height: auto !important;
    font-size: 11px !important;
    padding: 6px 9px !important;
    border-radius: 9px !important;
  }

  textarea {
    min-height: 58px !important;
  }

  .stats-grid,
  .stats-grid-executive {
    gap: 8px !important;
    margin-bottom: 8px !important;
  }

  .stat-card,
  .stats-grid-executive .stat-card,
  .stat-band .stat-card {
    min-height: 46px !important;
    padding: 7px 10px !important;
    border-radius: 12px !important;
  }

  .stat-card span {
    font-size: 9px !important;
    line-height: 1 !important;
  }

  .stat-card b {
    font-size: clamp(17px, 1.12vw, 21px) !important;
    line-height: 1 !important;
  }

  .content-area > .panel-card,
  .panel-card {
    padding: 10px 12px 12px !important;
    border-radius: 14px !important;
  }

  .panel-header {
    gap: 10px !important;
    margin-bottom: 5px !important;
  }

  .panel-header h2 {
    font-size: clamp(17px, 1.15vw, 20px) !important;
    line-height: 1.08 !important;
    margin-bottom: 2px !important;
  }

  .panel-header p {
    font-size: clamp(10px, 0.76vw, 12px) !important;
    line-height: 1.22 !important;
  }

  .module-kicker,
  .section-kicker {
    font-size: 9px !important;
    letter-spacing: 0.16em !important;
    margin-bottom: 4px !important;
  }

  .small-btn,
  button,
  .task-records-toggle,
  .evidence-toggle-btn,
  .bd-timeline-toggle-btn {
    font-size: 10px !important;
    min-height: 30px !important;
    padding: 6px 10px !important;
    border-radius: 9px !important;
  }

  .primary-action-btn,
  .secondary-action-btn {
    min-height: 32px !important;
    padding: 7px 13px !important;
    border-radius: 9px !important;
    font-size: 11px !important;
  }

  .task-tracking-click-grid {
    gap: 8px !important;
    padding: 10px !important;
    margin-bottom: 8px !important;
  }

  .task-filter-card,
  .task-tracking-summary-grid .stat-card {
    min-height: 52px !important;
    padding: 8px 10px !important;
    border-radius: 12px !important;
  }

  .task-filter-card span,
  .task-filter-card small,
  .task-filter-card p {
    font-size: 9px !important;
    line-height: 1.15 !important;
  }

  .task-filter-card b,
  .task-filter-card strong {
    font-size: clamp(18px, 1.15vw, 22px) !important;
    line-height: 1 !important;
  }

  .task-current-filter-line {
    padding: 8px 10px !important;
    border-radius: 12px !important;
    margin-bottom: 8px !important;
  }

  .task-current-filter-line h3,
  .task-current-filter-line strong {
    font-size: 15px !important;
  }

  .task-current-filter-line p,
  .task-current-filter-line span {
    font-size: 10px !important;
  }

  .task-records-shell,
  .evidence-records-shell {
    padding: 10px 12px !important;
    border-radius: 14px !important;
  }

  .task-records-head,
  .evidence-records-head {
    margin-bottom: 8px !important;
  }

  .task-records-head h3,
  .evidence-records-head h3,
  .live-location-list h3 {
    font-size: 15px !important;
  }

  .task-card,
  .compact-task-card,
  .timeline-task-card,
  .bd-timeline-task-card,
  .evidence-review-panel,
  .evidence-task-list,
  .user-row {
    padding: 10px 12px !important;
    border-radius: 13px !important;
    margin-bottom: 8px !important;
  }

  .task-card h3,
  .compact-task-card h3,
  .timeline-task-card h3,
  .bd-timeline-task-card h3,
  .evidence-review-heading h2,
  .evidence-task-topline h3 {
    font-size: clamp(15px, 1vw, 18px) !important;
    line-height: 1.1 !important;
    margin-bottom: 2px !important;
  }

  .task-card p,
  .compact-task-card p,
  .timeline-task-card p,
  .bd-timeline-task-card p,
  .evidence-review-panel p,
  .evidence-task-topline p,
  .admin-checklist-box,
  .admin-issues-box,
  .updates-box,
  .muted {
    font-size: 11px !important;
    line-height: 1.22 !important;
  }

  .task-meta-grid,
  .form-grid,
  .admin-qc-summary-grid,
  .evidence-summary-grid,
  .bd-timeline-summary-grid {
    gap: 8px !important;
  }

  .task-meta-grid > div,
  .form-grid > div,
  .admin-qc-summary-grid > div,
  .evidence-summary-card,
  .bd-timeline-summary-card,
  .info-box {
    min-height: 46px !important;
    padding: 8px 10px !important;
    border-radius: 11px !important;
  }

  .status-pill,
  .checklist-pill,
  .issue-pill,
  .task-count-pill,
  .admin-mini-pill,
  .evidence-review-pill {
    min-height: 28px !important;
    padding: 6px 10px !important;
    border-radius: 999px !important;
    font-size: 10px !important;
  }

  .admin-checklist-list label,
  .admin-issue-card,
  .update-item,
  .timeline-event-card,
  .evidence-update-body {
    padding: 8px 10px !important;
    border-radius: 10px !important;
    font-size: 11px !important;
  }

  .dashboard-overview-stack {
    gap: 10px !important;
  }

  .dashboard-exec-panel {
    padding: 12px !important;
    border-radius: 15px !important;
  }

  .dashboard-exec-header {
    grid-template-columns: minmax(0, 1fr) 120px !important;
    gap: 10px !important;
    margin-bottom: 10px !important;
  }

  .dashboard-exec-header h2 {
    font-size: clamp(18px, 1.55vw, 24px) !important;
  }

  .dashboard-exec-header p,
  .dashboard-exec-header span {
    font-size: 10px !important;
  }

  .dashboard-score-card {
    min-height: 70px !important;
    border-radius: 13px !important;
  }

  .dashboard-score-card b {
    font-size: 28px !important;
  }

  .dashboard-score-card span {
    font-size: 10px !important;
  }

  .dashboard-chart-grid {
    gap: 8px !important;
  }

  .dashboard-donut-card,
  .dashboard-bars-card,
  .dashboard-project-card {
    padding: 10px !important;
    border-radius: 13px !important;
  }

  .dashboard-donut {
    width: 86px !important;
    height: 86px !important;
  }

  .dashboard-donut strong {
    font-size: 20px !important;
  }

  .dashboard-donut span,
  .dashboard-project-line span,
  .dashboard-project-card p {
    font-size: 9px !important;
  }

  .dashboard-donut-card p,
  .dashboard-bars-card h3,
  .dashboard-project-card h3 {
    font-size: 12px !important;
    margin-bottom: 7px !important;
  }

  .dashboard-mini-bar {
    margin-bottom: 7px !important;
  }

  .dashboard-mini-bar > div:first-child {
    font-size: 10px !important;
    margin-bottom: 4px !important;
  }

  .dashboard-mini-track {
    height: 6px !important;
  }

  .dashboard-project-line {
    padding: 6px 0 !important;
  }

  .dashboard-project-line b,
  .dashboard-project-line strong {
    font-size: 10px !important;
  }

  .create-project-page {
    gap: 8px !important;
  }

  .create-project-hero,
  .evidence-review-hero,
  .bd-timeline-hero {
    padding: 10px 14px !important;
    border-radius: 14px !important;
  }

  .create-project-hero h2,
  .assign-task-polish-shell h2,
  .evidence-review-hero h2,
  .bd-timeline-hero h2 {
    font-size: clamp(18px, 1.25vw, 22px) !important;
  }

  .create-project-hero p,
  .assign-task-polish-shell p,
  .evidence-review-hero p,
  .bd-timeline-hero p {
    font-size: 11px !important;
  }

  .create-project-card,
  .assign-task-polish-shell > .panel-card,
  .assign-task-polish-shell .panel-card {
    padding: 11px 14px 12px !important;
    border-radius: 14px !important;
  }

  .create-project-card-header {
    padding-bottom: 7px !important;
    margin-bottom: 8px !important;
  }

  .create-project-card-header h3 {
    font-size: 15px !important;
  }

  .field-block span,
  .assign-task-polish-shell label,
  .assign-task-polish-shell h3 {
    font-size: 10px !important;
  }

  .field-block input,
  .assign-task-polish-shell input,
  .assign-task-polish-shell select,
  .assign-task-polish-shell textarea {
    min-height: 32px !important;
    border-radius: 9px !important;
    padding: 6px 9px !important;
    font-size: 11px !important;
  }

  .assign-task-polish-shell textarea {
    min-height: 56px !important;
  }

  .create-project-actions {
    margin-top: 9px !important;
  }

  .map-shell {
    margin-top: 6px !important;
    border-radius: 14px !important;
  }

  .admin-map,
  .map-shell .leaflet-container {
    height: clamp(300px, 38vh, 390px) !important;
    min-height: 300px !important;
    border-radius: 14px !important;
  }

  .live-map-status-banner,
  .timeline-map-note,
  .message-bar,
  .task-records-hidden-note,
  .evidence-hidden-note,
  .bd-timeline-collapsed-note {
    min-height: 22px !important;
    padding: 5px 9px !important;
    font-size: 10px !important;
    border-radius: 9px !important;
  }

  .admin-section-head {
    margin-bottom: 6px !important;
  }

  .admin-section-head h3 {
    font-size: 15px !important;
  }

  .photo,
  .update-photo,
  .timeline-photo,
  .evidence-photo-thumb {
    max-height: 64px !important;
    border-radius: 8px !important;
  }

  @media (min-width: 1500px) {
    .admin-main {
      padding-left: 14px !important;
      padding-right: 14px !important;
    }
  }


  /* Admin Compact UI Density V4B: Task Tracking spacing polish */
  .task-tracking-panel .panel-header {
    margin-bottom: 10px !important;
  }

  .task-filter-band-title {
    margin-top: 14px !important;
    margin-bottom: 10px !important;
    padding: 16px 14px 11px !important;
    min-height: 46px !important;
    align-items: center !important;
  }

  .task-filter-band-title::before {
    top: -10px !important;
    left: 14px !important;
    line-height: 1 !important;
  }

  .task-filter-band-title span {
    display: block !important;
    padding-top: 2px !important;
    line-height: 1.1 !important;
  }

  .task-filter-band-title b {
    display: block !important;
    line-height: 1.2 !important;
    text-align: right !important;
  }

  .task-tracking-click-grid {
    gap: 9px !important;
    padding: 12px !important;
    margin-bottom: 10px !important;
  }

  .task-filter-card {
    min-height: 58px !important;
    padding: 9px 10px !important;
  }

  .task-current-filter-line {
    margin-top: 10px !important;
    margin-bottom: 10px !important;
    padding: 10px 12px !important;
  }

  .task-records-shell {
    margin-top: 10px !important;
  }

  .task-records-hidden-note {
    margin-top: 8px !important;
  }

  body.bd-theme-day .task-filter-band-title,
  .theme-day .task-filter-band-title {
    box-shadow: 0 10px 22px rgba(34, 197, 94, 0.08) !important;
  }

  @media (max-width: 900px) {
    .task-filter-band-title {
      align-items: flex-start !important;
      flex-direction: column !important;
      gap: 4px !important;
    }

    .task-filter-band-title b {
      text-align: left !important;
    }
  }


  /* Admin Compact UI V4C: left-align Task Tracking module kicker */
  .task-tracking-panel .task-tracking-header,
  .task-tracking-panel .task-tracking-header > div,
  .task-tracking-panel .panel-header > div {
    text-align: left !important;
  }

  .task-tracking-panel .task-tracking-header .module-kicker {
    display: block !important;
    width: 100% !important;
    text-align: left !important;
    margin-left: 0 !important;
    justify-content: flex-start !important;
  }


`;
