import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import FELiveGpsMap from "./components/FELiveGpsMap";

export default function FEDashboard() {
  const [tasks, setTasks] = useState([]);
  const [updates, setUpdates] = useState({});
  const [commentInputs, setCommentInputs] = useState(() => {
    const saved = localStorage.getItem("feCommentInputs");
    return saved ? JSON.parse(saved) : {};
  });
  const [photoInputs, setPhotoInputs] = useState({});
  const [uploadingTaskId, setUploadingTaskId] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchTasks();
  }, []);

  useEffect(() => {
    localStorage.setItem("feCommentInputs", JSON.stringify(commentInputs));
  }, [commentInputs]);

  useEffect(() => {
    const interval = setInterval(async () => {
      const activeTasks = tasks.filter((task) => task.status === "in_progress");
      if (activeTasks.length === 0) return;

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      for (const task of activeTasks) {
        const location = await getCurrentLocation();

        if (!location?.latitude || !location?.longitude) continue;

        const { error } = await supabase.from("task_updates").insert({
          task_id: task.id,
          user_id: user.id,
          user_email: user.email,
          comment: "Auto GPS point",
          photo_url: null,
          latitude: location.latitude,
          longitude: location.longitude,
        });

        if (error) console.error("Auto GPS save error:", error);
      }

      await fetchTaskUpdates(user.id);
    }, 30000);

    return () => clearInterval(interval);
  }, [tasks]);

  async function fetchTasks() {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setMessage("Failed to load user.");
      return;
    }

    const { data, error } = await supabase
      .from("tasks")
      .select(`
        *,
        projects (
          id,
          name,
          customer,
          market,
          testing_type
        )
      `)
      .eq("assigned_to", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading tasks:", error);
      setMessage("Failed to load tasks.");
      return;
    }

    setTasks(data || []);
    await fetchTaskUpdates(user.id);
  }

  async function fetchTaskUpdates(userId) {
    const { data, error } = await supabase
      .from("task_updates")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading updates:", error);
      return;
    }

    const grouped = {};
    (data || []).forEach((update) => {
      if (!grouped[update.task_id]) grouped[update.task_id] = [];
      grouped[update.task_id].push(update);
    });

    setUpdates(grouped);
  }

  async function getCurrentLocation() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({ latitude: null, longitude: null });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        () => {
          resolve({ latitude: null, longitude: null });
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    });
  }

  async function saveSystemUpdate(taskId, commentText) {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      alert("Failed to load user.");
      return;
    }

    const location = await getCurrentLocation();

    const { error } = await supabase.from("task_updates").insert({
      task_id: taskId,
      user_id: user.id,
      user_email: user.email,
      comment: commentText,
      photo_url: null,
      latitude: location.latitude,
      longitude: location.longitude,
    });

    if (error) console.error("System update error:", error);
  }

  async function updateTaskStatus(taskId, newStatus) {
    const updatesData = { status: newStatus };

    if (newStatus === "in_progress") {
      updatesData.started_at = new Date().toISOString();
    }

    if (newStatus === "completed") {
      updatesData.completed_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from("tasks")
      .update(updatesData)
      .eq("id", taskId);

    if (error) {
      console.error("Error updating task:", error);
      alert("Failed to update task.");
      return;
    }

    if (newStatus === "in_progress") {
      await saveSystemUpdate(taskId, "Task started");
    }

    if (newStatus === "completed") {
      await saveSystemUpdate(taskId, "Task completed");
    }

    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.id === taskId ? { ...task, ...updatesData } : task
      )
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) await fetchTaskUpdates(user.id);
  }

  async function submitTaskUpdate(taskId) {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      alert("Failed to load user.");
      return;
    }

    const comment = commentInputs[taskId] || "";
    const photoFile = photoInputs[taskId];

    if (!comment.trim() && !photoFile) {
      alert("Please add a comment or photo.");
      return;
    }

    setUploadingTaskId(taskId);

    let photoUrl = null;

    if (photoFile) {
      if (photoFile.size > 5 * 1024 * 1024) {
        alert("File too large. Please upload image under 5MB.");
        setUploadingTaskId(null);
        return;
      }

      const fileExt = photoFile.name.split(".").pop();
      const fileName = `${taskId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("task-photos")
        .upload(fileName, photoFile);

      if (uploadError) {
        console.error("Photo upload error:", uploadError);
        alert("Failed to upload photo.");
        setUploadingTaskId(null);
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from("task-photos")
        .getPublicUrl(fileName);

      photoUrl = publicUrlData.publicUrl;
    }

    const location = await getCurrentLocation();

    const { error } = await supabase.from("task_updates").insert({
      task_id: taskId,
      user_id: user.id,
      user_email: user.email,
      comment: comment.trim(),
      photo_url: photoUrl,
      latitude: location.latitude,
      longitude: location.longitude,
    });

    if (error) {
      console.error("Task update error:", error);
      alert("Failed to save update.");
      setUploadingTaskId(null);
      return;
    }

    const nextComments = { ...commentInputs, [taskId]: "" };
    setCommentInputs(nextComments);
    localStorage.setItem("feCommentInputs", JSON.stringify(nextComments));

    setPhotoInputs((prev) => ({ ...prev, [taskId]: null }));
    setMessage("Update saved.");

    await fetchTaskUpdates(user.id);
    setUploadingTaskId(null);
  }

  function getStatusColor(status) {
    if (status === "completed") return "#43ff9a";
    if (status === "in_progress") return "#00d4ff";
    if (status === "assigned") return "#ffd66b";
    return "#9fb2cf";
  }

  function getPriorityColor(priority) {
    if (priority === "urgent") return "#ff5c7a";
    if (priority === "high") return "#ff9f43";
    if (priority === "low") return "#9fb2cf";
    return "#e7eefb";
  }

  function formatStatus(status) {
    if (status === "assigned") return "Assigned";
    if (status === "in_progress") return "In Progress";
    if (status === "completed") return "Completed";
    return status || "Unknown";
  }

  return (
    <div className="fe-page">
      <h2 className="fe-title">🚙 Field Engineer Dashboard</h2>

      {message && <p className="fe-message">{message}</p>}

      {tasks.length === 0 ? (
        <p>No assigned tasks.</p>
      ) : (
        tasks.map((task) => (
          <div key={task.id} className="fe-task-card">
            <h3>
              {task.projects?.name} - {task.market} - {task.target_name}
            </h3>

            <p>
              <b>Project:</b> {task.projects?.name || "Missing Project"}
            </p>

            <p>
              <b>Market:</b> {task.market || task.projects?.market || "N/A"}
            </p>

            <p>
              <b>Target:</b> {task.target_type || "N/A"} -{" "}
              {task.target_name || "N/A"}
            </p>

            <p>
              <b>Test Scope:</b>{" "}
              <span style={{ color: "#00d4ff" }}>
                {task.test_type || "N/A"}
              </span>
            </p>

            <p>
              <b>Priority:</b>{" "}
              <span
                style={{
                  color: getPriorityColor(task.priority),
                  fontWeight: "bold",
                }}
              >
                {task.priority || "normal"}
              </span>
            </p>

            <p>
              <b>Due:</b>{" "}
              {task.due_date ? new Date(task.due_date).toLocaleString() : "N/A"}
            </p>

            <p>
              <b>Notes:</b> {task.notes || "N/A"}
            </p>

            <p>
              <b>Status:</b>{" "}
              <span
                style={{
                  color: getStatusColor(task.status),
                  fontWeight: "bold",
                }}
              >
                {formatStatus(task.status)}
              </span>
            </p>

            {task.started_at && (
              <p>Started: {new Date(task.started_at).toLocaleString()}</p>
            )}

            {task.completed_at && (
              <p>Completed: {new Date(task.completed_at).toLocaleString()}</p>
            )}

            <div className="fe-button-row">
              {task.status === "assigned" && (
                <button onClick={() => updateTaskStatus(task.id, "in_progress")}>
                  Start
                </button>
              )}

              {task.status === "in_progress" && (
                <button onClick={() => updateTaskStatus(task.id, "completed")}>
                  Complete
                </button>
              )}

              {task.status === "completed" && (
                <div className="fe-done">✅ Done</div>
              )}
            </div>

            {task.status === "assigned" && (
              <p className="fe-muted">
                GPS tracking will start after you click Start.
              </p>
            )}

            {task.status === "in_progress" && (
              <>
                <hr />
                <h4>Live GPS Map</h4>
                <FELiveGpsMap />
              </>
            )}

            {task.status === "completed" && (
				<>
					<p className="fe-done">
						GPS tracking stopped because this task is completed.
					</p>

					<p className="fe-late-update-note">
						⚠️ You can still add updates if you were offline during execution.
					</p>
				</>
			)}

            <hr />

            <h4>FE Update</h4>

            <textarea
              placeholder="Add comment / issue / field note"
              value={commentInputs[task.id] || ""}
              onChange={(e) =>
                setCommentInputs((prev) => ({
                  ...prev,
                  [task.id]: e.target.value,
                }))
              }
            />

            <br />
            <br />

            <input
              type="file"
              accept="image/*"
              onChange={(e) =>
                setPhotoInputs((prev) => ({
                  ...prev,
                  [task.id]: e.target.files[0],
                }))
              }
            />

            <br />
            <br />

            <button
              onClick={() => submitTaskUpdate(task.id)}
              disabled={uploadingTaskId === task.id}
            >
              {uploadingTaskId === task.id
				? "Uploading..."
				: task.status === "completed"
				? "Submit Final Update"
				: "Submit Update"}
            </button>

            <h4>Previous Updates</h4>

            {(updates[task.id] || []).length === 0 ? (
              <p>No updates yet.</p>
            ) : (
              updates[task.id].slice(0, 10).map((update) => (
                <div key={update.id} className="fe-update-history-card">
                  <p>
                    <b>Time:</b> {new Date(update.created_at).toLocaleString()}
                  </p>

                  {update.comment && (
                    <p>
                      <b>💬 Comment:</b> {update.comment}
                    </p>
                  )}

                  {update.latitude && update.longitude && (
                    <p>
                      <b>📍 Location:</b>{" "}
                      {Number(update.latitude).toFixed(5)},{" "}
                      {Number(update.longitude).toFixed(5)}
                      <br />
                      <a
                        href={`https://www.google.com/maps?q=${update.latitude},${update.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in Google Maps
                      </a>
                    </p>
                  )}

                  {update.photo_url && (
                    <img
                      src={update.photo_url}
                      alt="Task update"
                      className="fe-update-photo"
                      onClick={() => window.open(update.photo_url, "_blank")}
                    />
                  )}
                </div>
              ))
            )}
          </div>
        ))
      )}
    </div>
  );
}