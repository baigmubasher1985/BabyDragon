import { useMemo, useState } from "react";
import { ISSUE_SEVERITIES, ISSUE_TYPES } from "./mobileConstants";
import { formatIssueStatus, formatSeverity } from "./mobileHelpers";

const QUICK_ROUTE_ISSUES = [
  { label: "Access", type: "No access", severity: "high", note: "Access issue on assigned route." },
  { label: "Private", type: "Private road", severity: "high", note: "Private road found on assigned route." },
  { label: "Blocked", type: "Route issue", severity: "high", note: "Route is blocked or not drivable." },
  { label: "Safety", type: "Unsafe area", severity: "urgent", note: "Safety concern on assigned route." },
  { label: "Equip", type: "Equipment issue", severity: "urgent", note: "Equipment issue while driving assigned route." },
  { label: "Other", type: "Other", severity: "normal", note: "Field comment for this route." },
];

function getInitialIssue() {
  return {
    issue_type: "Route issue",
    severity: "normal",
    description: "",
  };
}

export default function MobileRouteIssueQuick({
  task,
  isInProcess,
  taskIssues = [],
  isSaving,
  onSubmitRouteIssue,
}) {
  const [input, setInput] = useState(getInitialIssue);
  const [photoFile, setPhotoFile] = useState(null);
  const [isOpen, setIsOpen] = useState(false);

  const latestIssue = useMemo(() => taskIssues[0] || null, [taskIssues]);
  const canSubmit = Boolean(isInProcess && !isSaving && onSubmitRouteIssue);

  function updateInput(field, value) {
    setInput((prev) => ({ ...prev, [field]: value }));
  }

  function applyQuickIssue(issue) {
    setIsOpen(true);
    setInput((prev) => ({
      ...prev,
      issue_type: issue.type,
      severity: issue.severity,
      description: prev.description?.trim() ? prev.description : issue.note,
    }));
  }

  async function handleSubmit() {
    if (!canSubmit) return;

    const description = String(input.description || "").trim();
    if (!description) return;

    await onSubmitRouteIssue(task, { ...input, description }, photoFile);
    setInput(getInitialIssue());
    setPhotoFile(null);
    setIsOpen(false);
  }

  return (
    <section className="bd-mobile-route-issue-quick compact">
      <div className="bd-mobile-route-issue-toolbar">
        <button type="button" className="bd-mobile-route-add-issue" onClick={() => setIsOpen((value) => !value)}>
          {isOpen ? "Close Issue Form" : "+ Add Comment / Issue + Photo"}
        </button>
        <span>{taskIssues.length} issue{taskIssues.length === 1 ? "" : "s"}</span>
      </div>

      {!isOpen && latestIssue && (
        <div className="bd-mobile-route-latest-issue slim">
          <span>Latest Issue</span>
          <strong>{latestIssue.issue_type || "Issue"}</strong>
          <p>{latestIssue.description || "No issue details added."}</p>
          <small>{formatSeverity(latestIssue.severity)} • {latestIssue._pending_sync ? "Pending Sync" : formatIssueStatus(latestIssue.status)}</small>
        </div>
      )}

      {isOpen && (
        <div className="bd-mobile-route-issue-form">
          {!isInProcess && (
            <div className="bd-mobile-route-issue-lock">Start this task before adding route issues or photo evidence.</div>
          )}

          <div className="bd-mobile-route-quick-buttons">
            {QUICK_ROUTE_ISSUES.map((issue) => (
              <button
                key={issue.label}
                type="button"
                disabled={!canSubmit}
                className={input.issue_type === issue.type ? "active" : ""}
                onClick={() => applyQuickIssue(issue)}
              >
                {issue.label}
              </button>
            ))}
          </div>

          <div className="bd-mobile-route-issue-controls">
            <select
              value={input.issue_type}
              disabled={!canSubmit}
              onChange={(event) => updateInput("issue_type", event.target.value)}
            >
              {ISSUE_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>

            <select
              value={input.severity}
              disabled={!canSubmit}
              onChange={(event) => updateInput("severity", event.target.value)}
            >
              {ISSUE_SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>{formatSeverity(severity)}</option>
              ))}
            </select>
          </div>

          <textarea
            value={input.description}
            disabled={!canSubmit}
            placeholder="Add a clear note: private road, blocked street, safety issue, route correction, or field comment."
            onChange={(event) => updateInput("description", event.target.value)}
          />

          <div className="bd-mobile-route-photo-row">
            <label>
              <span>Photo / Evidence</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={!canSubmit}
                onChange={(event) => setPhotoFile(event.target.files?.[0] || null)}
              />
            </label>
            <strong>{photoFile?.name || "No photo selected"}</strong>
          </div>

          <button
            type="button"
            className="bd-mobile-route-issue-submit"
            disabled={!canSubmit || !String(input.description || "").trim()}
            onClick={handleSubmit}
          >
            {isSaving ? "Saving..." : photoFile ? "Submit Issue + Photo" : "Submit Comment / Issue"}
          </button>
        </div>
      )}
    </section>
  );
}
