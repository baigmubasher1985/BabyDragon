function MobileFilterButton({ label, value, count, taskFilter, onFilterChange }) {
  const isActive = taskFilter === value;

  return (
    <button
      type="button"
      className={isActive ? "bd-mobile-filter active" : "bd-mobile-filter"}
      onClick={() => onFilterChange(value)}
    >
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
  );
}

function formatQueueType(type) {
  const label = String(type || "pending")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .trim();

  return label ? label.replace(/\b\w/g, (char) => char.toUpperCase()) : "Pending Item";
}

export default function MobileSyncStatus({
  user,
  assignedOnlyCount,
  inProcessCount,
  onHoldCount = 0,
  completedCount,
  allCount,
  error,
  syncMessage,
  taskFilter,
  taskLoading,
  isOnline,
  pendingSyncCount,
  pendingSyncItems,
  syncingPending,
  showTaskFilters = false,
  onFilterChange,
  onSyncNow,
}) {
  const statusText = isOnline ? "Online" : "Offline";

  return (
    <>
      <section className="bd-mobile-status-row bd-mobile-status-row-clean">
        <div className="bd-mobile-pill bd-mobile-fe-pill">
          FE: <strong>{user?.email}</strong>
        </div>
      </section>

      <section className={`bd-mobile-sync-panel ${isOnline ? "online" : "offline"}`}>
        <div>
          <span>{statusText}</span>
          <strong>Pending Sync: {pendingSyncCount}</strong>
          <p>
            {pendingSyncCount > 0
              ? "Queued field changes are stored on this device until Sync Now is successful."
              : "No pending field changes are waiting on this device."}
          </p>
        </div>

        <button type="button" onClick={onSyncNow} disabled={taskLoading || syncingPending || (!isOnline && pendingSyncCount === 0)}>
          {syncingPending ? "Syncing..." : pendingSyncCount > 0 ? "Sync Pending Now" : "Refresh"}
        </button>
      </section>

      {pendingSyncItems.length > 0 && (
        <section className="bd-mobile-queue-list">
          <div>
            <strong>Offline Queue</strong>
            <span>{pendingSyncItems.length} pending</span>
          </div>

          {pendingSyncItems.slice(0, 4).map((item) => (
            <p key={item.id}>
              {formatQueueType(item.type)} • {item.created_at ? new Date(item.created_at).toLocaleString() : "queued"}
            </p>
          ))}

          {pendingSyncItems.length > 4 && <small>{pendingSyncItems.length - 4} more item(s) hidden.</small>}
        </section>
      )}

      {showTaskFilters && (
        <section className="bd-mobile-filter-row bd-mobile-filter-row-v7">
          <MobileFilterButton label="Assigned" value="assigned" count={assignedOnlyCount} taskFilter={taskFilter} onFilterChange={onFilterChange} />
          <MobileFilterButton label="In-Progress" value="in_process" count={inProcessCount} taskFilter={taskFilter} onFilterChange={onFilterChange} />
          <MobileFilterButton label="On-Hold" value="on_hold" count={onHoldCount} taskFilter={taskFilter} onFilterChange={onFilterChange} />
          <MobileFilterButton label="Completed" value="completed" count={completedCount} taskFilter={taskFilter} onFilterChange={onFilterChange} />
          <MobileFilterButton label="All" value="all" count={allCount} taskFilter={taskFilter} onFilterChange={onFilterChange} />
        </section>
      )}

      {error && <div className="bd-mobile-alert">{error}</div>}
      {syncMessage && <div className="bd-mobile-success">{syncMessage}</div>}
    </>
  );
}
