// src/mobile/MobileRouteIssuePanel.jsx

import React, { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import {
  formatDate,
  getCurrentLocationSafe,
  getGridLabel,
  prettyText,
  uploadTaskPhotoToStorage,
} from "./mobileRouteUtils";

const ISSUE_TYPES = ["Access", "Private", "Blocked", "Safety", "Equipment", "Weather", "Route", "Other"];
const SEVERITIES = ["normal", "high", "urgent", "low"];

export default function MobileRouteIssuePanel({ row, user, onSaved }) {
  const [open, setOpen] = useState(false);
  const [issueType, setIssueType] = useState("Access");
  const [severity, setSeverity] = useState("normal");
  const [description, setDescription] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const issueCount = row?.issues?.length || 0;
  const latestIssue = useMemo(() => row?.issues?.[0] || null, [row?.issues]);

  async function submitIssue() {
    if (!row?.task?.id || saving) return;

    const cleanDescription = String(description || "").trim();
    if (!cleanDescription && !photoFile) {
      setMessage("Add a short note or photo first.");
      return;
    }

    if (photoFile && photoFile.size > 5 * 1024 * 1024) {
      setMessage("Photo is too large. Please use an image under 5 MB.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const location = await getCurrentLocationSafe(user?.id, {
        allowCachedFallback: true,
        source: "route_issue",
      });

      const issuePayload = {
        task_id: row.task.id,
        issue_type: issueType,
        severity,
        description:
          cleanDescription ||
          `Route issue photo added for ${getGridLabel(row.grid)}.`,
        status: "open",
        lat: location?.latitude ?? null,
        lon: location?.longitude ?? null,
        reported_by: user?.id || null,
      };

      const { data: savedIssue, error: issueError } = await supabase
        .from("task_issue_reports")
        .insert(issuePayload)
        .select("*")
        .single();

      if (issueError) throw issueError;

      let photoUrl = null;

      if (photoFile) {
        photoUrl = await uploadTaskPhotoToStorage(supabase, row.task.id, photoFile);

        const updatePayload = {
          task_id: row.task.id,
          user_id: user?.id || null,
          user_email: user?.email || "",
          comment: `Route issue photo: ${cleanDescription || issueType}`,
          photo_url: photoUrl,
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null,
        };

        await supabase.from("task_updates").insert(updatePayload);
      }

      setDescription("");
      setPhotoFile(null);
      setOpen(false);
      setMessage(photoUrl ? "Issue saved and photo attached." : "Issue saved.");

      onSaved?.({ issue: savedIssue || issuePayload, photoUrl });
    } catch (error) {
      setMessage(error.message || "Issue could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={styles.panel}>
      <div style={styles.head}>
        <div>
          <h4 style={styles.title}>Route Issue / Comment</h4>
          <p style={styles.subtitle}>Add route, access, safety, or handoff notes without leaving this page.</p>
        </div>
        <span style={styles.issuePill}>{issueCount} Issue{issueCount === 1 ? "" : "s"}</span>
      </div>

      <button type="button" style={styles.openButton} onClick={() => setOpen((current) => !current)}>
        {open ? "Close Issue Form" : "+ Add Comment / Issue + Photo"}
      </button>

      {open && (
        <div style={styles.form}>
          <div style={styles.formGrid}>
            <label style={styles.label}>
              Issue Type
              <select value={issueType} onChange={(event) => setIssueType(event.target.value)} style={styles.input}>
                {ISSUE_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>

            <label style={styles.label}>
              Severity
              <select value={severity} onChange={(event) => setSeverity(event.target.value)} style={styles.input}>
                {SEVERITIES.map((value) => (
                  <option key={value} value={value}>{prettyText(value)}</option>
                ))}
              </select>
            </label>
          </div>

          <label style={styles.label}>
            Comment
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Example: Route blocked near east entrance. Photo attached."
              style={styles.textarea}
            />
          </label>

          <label style={styles.fileBox}>
            <span>Photo Evidence</span>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => setPhotoFile(event.target.files?.[0] || null)}
            />
            <strong>{photoFile ? photoFile.name : "No photo selected"}</strong>
          </label>

          <button type="button" disabled={saving} style={styles.submitButton} onClick={submitIssue}>
            {saving ? "Saving..." : "Submit Issue"}
          </button>
        </div>
      )}

      {message && <div style={styles.message}>{message}</div>}

      {latestIssue && (
        <div style={styles.latestIssue}>
          <small>Latest Issue</small>
          <strong>{prettyText(latestIssue.issue_type || "Route Issue")}</strong>
          {latestIssue.description && <p>{latestIssue.description}</p>}
          <span>
            {prettyText(latestIssue.severity || "normal")} • {prettyText(latestIssue.status || "open")} • {formatDate(latestIssue.created_at, "Just now")}
          </span>
        </div>
      )}
    </section>
  );
}

const styles = {
  panel: {
    display: "grid",
    gap: 10,
    marginTop: 12,
    padding: 12,
    border: "1px solid rgba(251, 191, 36, 0.28)",
    borderRadius: 18,
    background: "rgba(120, 53, 15, 0.16)",
  },
  head: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  title: {
    margin: 0,
    color: "#f8fafc",
    fontSize: 15,
  },
  subtitle: {
    margin: "4px 0 0",
    color: "#cbd5e1",
    fontSize: 12,
    lineHeight: 1.35,
  },
  issuePill: {
    flex: "0 0 auto",
    padding: "7px 10px",
    borderRadius: 999,
    background: "rgba(251, 191, 36, 0.18)",
    color: "#fde68a",
    fontSize: 11,
    fontWeight: 900,
  },
  openButton: {
    minHeight: 42,
    border: "none",
    borderRadius: 14,
    background: "linear-gradient(135deg, #eab308, #22c55e)",
    color: "#04111f",
    fontSize: 13,
    fontWeight: 950,
    cursor: "pointer",
  },
  form: {
    display: "grid",
    gap: 10,
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 9,
  },
  label: {
    display: "grid",
    gap: 6,
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: 900,
  },
  input: {
    minHeight: 42,
    padding: "0 10px",
    border: "1px solid rgba(148, 163, 184, 0.26)",
    borderRadius: 13,
    background: "rgba(2, 6, 23, 0.72)",
    color: "#f8fafc",
    fontSize: 13,
  },
  textarea: {
    minHeight: 86,
    padding: "11px 12px",
    border: "1px solid rgba(148, 163, 184, 0.26)",
    borderRadius: 13,
    background: "rgba(2, 6, 23, 0.72)",
    color: "#f8fafc",
    fontSize: 13,
    resize: "vertical",
  },
  fileBox: {
    display: "grid",
    gap: 6,
    padding: 10,
    border: "1px dashed rgba(96, 165, 250, 0.36)",
    borderRadius: 14,
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: 900,
  },
  submitButton: {
    minHeight: 42,
    border: "none",
    borderRadius: 14,
    background: "linear-gradient(135deg, #2563eb, #06b6d4)",
    color: "#ffffff",
    fontSize: 13,
    fontWeight: 950,
    cursor: "pointer",
  },
  message: {
    padding: "9px 10px",
    borderRadius: 12,
    background: "rgba(15, 23, 42, 0.62)",
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: 800,
  },
  latestIssue: {
    display: "grid",
    gap: 5,
    padding: 11,
    border: "1px solid rgba(251, 191, 36, 0.2)",
    borderRadius: 14,
    background: "rgba(2, 6, 23, 0.35)",
  },
};
