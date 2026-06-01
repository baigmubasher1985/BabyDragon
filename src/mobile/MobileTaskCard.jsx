import {
  buildGoogleMapsUrl,
  formatShortDate,
  formatTaskStatusLabel,
  getChecklistStats,
  getEvidenceStats,
  getLatestTaskGpsUpdate,
  getTaskCoordinates,
  getTaskDueDateRaw,
  getTaskGrid,
  getTaskIssues,
  getTaskMarket,
  getTaskNotesPreview,
  getTaskPriority,
  getTaskReference,
  getTaskRouteName,
  getTaskScope,
  getTaskStatus,
  getTaskTitle,
  getTargetType,
  isAssignedTask,
  isCompletedTask,
  isInProcessTask,
  isOnHoldTask,
  normalizePriorityClass,
  normalizeStatusClass,
} from "./mobileHelpers";
import MobileTaskDetails from "./MobileTaskDetails";

export default function MobileTaskCard({
  task,
  user,
  isOpen,
  actionLoadingTaskId,
  checklistLoadingTaskId,
  issueLoadingTaskId,
  taskUpdateLoadingTaskId,
  gpsChecking,
  gpsTrackingTaskId,
  lastGpsLocation,
  gpsStatusMessage,
  issueInputsByTask,
  updateInputsByTask,
  photoInputsByTask,
  onToggleDetails,
  onOpenNavigation,
  onUpdateTaskStatus,
  onUpdateChecklistItem,
  onUpdateIssueInput,
  onSubmitIssueReport,
  onUpdateTaskUpdateInput,
  onUpdateTaskPhotoInput,
  onSubmitTaskUpdate,
  onRefreshGpsNow,
  onSaveGpsPointForTask,
}) {
  const status = getTaskStatus(task);
  const statusLabel = formatTaskStatusLabel(status);
  const statusClass = normalizeStatusClass(status);
  const priority = getTaskPriority(task);
  const priorityClass = normalizePriorityClass(priority);
  const dueDateRaw = getTaskDueDateRaw(task);
  const navUrl = buildGoogleMapsUrl(task);
  const isAssigned = isAssignedTask(task);
  const isInProcess = isInProcessTask(task);
  const isOnHold = isOnHoldTask(task);
  const isCompleted = isCompletedTask(task);
  const isActionLoading = actionLoadingTaskId === task.id;
  const checklistStats = getChecklistStats(task);
  const taskIssues = getTaskIssues(task);
  const evidenceStats = getEvidenceStats(task);
  const latestGpsUpdate = getLatestTaskGpsUpdate(task);
  const assignmentNotesPreview = getTaskNotesPreview(task);
  const canNavigate = Boolean(navUrl);

  return (
    <article className={`bd-mobile-task-card bd-mobile-task-card-v7 bd-task-state-${statusClass}`}>
      <div className="bd-mobile-task-v7-head">
        <div>
          <p className="bd-mobile-eyebrow">{getTaskMarket(task)} • {getTargetType(task)}</p>
          <h2>{getTaskTitle(task)}</h2>
          <small>{getTaskScope(task)}</small>
        </div>
        <span className={`bd-mobile-status bd-status-${statusClass}`}>{statusLabel}</span>
      </div>

      <div className="bd-mobile-task-v7-meta">
        <div>
          <span>Grid</span>
          <strong>{getTaskGrid(task)}</strong>
        </div>
        <div>
          <span>Route</span>
          <strong>{getTaskRouteName(task)}</strong>
        </div>
        <div>
          <span>Due</span>
          <strong>{formatShortDate(dueDateRaw)}</strong>
        </div>
        <div>
          <span>Priority</span>
          <strong className={`bd-priority-text bd-priority-${priorityClass}`}>{priority}</strong>
        </div>
      </div>

      {assignmentNotesPreview && (
        <div className="bd-mobile-note-box bd-mobile-note-box-compact">
          <span>Notes</span>
          <p>{assignmentNotesPreview}</p>
        </div>
      )}

      <div className="bd-mobile-task-v7-readiness">
        <div>
          <span>Checklist</span>
          <strong>{checklistStats.completed}/{checklistStats.total}</strong>
          <div className="bd-mobile-progress"><div style={{ width: `${checklistStats.percent}%` }} /></div>
        </div>
        <div>
          <span>Issues</span>
          <strong>{taskIssues.length}</strong>
        </div>
        <div>
          <span>Evidence</span>
          <strong>{evidenceStats.total}</strong>
        </div>
        <div>
          <span>GPS</span>
          <strong>{latestGpsUpdate ? "Saved" : "No GPS"}</strong>
        </div>
      </div>

      <div className="bd-mobile-task-v7-actions">
        {isAssigned && (
          <button
            type="button"
            className="bd-mobile-start"
            disabled={isActionLoading}
            onClick={() => onUpdateTaskStatus(task, "in_progress")}
          >
            {isActionLoading ? "Starting..." : "Start Task"}
          </button>
        )}

        {isInProcess && (
          <>
            <button
              type="button"
              className="bd-mobile-hold"
              disabled={isActionLoading}
              onClick={() => onUpdateTaskStatus(task, "on_hold")}
            >
              {isActionLoading ? "Saving..." : "Put On-Hold"}
            </button>
            <button
              type="button"
              className="bd-mobile-complete"
              disabled={isActionLoading}
              onClick={() => onUpdateTaskStatus(task, "completed")}
            >
              {isActionLoading ? "Completing..." : "Complete Task"}
            </button>
          </>
        )}

        {isOnHold && (
          <button
            type="button"
            className="bd-mobile-start"
            disabled={isActionLoading}
            onClick={() => onUpdateTaskStatus(task, "in_progress")}
          >
            {isActionLoading ? "Resuming..." : "Resume Task"}
          </button>
        )}

        <button
          type="button"
          className="bd-mobile-secondary"
          onClick={() => onToggleDetails(task.id)}
        >
          {isOpen ? "Hide Details" : isCompleted ? "View Summary" : "Open Task"}
        </button>

        <button
          type="button"
          className="bd-mobile-primary"
          onClick={() => onOpenNavigation(task)}
          disabled={!canNavigate}
          title={canNavigate ? "Open Google Maps navigation" : "Task, grid, or saved route does not have coordinates yet"}
        >
          Navigate
        </button>
      </div>

      {!canNavigate && !isCompleted && (
        <div className="bd-mobile-mini-warning bd-mobile-mini-warning-compact">
          Navigation will activate when this task has route or grid coordinates.
        </div>
      )}

      {isOpen && (
        <MobileTaskDetails
          task={task}
          user={user}
          navUrl={navUrl}
          coords={getTaskCoordinates(task)}
          checklistLoadingTaskId={checklistLoadingTaskId}
          issueLoadingTaskId={issueLoadingTaskId}
          taskUpdateLoadingTaskId={taskUpdateLoadingTaskId}
          gpsChecking={gpsChecking}
          gpsTrackingTaskId={gpsTrackingTaskId}
          lastGpsLocation={lastGpsLocation}
          gpsStatusMessage={gpsStatusMessage}
          issueInputsByTask={issueInputsByTask}
          updateInputsByTask={updateInputsByTask}
          photoInputsByTask={photoInputsByTask}
          onUpdateChecklistItem={onUpdateChecklistItem}
          onUpdateIssueInput={onUpdateIssueInput}
          onSubmitIssueReport={onSubmitIssueReport}
          onUpdateTaskUpdateInput={onUpdateTaskUpdateInput}
          onUpdateTaskPhotoInput={onUpdateTaskPhotoInput}
          onSubmitTaskUpdate={onSubmitTaskUpdate}
          onRefreshGpsNow={onRefreshGpsNow}
          onSaveGpsPointForTask={onSaveGpsPointForTask}
        />
      )}
    </article>
  );
}
