export default function MobileNotesEvidence({
  task,
  isAssigned,
  isOnHold,
  isCompleted,
  evidenceStats,
  taskUpdates,
  updateText,
  selectedPhoto,
  isUpdateSaving,
  canSubmitUpdate,
  onUpdateTextChange,
  onPhotoChange,
  onSubmitTaskUpdate,
}) {
  return (
    <div className="bd-mobile-update-panel">
      <div className="bd-mobile-update-head">
        <div>
          <h4>Notes / Photo Evidence</h4>
          <p>Add field notes, handoff notes, proof photos, or final evidence.</p>
        </div>
        <span>{evidenceStats.total} Update{evidenceStats.total === 1 ? "" : "s"}</span>
      </div>

      {isAssigned && (
        <div className="bd-mobile-mini-warning">
          Start the task before adding field notes or photo evidence.
        </div>
      )}

      {isOnHold && (
        <div className="bd-mobile-mini-warning">
          Task is on hold. Add the reason/photo here, then resume when work continues.
        </div>
      )}

      <textarea
        value={updateText}
        disabled={!canSubmitUpdate}
        placeholder="Example: Completed sector 1. Logs handed to team. Photo attached for evidence."
        onChange={(event) => onUpdateTextChange(task.id, event.target.value)}
      />

      <label className="bd-mobile-file-picker">
        <span>Photo / Evidence</span>
        <input
          type="file"
          accept="image/*"
          disabled={!canSubmitUpdate}
          onChange={(event) => onPhotoChange(task.id, event.target.files?.[0] || null)}
        />
        <strong>{selectedPhoto ? selectedPhoto.name : "No photo selected"}</strong>
      </label>

      <button
        type="button"
        className="bd-mobile-update-submit"
        disabled={!canSubmitUpdate}
        onClick={() => onSubmitTaskUpdate(task)}
      >
        {isUpdateSaving ? "Saving Update..." : isCompleted ? "Submit Final Update" : "Submit Update"}
      </button>

      {taskUpdates.length > 0 && (
        <div className="bd-mobile-update-list">
          {taskUpdates.slice(0, 5).map((update) => (
            <div key={update.id} className="bd-mobile-update-card">
              <div>
                <strong>
                  {update._pending_sync
                    ? update._queued_photo_name
                      ? "Queued Photo / Evidence"
                      : "Queued Field Note"
                    : update.photo_url
                      ? "Photo / Evidence"
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
      )}
    </div>
  );
}
