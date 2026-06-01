export const assignmentFields = [
  "fe_id",
  "assigned_fe_id",
  "assigned_to",
  "assigned_user_id",
  "engineer_id",
  "fe_user_id",
  "user_id",
];

export const assignmentEmailFields = [
  "fe_email",
  "assigned_fe_email",
  "assigned_to_email",
  "engineer_email",
  "email",
];

export const assignedStatuses = ["assigned", "pending"];
export const inProcessStatuses = ["in_progress", "in-process", "in process", "started", "working"];
export const onHoldStatuses = ["on_hold", "on hold", "hold", "paused", "paused_route", "route_on_hold"];
export const completedStatuses = ["completed", "closed", "done"];

export const CHECKLIST_ITEMS = [
  { id: "reached_grid", label: "Reached assigned grid/site" },
  { id: "opened_route", label: "Opened assigned route" },
  { id: "started_rf_tool", label: "Started testing in RF tool" },
  { id: "testing_completed", label: "Required drive/testing completed" },
  { id: "logs_collected", label: "Logs collected in RF tool" },
  { id: "logs_uploaded", label: "Logs uploaded/handed to team" },
  { id: "photo_evidence", label: "Photo/evidence added if needed" },
  { id: "issue_reported", label: "Issue reported if any" },
];

export const ISSUE_TYPES = [
  "No access",
  "Private road",
  "Unsafe area",
  "Weather delay",
  "Equipment issue",
  "Route issue",
  "Log issue",
  "Need re-drive",
  "Other",
];

export const ISSUE_SEVERITIES = ["normal", "low", "high", "urgent"];

export const MOBILE_GPS_CACHE_PREFIX = "babydragon_mobile_last_gps_v1";
export const MOBILE_GPS_INTERVAL_MS = 30000;

export const GPS_SYSTEM_COMMENTS = [
  "auto gps point",
  "mobile gps point",
  "task started from mobile",
  "task completed from mobile",
  "task put on hold from mobile",
  "task resumed from mobile",
];

export function getDefaultIssueInput() {
  return {
    issue_type: "No access",
    severity: "normal",
    description: "",
  };
}

export const MOBILE_APP_VERSION = "BabyDragon Mobile FE v0.9A";
