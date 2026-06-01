import { formatGpsPoint, formatGpsTime } from "./mobileGps";

export default function MobileGpsPanel({
  task,
  isInProcess,
  isOnHold = false,
  isCompleted,
  latestGpsUpdate,
  lastGpsLocation,
  gpsStatusMessage,
  gpsChecking,
  gpsTrackingTaskId,
  onRefreshGpsNow,
  onSaveGpsPointForTask,
}) {
  return (
    <div className="bd-mobile-gps-panel">
      <div className="bd-mobile-gps-head">
        <div>
          <h4>GPS Tracking</h4>
          <p>
            {isInProcess
              ? "Auto GPS tracking runs every 30 seconds for map/trail. Use checkpoint for important locations."
              : isOnHold
                ? "Task is on hold. GPS is paused until the task is resumed."
                : isCompleted
                  ? "Task is completed. Last GPS points remain available for evidence."
                  : "Start task to enable live GPS tracking."}
          </p>
        </div>
        <span>{isInProcess ? "Live" : isOnHold ? "On Hold" : isCompleted ? "Closed" : "Standby"}</span>
      </div>

      <div className="bd-mobile-gps-grid">
        <div>
          <span>Device GPS</span>
          <strong>{formatGpsPoint(lastGpsLocation)}</strong>
        </div>

        <div>
          <span>Last Saved</span>
          <strong>{formatGpsTime(lastGpsLocation?.cached_at)}</strong>
        </div>

        <div>
          <span>Task GPS</span>
          <strong>
            {latestGpsUpdate
              ? `${Number(latestGpsUpdate.latitude).toFixed(5)}, ${Number(latestGpsUpdate.longitude).toFixed(5)}`
              : "No point yet"}
          </strong>
        </div>

        <div>
          <span>Accuracy</span>
          <strong>{lastGpsLocation?.accuracy ? `±${Math.round(lastGpsLocation.accuracy)}m` : "N/A"}</strong>
        </div>
      </div>

      <p className="bd-mobile-gps-status">{gpsStatusMessage}</p>

      <div className="bd-mobile-gps-actions">
        <button
          type="button"
          className="bd-mobile-secondary"
          disabled={gpsChecking || gpsTrackingTaskId === task.id}
          onClick={() => onRefreshGpsNow()}
        >
          {gpsChecking ? "Checking GPS..." : "Refresh GPS"}
        </button>

        <button
          type="button"
          className="bd-mobile-primary"
          disabled={!isInProcess || gpsTrackingTaskId === task.id}
          onClick={() => onSaveGpsPointForTask(task, "GPS Checkpoint")}
        >
          {gpsTrackingTaskId === task.id ? "Saving GPS..." : "Save GPS Checkpoint"}
        </button>
      </div>

      {lastGpsLocation && (
        <button
          type="button"
          className="bd-mobile-map-link"
          onClick={() => window.open(`https://www.google.com/maps?q=${lastGpsLocation.latitude},${lastGpsLocation.longitude}`, "_blank", "noopener,noreferrer")}
        >
          Open Last GPS in Map
        </button>
      )}
    </div>
  );
}
