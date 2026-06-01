import { useMemo, useState } from "react";
import MobileSyncStatus from "./MobileSyncStatus";
import MobileTaskCard from "./MobileTaskCard";

function TaskGroup({
  label,
  hint,
  tasks,
  emptyText,
  defaultOpen = true,
  isCollapsible = false,
  selectedTaskId,
  commonCardProps,
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const count = tasks.length;

  if (!isCollapsible && count === 0) return null;

  return (
    <section className="bd-mobile-task-group">
      <button
        type="button"
        className="bd-mobile-task-group-head"
        onClick={() => isCollapsible && setIsOpen((current) => !current)}
      >
        <div>
          <span>{label}</span>
          <p>{hint}</p>
        </div>
        <strong>{count}</strong>
      </button>

      {isCollapsible && !isOpen && count > 0 && (
        <button type="button" className="bd-mobile-show-completed" onClick={() => setIsOpen(true)}>
          Show Completed Tasks
        </button>
      )}

      {isOpen && count === 0 && (
        <div className="bd-mobile-empty-slim">{emptyText}</div>
      )}

      {isOpen && count > 0 && (
        <div className="bd-mobile-task-list bd-mobile-task-list-v7">
          {tasks.map((task) => (
            <MobileTaskCard
              key={task.id}
              task={task}
              isOpen={selectedTaskId === task.id}
              {...commonCardProps}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function MobileMyTasks({
  user,
  assignedOnlyTasks,
  inProcessTasks,
  onHoldTasks = [],
  completedTasks,
  activeFieldTasks = [],
  assignedTasks,
  taskLoading,
  error,
  syncMessage,
  taskFilter,
  selectedTaskId,
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
  isOnline,
  pendingSyncCount,
  pendingSyncItems,
  syncingPending,
  onSyncNow,
  onFilterChange,
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
  const commonCardProps = useMemo(
    () => ({
      user,
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
    }),
    [
      user,
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
    ]
  );

  const activeCount = activeFieldTasks.length || assignedOnlyTasks.length + inProcessTasks.length + onHoldTasks.length;

  return (
    <section className="bd-mobile-my-tasks-view bd-mobile-my-tasks-v7">
      <MobileSyncStatus
        user={user}
        assignedOnlyCount={assignedOnlyTasks.length}
        inProcessCount={inProcessTasks.length}
        onHoldCount={onHoldTasks.length}
        completedCount={completedTasks.length}
        allCount={assignedTasks.length}
        error={error}
        syncMessage={syncMessage}
        taskFilter={taskFilter}
        taskLoading={taskLoading}
        isOnline={isOnline}
        pendingSyncCount={pendingSyncCount}
        pendingSyncItems={pendingSyncItems}
        syncingPending={syncingPending}
        showTaskFilters={false}
        onFilterChange={onFilterChange}
        onSyncNow={onSyncNow}
      />

      <section className="bd-mobile-work-stats">
        <button type="button" onClick={() => onFilterChange?.("assigned")} className={taskFilter === "assigned" ? "active" : ""}>
          <span>Assigned</span>
          <strong>{assignedOnlyTasks.length}</strong>
        </button>
        <button type="button" onClick={() => onFilterChange?.("in_process")} className={taskFilter === "in_process" ? "active" : ""}>
          <span>In Progress</span>
          <strong>{inProcessTasks.length}</strong>
        </button>
        <button type="button" onClick={() => onFilterChange?.("on_hold")} className={taskFilter === "on_hold" ? "active" : ""}>
          <span>On Hold</span>
          <strong>{onHoldTasks.length}</strong>
        </button>
        <button type="button" onClick={() => onFilterChange?.("completed")} className={taskFilter === "completed" ? "active" : ""}>
          <span>Completed</span>
          <strong>{completedTasks.length}</strong>
        </button>
      </section>

      {taskLoading && (
        <section className="bd-mobile-card bd-mobile-center">
          <div className="bd-mobile-loader" />
          <p>Loading assigned tasks...</p>
        </section>
      )}

      {!taskLoading && assignedTasks.length === 0 && (
        <section className="bd-mobile-card bd-mobile-center">
          <h2>No tasks assigned</h2>
          <p className="bd-mobile-muted">Confirm this FE has assigned tasks in the web dashboard.</p>
        </section>
      )}

      {!taskLoading && assignedTasks.length > 0 && activeCount === 0 && (
        <section className="bd-mobile-card bd-mobile-center">
          <h2>No active field tasks</h2>
          <p className="bd-mobile-muted">Assigned, in-progress, and on-hold work will appear here. Completed tasks are available below.</p>
        </section>
      )}

      {!taskLoading && (
        <>
          <TaskGroup
            label="Assigned"
            hint="New work waiting for FE start."
            tasks={assignedOnlyTasks}
            selectedTaskId={selectedTaskId}
            commonCardProps={commonCardProps}
          />

          <TaskGroup
            label="In Progress"
            hint="Active work currently being driven."
            tasks={inProcessTasks}
            selectedTaskId={selectedTaskId}
            commonCardProps={commonCardProps}
          />

          <TaskGroup
            label="On Hold"
            hint="Paused work, blocked access, weather delay, or multi-day cluster."
            tasks={onHoldTasks}
            selectedTaskId={selectedTaskId}
            commonCardProps={commonCardProps}
          />

          <TaskGroup
            label="Completed"
            hint="Finished tasks. Hidden by default so active work stays clean."
            tasks={completedTasks}
            emptyText="No completed tasks yet."
            defaultOpen={false}
            isCollapsible
            selectedTaskId={selectedTaskId}
            commonCardProps={commonCardProps}
          />
        </>
      )}
    </section>
  );
}
