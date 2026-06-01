import { ISSUE_SEVERITIES, ISSUE_TYPES } from "./mobileConstants";
import { formatIssueStatus, formatSeverity } from "./mobileHelpers";

export default function MobileIssueReport({
  task,
  isInProcess,
  isOnHold,
  isCompleted,
  taskIssues,
  taskUpdates,
  evidenceStats,
  issueInput,
  selectedPhoto,
  isIssueSaving,
  onIssueInputChange,
  onPhotoChange,
  onSubmitIssueReport,
}) {
  const canSubmitIssue = (isInProcess || isOnHold) && !isIssueSaving;
  const galleryInputId = `bd-issue-gallery-${task?.id || "task"}`;
  const cameraInputId = `bd-issue-camera-${task?.id || "task"}`;
  const recentUpdates = Array.isArray(taskUpdates) ? taskUpdates.slice(0, 5) : [];
  const issueCount = Array.isArray(taskIssues) ? taskIssues.length : 0;
  const updateCount = evidenceStats?.total ?? recentUpdates.length;

  function handlePhotoPicked(event) {
    const file = event.target.files?.[0] || null;
    onPhotoChange(task.id, file);
    event.target.value = "";
  }

  return (
    <div className="bd-mobile-issue-panel bd-mobile-unified-report-panel">
      <div className="bd-mobile-issue-head bd-mobile-unified-report-head">
        <div>
          <p className="bd-mobile-eyebrow">Issue / Evidence</p>
          <h4>Report Field Issue</h4>
          <p>Add the issue note, photo evidence, and GPS coordinates in one place.</p>
        </div>
        <span>{issueCount} Issue{issueCount === 1 ? "" : "s"}</span>
      </div>

      <div className="bd-mobile-report-gps-note">
        <strong>GPS attached automatically</strong>
        <span>Coordinates are captured when you submit the issue or photo.</span>
      </div>

      {!canSubmitIssue && (
        <div className="bd-mobile-mini-warning">
          {isCompleted
            ? "Completed tasks are read-only for new issue/evidence reports."
            : "Start or resume the task before submitting issue/evidence reports."}
        </div>
      )}

      <div className="bd-mobile-issue-grid">
        <label>
          Issue Type
          <select
            value={issueInput.issue_type}
            disabled={!canSubmitIssue}
            onChange={(event) => onIssueInputChange(task.id, "issue_type", event.target.value)}
          >
            {ISSUE_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>

        <label>
          Severity
          <select
            value={issueInput.severity}
            disabled={!canSubmitIssue}
            onChange={(event) => onIssueInputChange(task.id, "severity", event.target.value)}
          >
            {ISSUE_SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>{formatSeverity(severity)}</option>
            ))}
          </select>
        </label>
      </div>

      <textarea
        value={issueInput.description}
        disabled={!canSubmitIssue}
        placeholder="Example: Access blocked by private road. Photo attached. Need alternate route or re-drive."
        onChange={(event) => onIssueInputChange(task.id, "description", event.target.value)}
      />

      <div className="bd-mobile-evidence-picker-v7c">
        <div>
          <strong>Evidence Photo</strong>
          <span>{selectedPhoto ? selectedPhoto.name : "No photo selected"}</span>
        </div>

        <div className="bd-mobile-evidence-actions-v7c">
          <label className={`bd-mobile-evidence-action-v7c ${!canSubmitIssue ? "is-disabled" : ""}`} htmlFor={galleryInputId}>
            Add Picture
          </label>
          <label className={`bd-mobile-evidence-action-v7c camera ${!canSubmitIssue ? "is-disabled" : ""}`} htmlFor={cameraInputId}>
            Take Picture
          </label>
        </div>

        <input
          id={galleryInputId}
          type="file"
          accept="image/*"
          disabled={!canSubmitIssue}
          onChange={handlePhotoPicked}
        />

        <input
          id={cameraInputId}
          type="file"
          accept="image/*"
          capture="environment"
          disabled={!canSubmitIssue}
          onChange={handlePhotoPicked}
        />
      </div>

      <button
        type="button"
        className="bd-mobile-issue-submit"
        disabled={!canSubmitIssue}
        onClick={() => onSubmitIssueReport(task, selectedPhoto)}
      >
        {isIssueSaving ? "Saving Issue / Evidence..." : "Submit Issue / Evidence"}
      </button>

      {(issueCount > 0 || updateCount > 0) && (
        <div className="bd-mobile-report-history-v7c">
          {issueCount > 0 && (
            <div className="bd-mobile-report-history-section-v7c">
              <h5>Recent Issues</h5>
              <div className="bd-mobile-issue-list">
                {taskIssues.slice(0, 5).map((issue) => (
                  <div key={issue.id} className="bd-mobile-issue-card">
                    <div>
                      <strong>{issue.issue_type || "Issue"}</strong>
                      <span>{formatSeverity(issue.severity)} • {issue._pending_sync ? "Pending Sync" : formatIssueStatus(issue.status)}</span>
                    </div>

                    {issue.description && <p>{issue.description}</p>}

                    <small>
                      {issue.created_at ? new Date(issue.created_at).toLocaleString() : "Time not available"}
                      {issue.lat && issue.lon ? ` • ${Number(issue.lat).toFixed(5)}, ${Number(issue.lon).toFixed(5)}` : ""}
                    </small>
                  </div>
                ))}
              </div>
            </div>
          )}

          {recentUpdates.length > 0 && (
            <div className="bd-mobile-report-history-section-v7c">
              <h5>Recent Evidence</h5>
              <div className="bd-mobile-update-list">
                {recentUpdates.map((update) => (
                  <div key={update.id} className="bd-mobile-update-card">
                    <div>
                      <strong>
                        {update._pending_sync
                          ? update._queued_photo_name
                            ? "Queued Photo Evidence"
                            : "Queued Field Note"
                          : update.photo_url
                            ? "Photo Evidence"
                            : "Field Note"}
                      </strong>
                      <span>{update.created_at ? new Date(update.created_at).toLocaleString() : "Time not available"}</span>
                    </div>

                    {update.comment && <p>{update.comment}</p>}

                    {update.latitude && update.longitude && (
                      <small>
                        GPS: {Number(update.latitude).toFixed(5)}, {Number(update.longitude).toFixed(5)}
                      </small>
                    )}

                    {update._pending_sync && <small>Pending Sync Now</small>}

                    {update._queued_photo_name && !update.photo_url && (
                      <small>Photo queued: {update._queued_photo_name}</small>
                    )}

                    {update.photo_url && (
                      <button
                        type="button"
                        className="bd-mobile-photo-link"
                        onClick={() => window.open(update.photo_url, "_blank", "noopener,noreferrer")}
                      >
                        Open Photo
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
