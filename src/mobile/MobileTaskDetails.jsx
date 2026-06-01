import { getDefaultIssueInput } from "./mobileConstants";
import {
  formatDateTime,
  formatTaskStatusLabel,
  getChecklistState,
  getChecklistStats,
  getEvidenceStats,
  getLatestTaskGpsUpdate,
  getTaskCoordinates,
  getTaskDueDateRaw,
  getTaskGrid,
  getTaskIssues,
  getTaskMarket,
  getTaskNotes,
  getTaskPriority,
  getTaskProjectName,
  getTaskReference,
  getTaskRouteName,
  getTaskScope,
  getTaskStatus,
  getTaskTestingType,
  getTaskTitle,
  getTargetName,
  getTargetType,
  isAssignedTask,
  isCompletedTask,
  isInProcessTask,
  isOnHoldTask,
} from "./mobileHelpers";
import MobileChecklist from "./MobileChecklist";
import MobileGpsPanel from "./MobileGpsPanel";
import MobileIssueReport from "./MobileIssueReport";

export default function MobileTaskDetails({
  task,
  user,
  navUrl,
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
  const dueDateRaw = getTaskDueDateRaw(task);
  const coords = getTaskCoordinates(task);
  const isAssigned = isAssignedTask(task);
  const isInProcess = isInProcessTask(task);
  const isOnHold = isOnHoldTask(task);
  const isCompleted = isCompletedTask(task);
  const checklistState = getChecklistState(task);
  const checklistStats = getChecklistStats(task);
  const taskIssues = getTaskIssues(task);
  const issueInput = { ...getDefaultIssueInput(), ...(issueInputsByTask[task.id] || {}) };
  const taskUpdates = task?._mobileTaskUpdates || [];
  const latestGpsUpdate = getLatestTaskGpsUpdate(task);
  const evidenceStats = getEvidenceStats(task);
  const selectedPhoto = photoInputsByTask[task.id] || null;
  const isChecklistSaving = checklistLoadingTaskId === task.id;
  const isIssueSaving = issueLoadingTaskId === task.id;
  const assignmentNotes = getTaskNotes(task);

  return (
    <div className="bd-mobile-task-details bd-mobile-task-details-v7">
      <div className="bd-mobile-detail-hero">
        <p className="bd-mobile-eyebrow">Task Workspace</p>
        <h3>{getTaskTitle(task)}</h3>
        <span>{formatTaskStatusLabel(status)}</span>
      </div>

      <div className="bd-mobile-detail-grid-v7">
        <div><span>Task Ref</span><strong>{getTaskReference(task)}</strong></div>
        <div><span>Project</span><strong>{getTaskProjectName(task) || "Not set"}</strong></div>
        <div><span>Market</span><strong>{getTaskMarket(task)}</strong></div>
        <div><span>Testing</span><strong>{getTaskTestingType(task)}</strong></div>
        <div><span>Target</span><strong>{getTargetType(task)} • {getTargetName(task)}</strong></div>
        <div><span>Scope</span><strong>{getTaskScope(task)}</strong></div>
        <div><span>Grid</span><strong>{getTaskGrid(task)}</strong></div>
        <div><span>Route</span><strong>{getTaskRouteName(task)}</strong></div>
        <div><span>Priority</span><strong>{getTaskPriority(task)}</strong></div>
        <div><span>Due</span><strong>{formatDateTime(dueDateRaw)}</strong></div>
      </div>

      {assignmentNotes && (
        <div className="bd-mobile-detail-section bd-mobile-notes-detail">
          <h4>Assignment Notes</h4>
          <p>{assignmentNotes}</p>
        </div>
      )}

      {coords ? (
        <div className="bd-mobile-gps-coordinate-chip">
          Navigation point: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
        </div>
      ) : !navUrl ? (
        <div className="bd-mobile-mini-warning">
          Navigation will activate after this task has saved route coordinates or a valid grid center.
        </div>
      ) : null}

      <MobileGpsPanel
        task={task}
        isInProcess={isInProcess}
        isOnHold={isOnHold}
        isCompleted={isCompleted}
        latestGpsUpdate={latestGpsUpdate}
        lastGpsLocation={lastGpsLocation}
        gpsStatusMessage={gpsStatusMessage}
        gpsChecking={gpsChecking}
        gpsTrackingTaskId={gpsTrackingTaskId}
        onRefreshGpsNow={onRefreshGpsNow}
        onSaveGpsPointForTask={onSaveGpsPointForTask}
      />

      <MobileChecklist
        task={task}
        checklistState={checklistState}
        checklistStats={checklistStats}
        isAssigned={isAssigned}
        isInProcess={isInProcess}
        isOnHold={isOnHold}
        isCompleted={isCompleted}
        isChecklistSaving={isChecklistSaving}
        onUpdateChecklistItem={onUpdateChecklistItem}
      />

      <MobileIssueReport
        task={task}
        isInProcess={isInProcess}
        isOnHold={isOnHold}
        isCompleted={isCompleted}
        taskIssues={taskIssues}
        taskUpdates={taskUpdates}
        evidenceStats={evidenceStats}
        issueInput={issueInput}
        selectedPhoto={selectedPhoto}
        isIssueSaving={isIssueSaving}
        onIssueInputChange={onUpdateIssueInput}
        onPhotoChange={onUpdateTaskPhotoInput}
        onSubmitIssueReport={onSubmitIssueReport}
      />
    </div>
  );
}
