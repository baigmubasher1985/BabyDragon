import { CHECKLIST_ITEMS } from "./mobileConstants";

export default function MobileChecklist({
  task,
  checklistState,
  checklistStats,
  isAssigned,
  isInProcess,
  isOnHold,
  isCompleted,
  isChecklistSaving,
  onUpdateChecklistItem,
}) {
  const canEditChecklist = isInProcess && !isChecklistSaving;
  const checklistMessage = isAssigned
    ? "Start task before editing checklist."
    : isOnHold
      ? "Resume task before changing checklist. Issues/photos can still be added while on hold."
      : isCompleted
        ? "Completed task checklist is read-only."
        : "Tap each item as work is completed.";

  return (
    <div className="bd-mobile-checklist-panel">
      <div className="bd-mobile-checklist-head">
        <div>
          <h4>FE Checklist</h4>
          <p>{checklistMessage}</p>
        </div>
        <span>{checklistStats.completed}/{checklistStats.total}</span>
      </div>

      {CHECKLIST_ITEMS.map((item) => (
        <label
          key={item.id}
          className={`bd-mobile-checklist-item ${checklistState[item.id] ? "done" : ""} ${!canEditChecklist ? "locked" : ""}`}
        >
          <input
            type="checkbox"
            checked={Boolean(checklistState[item.id])}
            disabled={!canEditChecklist}
            onChange={(event) => onUpdateChecklistItem(task, item.id, event.target.checked)}
          />
          <span>{item.label}</span>
        </label>
      ))}

      {isChecklistSaving && <p className="bd-mobile-checklist-saving">Saving checklist...</p>}
    </div>
  );
}
