import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

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
  grid_mode: "single",
  grid_id: "",
  grid_ids: [],
};

export default function AssignTask({
  projects,
  fieldEngineers,
  onTaskCreated,
  setActiveView,
  setMessage,
}) {
  const [task, setTask] = useState(() => {
    const saved = localStorage.getItem("adminAssignTaskFormV2");
    if (!saved) return emptyTask;

    try {
      return JSON.parse(saved);
    } catch {
      localStorage.removeItem("adminAssignTaskFormV2");
      return emptyTask;
    }
  });

  const [grids, setGrids] = useState([]);
  const [gridSearch, setGridSearch] = useState("");

  useEffect(() => {
    localStorage.setItem("adminAssignTaskFormV2", JSON.stringify(task));
  }, [task]);

  useEffect(() => {
    fetchGrids();
  }, []);

  async function fetchGrids() {
    const { data, error } = await supabase
      .from("grids")
      .select("id, name, market, status")
      .order("name");

    if (error) {
      console.error("Error fetching grids:", error);
      return;
    }

    setGrids(data || []);
  }

  const selectedProject = projects.find((p) => p.id === task.project_id);

  const availableGrids = useMemo(() => {
    return grids.filter((grid) => {
      const matchMarket = !task.market || grid.market === task.market;
      const matchSearch =
        !gridSearch.trim() ||
        grid.name?.toLowerCase().includes(gridSearch.toLowerCase());

      return matchMarket && matchSearch;
    });
  }, [grids, task.market, gridSearch]);

  const selectedGridCount =
    task.grid_mode === "single"
      ? task.grid_id
        ? 1
        : 0
      : task.grid_mode === "multiple"
      ? task.grid_ids.length
      : grids.filter((g) => !task.market || g.market === task.market).length;

  function handleProjectSelect(projectId) {
    const project = projects.find((p) => p.id === projectId);

    setTask({
      ...task,
      project_id: projectId,
      market: project?.market || "",
      grid_id: "",
      grid_ids: [],
    });
  }

  function clearDraft() {
    setTask({ ...emptyTask, assigned_to: task.assigned_to });
    setGridSearch("");
    localStorage.removeItem("adminAssignTaskFormV2");
    setMessage?.("Assign Task form cleared.");
  }

  async function assignTask(e) {
    e.preventDefault();

    if (!task.project_id) {
      alert("Please select a project.");
      return;
    }

    const selectedGridIds =
      task.grid_mode === "single"
        ? task.grid_id
          ? [task.grid_id]
          : []
        : task.grid_mode === "multiple"
        ? task.grid_ids
        : grids
            .filter((g) => !task.market || g.market === task.market)
            .map((g) => g.id);

    const title = `${selectedProject?.name || "Project"} - ${task.market} - ${
      task.target_name
    }`;

    const { data: insertedTask, error } = await supabase
      .from("tasks")
      .insert({
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
        grid_id: selectedGridIds[0] || null,
      })
      .select("id")
      .single();

    if (error) {
      alert(error.message);
      return;
    }

    if (selectedGridIds.length > 0) {
      const gridLinks = selectedGridIds.map((gridId) => ({
        task_id: insertedTask.id,
        grid_id: gridId,
      }));

      const { error: linkError } = await supabase
        .from("task_grids")
        .insert(gridLinks);

      if (linkError) {
        alert("Task created, but grid links failed: " + linkError.message);
        return;
      }
    }

    setTask({
      ...emptyTask,
      assigned_to: task.assigned_to,
    });

    localStorage.removeItem("adminAssignTaskFormV2");
    setMessage("Task assigned successfully.");
    onTaskCreated?.();
    setActiveView("taskTracking");
  }

  return (
    <div className="panel-card bd-assign-v22">
      <style>{`
        .bd-assign-v22 {
          width: 100%;
          padding: 14px 16px !important;
          border-radius: 18px !important;
        }

        .bd-assign-v22 * {
          box-sizing: border-box;
        }

        .bd-assign-hero {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 12px;
          padding-bottom: 10px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.24);
        }

        .bd-assign-heading {
          flex: 1 1 auto;
          min-width: 0;
          text-align: left !important;
        }


        .bd-assign-kicker {
          color: #60a5fa;
          font-size: 11px;
          font-weight: 950;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          margin-bottom: 4px;
          text-align: left !important;
          width: 100%;
          display: block;
        }

        .bd-assign-title {
          margin: 0;
          text-align: left !important;
          font-size: clamp(22px, 1.55vw, 28px);
          line-height: 1.05;
          color: #f8fbff;
        }

        .bd-assign-subtitle {
          margin: 4px 0 0;
          text-align: left !important;
          color: #bfd0e8;
          font-size: 13px;
          font-weight: 750;
        }

        .bd-assign-flow-pill {
          flex: 0 0 auto;
          border: 1px solid rgba(96, 165, 250, 0.35);
          border-radius: 999px;
          padding: 11px 15px;
          color: #dbeafe;
          background: rgba(37, 99, 235, 0.12);
          font-size: 12px;
          font-weight: 950;
          white-space: nowrap;
        }

        .bd-assign-form {
          display: grid;
          gap: 10px;
        }

        .bd-section-card {
          border: 1px solid rgba(96, 165, 250, 0.22);
          border-radius: 15px;
          padding: 12px;
          background: rgba(15, 23, 42, 0.18);
        }

        .bd-section-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
        }

        .bd-section-title {
          margin: 0;
          color: #f8fbff;
          font-size: 14px;
          font-weight: 950;
          text-align: left !important;
        }

        .bd-section-note {
          color: #9fb7d6;
          font-size: 11px;
          font-weight: 800;
        }

        .bd-field-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px 12px;
        }

        .bd-field-grid.three {
          grid-template-columns: 1.1fr 0.9fr 0.9fr;
        }

        .bd-field-full {
          grid-column: 1 / -1;
        }

        .bd-field {
          display: flex;
          flex-direction: column;
          gap: 5px;
          min-width: 0;
        }

        .bd-field label,
        .bd-inline-label {
          display: block;
          text-align: left !important;
          color: #dbeafe;
          font-size: 11px;
          font-weight: 950;
          letter-spacing: 0.02em;
          margin: 0;
        }

        .bd-assign-v22 input,
        .bd-assign-v22 select,
        .bd-assign-v22 textarea {
          width: 100%;
          min-height: 38px !important;
          height: auto;
          border-radius: 11px !important;
          border: 1px solid rgba(147, 197, 253, 0.28) !important;
          background: rgba(2, 12, 27, 0.40) !important;
          color: #f8fbff !important;
          padding: 9px 11px !important;
          font-size: 12px !important;
          font-weight: 800 !important;
          outline: none;
        }

        .bd-assign-v22 input::placeholder,
        .bd-assign-v22 textarea::placeholder {
          color: rgba(191, 219, 254, 0.62) !important;
        }

        .bd-assign-v22 input:disabled {
          opacity: 0.75;
          cursor: not-allowed;
        }

        .bd-assign-v22 textarea {
          min-height: 56px !important;
          resize: vertical;
        }

        .bd-project-summary {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          margin-top: 10px;
        }

        .bd-project-chip,
        .bd-grid-count-chip {
          border: 1px solid rgba(96, 165, 250, 0.24);
          border-radius: 12px;
          padding: 8px 10px;
          background: rgba(37, 99, 235, 0.10);
          color: #eaf2ff;
          font-size: 12px;
          font-weight: 850;
          min-height: 38px;
        }

        .bd-project-chip span,
        .bd-grid-count-chip span {
          display: block;
          color: #93c5fd;
          font-size: 10px;
          font-weight: 950;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 2px;
        }

        .bd-grid-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 8px;
        }

        .bd-small-action {
          border: 1px solid rgba(147, 197, 253, 0.34) !important;
          background: rgba(37, 99, 235, 0.14) !important;
          color: #eaf2ff !important;
          border-radius: 10px !important;
          padding: 8px 10px !important;
          min-height: 34px !important;
          font-size: 11px !important;
          font-weight: 950 !important;
          cursor: pointer;
        }

        .bd-grid-list {
          margin-top: 8px;
          max-height: 160px;
          overflow-y: auto;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px;
          padding: 8px;
          border: 1px solid rgba(96, 165, 250, 0.20);
          border-radius: 12px;
          background: rgba(2, 12, 27, 0.18);
        }

        .bd-grid-option {
          display: flex !important;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          border: 1px solid rgba(148, 163, 184, 0.16);
          border-radius: 10px;
          padding: 7px 8px;
          color: #dbeafe !important;
          font-size: 11px !important;
          font-weight: 850 !important;
          background: rgba(15, 23, 42, 0.28);
        }

        .bd-grid-option input {
          width: 14px !important;
          min-height: 14px !important;
          padding: 0 !important;
        }

        .bd-action-row {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 2px;
        }

        .bd-clear-btn,
        .bd-submit-btn {
          min-height: 40px !important;
          border-radius: 12px !important;
          padding: 9px 18px !important;
          font-size: 12px !important;
          font-weight: 950 !important;
          cursor: pointer;
        }

        .bd-clear-btn {
          border: 1px solid rgba(147, 197, 253, 0.35) !important;
          background: rgba(15, 23, 42, 0.30) !important;
          color: #eaf2ff !important;
        }

        .bd-submit-btn {
          border: 0 !important;
          min-width: 190px;
          color: #06111f !important;
          background: linear-gradient(90deg, #2563eb, #06b6d4) !important;
          box-shadow: 0 12px 22px rgba(14, 165, 233, 0.16);
        }

        body.bd-theme-day .bd-assign-title,
        .theme-day .bd-assign-title,
        body.bd-theme-day .bd-section-title,
        .theme-day .bd-section-title {
          color: #0f172a;
        }

        body.bd-theme-day .bd-assign-subtitle,
        .theme-day .bd-assign-subtitle,
        body.bd-theme-day .bd-section-note,
        .theme-day .bd-section-note {
          color: #475569;
        }

        body.bd-theme-day .bd-assign-flow-pill,
        .theme-day .bd-assign-flow-pill {
          color: #1d4ed8;
          background: rgba(219, 234, 254, 0.72);
          border-color: rgba(37, 99, 235, 0.25);
        }

        body.bd-theme-day .bd-section-card,
        .theme-day .bd-section-card {
          background: rgba(255, 255, 255, 0.72);
          border-color: rgba(30, 64, 175, 0.16);
        }

        body.bd-theme-day .bd-field label,
        .theme-day .bd-field label,
        body.bd-theme-day .bd-inline-label,
        .theme-day .bd-inline-label {
          color: #17324d;
        }

        body.bd-theme-day .bd-assign-v22 input,
        body.bd-theme-day .bd-assign-v22 select,
        body.bd-theme-day .bd-assign-v22 textarea,
        .theme-day .bd-assign-v22 input,
        .theme-day .bd-assign-v22 select,
        .theme-day .bd-assign-v22 textarea {
          background: #f8fbff !important;
          color: #0f172a !important;
          border-color: rgba(30, 64, 175, 0.22) !important;
        }

        body.bd-theme-day .bd-assign-v22 input::placeholder,
        body.bd-theme-day .bd-assign-v22 textarea::placeholder,
        .theme-day .bd-assign-v22 input::placeholder,
        .theme-day .bd-assign-v22 textarea::placeholder {
          color: #64748b !important;
        }

        body.bd-theme-day .bd-project-chip,
        body.bd-theme-day .bd-grid-count-chip,
        .theme-day .bd-project-chip,
        .theme-day .bd-grid-count-chip {
          color: #0f172a;
          background: rgba(239, 246, 255, 0.88);
          border-color: rgba(37, 99, 235, 0.18);
        }

        body.bd-theme-day .bd-project-chip span,
        body.bd-theme-day .bd-grid-count-chip span,
        .theme-day .bd-project-chip span,
        .theme-day .bd-grid-count-chip span {
          color: #2563eb;
        }

        body.bd-theme-day .bd-grid-list,
        .theme-day .bd-grid-list {
          background: rgba(248, 251, 255, 0.90);
          border-color: rgba(30, 64, 175, 0.16);
        }

        body.bd-theme-day .bd-grid-option,
        .theme-day .bd-grid-option {
          background: #ffffff;
          color: #0f172a !important;
          border-color: rgba(30, 64, 175, 0.12);
        }

        body.bd-theme-day .bd-small-action,
        .theme-day .bd-small-action,
        body.bd-theme-day .bd-clear-btn,
        .theme-day .bd-clear-btn {
          color: #1d4ed8 !important;
          background: #ffffff !important;
          border-color: rgba(37, 99, 235, 0.24) !important;
        }

        body.bd-theme-day .bd-submit-btn,
        .theme-day .bd-submit-btn {
          color: #06111f !important;
        }

        @media (max-width: 1000px) {
          .bd-assign-hero,
          .bd-section-head {
            align-items: flex-start;
            flex-direction: column;
          }

          .bd-field-grid,
          .bd-field-grid.three,
          .bd-project-summary,
          .bd-grid-list {
            grid-template-columns: 1fr;
          }

          .bd-action-row {
            flex-direction: column-reverse;
          }

          .bd-submit-btn,
          .bd-clear-btn {
            width: 100%;
          }
        }
      `}</style>

      <div className="bd-assign-hero">
        <div className="bd-assign-heading">
          <div className="bd-assign-kicker">Project Management</div>
          <h2 className="bd-assign-title">Assign Task</h2>
          <p className="bd-assign-subtitle">
            Assign site, grid, cluster, benchmark, or route work to a field engineer.
          </p>
        </div>
        <div className="bd-assign-flow-pill">Project → Grid → FE → Execution</div>
      </div>

      <form onSubmit={assignTask} className="bd-assign-form">
        <div className="bd-section-card">
          <div className="bd-section-head">
            <h3 className="bd-section-title">Project & Target</h3>
            <span className="bd-section-note">Choose the project first so market and grid filters stay clean.</span>
          </div>

          <div className="bd-field-grid">
            <div className="bd-field">
              <label>Project *</label>
              <select
                value={task.project_id}
                onChange={(e) => handleProjectSelect(e.target.value)}
                required
              >
                <option value="">Select Project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} ({project.market})
                  </option>
                ))}
              </select>
            </div>

            <div className="bd-field">
              <label>Market</label>
              <input placeholder="Market" value={task.market} disabled />
            </div>

            <div className="bd-field">
              <label>Target Type *</label>
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
            </div>

            <div className="bd-field">
              <label>Target Name *</label>
              <input
                placeholder="Example: Site, grid, cluster, or route name"
                value={task.target_name}
                disabled={!task.target_type}
                onChange={(e) =>
                  setTask({ ...task, target_name: e.target.value })
                }
                required
              />
            </div>
          </div>

          {selectedProject && (
            <div className="bd-project-summary">
              <div className="bd-project-chip">
                <span>Project</span>
                {selectedProject.name}
              </div>
              <div className="bd-project-chip">
                <span>Customer</span>
                {selectedProject.customer || "N/A"}
              </div>
              <div className="bd-project-chip">
                <span>Testing Type</span>
                {selectedProject.testing_type || "N/A"}
              </div>
            </div>
          )}
        </div>

        <div className="bd-section-card">
          <div className="bd-section-head">
            <h3 className="bd-section-title">Grid Assignment</h3>
            <div className="bd-grid-count-chip">
              <span>Selected Grids</span>
              {selectedGridCount}
            </div>
          </div>

          <div className="bd-field-grid">
            <div className="bd-field">
              <label>Grid Assignment Mode</label>
              <select
                value={task.grid_mode}
                onChange={(e) =>
                  setTask({
                    ...task,
                    grid_mode: e.target.value,
                    grid_id: "",
                    grid_ids: [],
                  })
                }
              >
                <option value="single">Single Grid</option>
                <option value="multiple">Multiple Grids</option>
                <option value="all_market">All Grids in Market</option>
              </select>
            </div>

            {task.grid_mode === "single" && (
              <div className="bd-field">
                <label>Grid</label>
                <select
                  value={task.grid_id}
                  onChange={(e) => setTask({ ...task, grid_id: e.target.value })}
                >
                  <option value="">Select Grid</option>
                  {availableGrids.map((grid) => (
                    <option key={grid.id} value={grid.id}>
                      {grid.name} ({grid.market})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {task.grid_mode === "multiple" && (
              <div className="bd-field bd-field-full">
                <label>Multiple Grids</label>
                <input
                  placeholder="Search grids..."
                  value={gridSearch}
                  onChange={(e) => setGridSearch(e.target.value)}
                />

                <div className="bd-grid-actions">
                  <button
                    type="button"
                    className="bd-small-action"
                    onClick={() =>
                      setTask({
                        ...task,
                        grid_ids: availableGrids.map((g) => g.id),
                      })
                    }
                  >
                    Select All Filtered
                  </button>

                  <button
                    type="button"
                    className="bd-small-action"
                    onClick={() => setTask({ ...task, grid_ids: [] })}
                  >
                    Clear Selection
                  </button>

                  <span className="bd-section-note">Filtered: {availableGrids.length}</span>
                </div>

                <div className="bd-grid-list">
                  {availableGrids.map((grid) => (
                    <label key={grid.id} className="bd-grid-option">
                      <input
                        type="checkbox"
                        checked={task.grid_ids.includes(grid.id)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setTask({
                            ...task,
                            grid_ids: checked
                              ? [...new Set([...task.grid_ids, grid.id])]
                              : task.grid_ids.filter((id) => id !== grid.id),
                          });
                        }}
                      />
                      {grid.name} ({grid.market})
                    </label>
                  ))}
                </div>
              </div>
            )}

            {task.grid_mode === "all_market" && (
              <div className="bd-project-chip">
                <span>Market Selection</span>
                All grids in {task.market || "selected market"} will be assigned.
              </div>
            )}
          </div>
        </div>

        <div className="bd-section-card">
          <div className="bd-section-head">
            <h3 className="bd-section-title">Scope, Due Date & FE</h3>
            <span className="bd-section-note">Required fields are marked *</span>
          </div>

          <div className="bd-field-grid">
            <div className="bd-field">
              <label>Test Scope *</label>
              <input
                placeholder="Example: OOKLA, FCC, Voice, SSV"
                value={task.test_type}
                onChange={(e) => setTask({ ...task, test_type: e.target.value })}
                required
              />
            </div>

            <div className="bd-field">
              <label>Priority</label>
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

            <div className="bd-field">
              <label>Due Date</label>
              <input
                type="datetime-local"
                value={task.due_date}
                onChange={(e) => setTask({ ...task, due_date: e.target.value })}
              />
            </div>

            <div className="bd-field">
              <label>Field Engineer *</label>
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

            <div className="bd-field bd-field-full">
              <label>Notes</label>
              <textarea
                placeholder="Task notes, drive instructions, handoff details, or QC reminders..."
                value={task.notes}
                onChange={(e) => setTask({ ...task, notes: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="bd-action-row">
          <button type="button" className="bd-clear-btn" onClick={clearDraft}>
            Clear Draft
          </button>
          <button type="submit" className="bd-submit-btn">
            Assign Task
          </button>
        </div>
      </form>
    </div>
  );
}
