import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import AdminLiveMap from "./components/AdminLiveMap";


const emptyProject = {
  name: "",
  customer: "",
  market: "",
  testing_type: "",
};

const emptyTask = {
  project_id: "",
  market: "",
  target_type: "",
  target_name: "",
  test_type: "",
  priority: "normal",
  due_date: "",
  notes: "",
  assigned_to: "",
};

const menuGroups = [
  {
    title: "Project Management",
    items: [
      { id: "overview", label: "Dashboard Overview", icon: "📊" },
      { id: "createProject", label: "Create Project", icon: "➕" },
      { id: "assignTask", label: "Assign Task", icon: "🧾" },
      { id: "taskTracking", label: "Task Tracking", icon: "✅" },
    ],
  },
  {
    title: "Route Management",
    items: [
      { id: "routes", label: "Routes", icon: "🗺️", soon: true },
      { id: "uploadKml", label: "Upload KML/KMZ", icon: "📁", soon: true },
      { id: "assignRoute", label: "Assign Route", icon: "📍", soon: true },
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
      { id: "qc", label: "QC Review", icon: "🔍", soon: true },
      { id: "reports", label: "Reports", icon: "📄", soon: true },
    ],
  },
];

export default function AdminDashboard({ user, onLogout }) {
  const [focusedLocation, setFocusedLocation] = useState(null);
	
  const [activeView, setActiveView] = useState(() => {
	return localStorage.getItem("adminActiveView") || "overview";
  });

  const [projects, setProjects] = useState([]);
  const [fieldEngineers, setFieldEngineers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [taskUpdates, setTaskUpdates] = useState({});
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

  const [filters, setFilters] = useState({
    projectId: "",
    market: "",
    status: "",
    feId: "",
  });

  const [task, setTask] = useState(() => {
    const saved = localStorage.getItem("adminTaskForm");
    return saved ? JSON.parse(saved) : emptyTask;
  });

  useEffect(() => {
	localStorage.setItem("adminProjectForm", JSON.stringify(projectForm));
	}, [projectForm]);
	
  useEffect(() => {
	localStorage.setItem("adminActiveView", activeView);
	}, [activeView]);

  useEffect(() => {
    fetchAll();

    const channel = supabase
      .channel("admin-dashboard-refresh")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, fetchAll)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "task_updates" },
        fetchAll
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("adminTaskForm", JSON.stringify(task));
  }, [task]);

  async function fetchAll() {
    await Promise.all([
      fetchProjects(),
      fetchFEs(),
      fetchTasks(),
      fetchTaskUpdates(),
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

  function handleProjectSelect(projectId) {
    const selectedProject = projects.find((p) => p.id === projectId);

    setTask({
      ...task,
      project_id: projectId,
      market: selectedProject?.market || "",
    });
  }

  async function assignTask(e) {
    e.preventDefault();
    setMessage("");

    if (!task.project_id) {
      alert("Please select a project before assigning task.");
      return;
    }

    const selectedProject = projects.find((p) => p.id === task.project_id);

    const title = `${selectedProject?.name || "Project"} - ${task.market} - ${task.target_name}`;

    const { error } = await supabase.from("tasks").insert({
      title,
      project_id: task.project_id,
      market: task.market,
      target_type: task.target_type,
      target_name: task.target_name.trim(),
      test_type: task.test_type.trim(),
      priority: task.priority,
      due_date: task.due_date || null,
      notes: task.notes.trim(),
      assigned_to: task.assigned_to,
      status: "assigned",
    });

    if (error) {
      alert(error.message);
      return;
    }

    setTask({
      ...emptyTask,
      assigned_to: task.assigned_to,
    });

    localStorage.removeItem("adminTaskForm");
    setMessage("Task assigned successfully.");
    fetchTasks();
    setActiveView("taskTracking");
  }

  function getFeEmail(feId) {
    return fieldEngineers.find((fe) => fe.id === feId)?.email || "Unassigned";
  }

  function statusLabel(status) {
    if (status === "in_progress") return "In Progress";
    if (status === "completed") return "Completed";
    if (status === "assigned") return "Assigned";
    if (status === "pending") return "Pending";
    return status || "Unknown";
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
      const matchStatus = !filters.status || t.status === filters.status;
      const matchFe = !filters.feId || t.assigned_to === filters.feId;

      return matchProject && matchMarket && matchStatus && matchFe;
    });
  }, [tasks, filters]);

  const stats = useMemo(() => {
    const activeFeIds = new Set(
      tasks
        .filter((t) => t.status === "in_progress")
        .map((t) => t.assigned_to)
        .filter(Boolean)
    );

    return {
      projects: projects.length,
      totalTasks: tasks.length,
      assigned: tasks.filter((t) => t.status === "assigned").length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      completed: tasks.filter((t) => t.status === "completed").length,
      activeFes: activeFeIds.size,
    };
  }, [projects, tasks]);

  const selectedProject = projects.find((p) => p.id === task.project_id);

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
              onChange={(e) =>
                setNewUser({ ...newUser, email: e.target.value })
              }
            />

            <input
              type="password"
              placeholder="Temporary password"
              value={newUser.password}
              onChange={(e) =>
                setNewUser({ ...newUser, password: e.target.value })
              }
            />
          </div>

          <div className="form-row">
            <select
              value={newUser.role}
              onChange={(e) =>
                setNewUser({ ...newUser, role: e.target.value })
              }
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
                    {profile.is_active ? "Active" : "Inactive"} • {profile.created_at
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
            onChange={(e) =>
              setProjectForm({ ...projectForm, name: e.target.value })
            }
            required
          />

          <input
            placeholder="Customer"
            value={projectForm.customer}
            onChange={(e) =>
              setProjectForm({ ...projectForm, customer: e.target.value })
            }
          />

          <input
            placeholder="Market"
            value={projectForm.market}
            onChange={(e) =>
              setProjectForm({ ...projectForm, market: e.target.value })
            }
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

  function renderAssignTask() {
    return (
      <div className="panel-card">
        <div className="panel-header">
          <div>
            <h2>Assign Task</h2>
            <p>Assign site, grid, cluster, benchmark, or route work to an FE.</p>
          </div>
        </div>

        <form onSubmit={assignTask} className="form-grid">
          <div className="form-row">
            <select
              value={task.project_id}
              onChange={(e) => handleProjectSelect(e.target.value)}
              required
            >
              <option value="">Select Project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.market})
                </option>
              ))}
            </select>

            <input placeholder="Market" value={task.market} disabled />
          </div>

          {selectedProject && (
            <div className="info-box">
              <b>Selected Project:</b> {selectedProject.name}
              <br />
              <b>Customer:</b> {selectedProject.customer || "N/A"}
              <br />
              <b>Testing Type:</b> {selectedProject.testing_type || "N/A"}
            </div>
          )}

          <div className="form-row">
            <select
              value={task.target_type}
              onChange={(e) =>
                setTask({ ...task, target_type: e.target.value })
              }
              required
            >
              <option value="">Select Target Type</option>
              <option value="Site">Site</option>
              <option value="Grid">Grid</option>
              <option value="Cluster">Cluster</option>
              <option value="Benchmark Route">Benchmark Route</option>
              <option value="Drive Route">Drive Route</option>
              <option value="Venue">Venue</option>
              <option value="Other">Other</option>
            </select>

            <input
              placeholder="Target Name"
              value={task.target_name}
              disabled={!task.target_type}
              onChange={(e) =>
                setTask({ ...task, target_name: e.target.value })
              }
              required
            />
          </div>

          <div className="form-row">
            <input
              placeholder="Test Scope (OOKLA, FCC, Voice...)"
              value={task.test_type}
              onChange={(e) => setTask({ ...task, test_type: e.target.value })}
              required
            />

            <select
              value={task.priority}
              onChange={(e) => setTask({ ...task, priority: e.target.value })}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          <div className="form-row">
            <input
              type="datetime-local"
              value={task.due_date}
              onChange={(e) => setTask({ ...task, due_date: e.target.value })}
            />

            <select
              value={task.assigned_to}
              onChange={(e) => setTask({ ...task, assigned_to: e.target.value })}
              required
            >
              <option value="">Assign Field Engineer</option>
              {fieldEngineers.map((fe) => (
                <option key={fe.id} value={fe.id}>
                  {fe.email}
                </option>
              ))}
            </select>
          </div>

          <textarea
            placeholder="Notes"
            value={task.notes}
            onChange={(e) => setTask({ ...task, notes: e.target.value })}
          />

          <button type="submit">Assign Task</button>
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
            filteredTasks.map((t) => (
              <div key={t.id} className="task-card">
                <div className="task-card-top">
                  <div>
                    <h3>
                      {t.projects?.name || "No Project"} • {t.target_name}
                    </h3>
                    <p>
                      {t.market || "No Market"} • {t.test_type || "No Scope"}
                    </p>
                  </div>

                  <span className={`status-pill ${t.status}`}>
                    {statusLabel(t.status)}
                  </span>
                </div>

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

                {(taskUpdates[t.id] || []).length > 0 && (
                  <div className="updates-box">
                    <b>Latest FE Updates</b>

                    {(taskUpdates[t.id] || []).slice(0, 5).map((update) => (
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
              </div>
            ))
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
      detail: `${task.projects?.name || "Project"} assigned to ${getFeEmail(
        task.assigned_to
      )}`,
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

  function renderActiveView() {
    if (activeView === "overview") {
      return (
        <>
          <AdminLiveMap filters={filters} focusedLocation={focusedLocation} />
          {renderTaskTracking()}
        </>
      );
    }

    if (activeView === "userManagement") return renderUserManagement();
    if (activeView === "createProject") return renderCreateProject();
    if (activeView === "assignTask") return renderAssignTask();
    if (activeView === "taskTracking") return renderTaskTracking();
    if (activeView === "liveMap") return <AdminLiveMap filters={filters} focusedLocation={focusedLocation} />;
    if (activeView === "timeline") return renderTimeline();
    if (activeView === "updates") return renderUpdates();

    if (activeView === "routes") return renderComingSoon("Route Management");
    if (activeView === "uploadKml") return renderComingSoon("Upload KML/KMZ");
    if (activeView === "assignRoute") return renderComingSoon("Assign Route");
    if (activeView === "qc") return renderComingSoon("QC Review");
    if (activeView === "reports") return renderComingSoon("Reports");

    return null;
  }

  return (
    <div className="admin-shell">
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

        <nav className="side-nav">
          {menuGroups.map((group) => (
            <div key={group.title} className="nav-group">
              <h4>{group.title}</h4>

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
          ))}
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
          <div>
            <h2>Operations Dashboard</h2>
            <p>Project → Scope → Route → Assignment → Execution → Upload → QC → Report → Close</p>
          </div>
        </header>

        <section className="filters-card">
          <div className="filter-title">
            <h3>Filters</h3>
            <button
              className="small-btn"
              onClick={() =>
                setFilters({
                  projectId: "",
                  market: "",
                  status: "",
                  feId: "",
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
              <option value="assigned">Assigned</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="pending">Pending</option>
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