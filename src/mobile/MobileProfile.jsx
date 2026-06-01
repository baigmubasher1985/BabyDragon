import React from "react";

function formatDateTime(value) {
  if (!value) return "Not synced yet";

  try {
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "Not synced yet";
  }
}

function getGpsParts(location) {
  if (!location) return null;

  const lat =
    location.latitude ??
    location.lat ??
    location.gps_lat ??
    location.gpsLat ??
    location.task_lat;

  const lng =
    location.longitude ??
    location.lng ??
    location.lon ??
    location.gps_lng ??
    location.gpsLon ??
    location.task_lng;

  if (lat === undefined || lng === undefined) return null;

  return {
    lat: Number(lat),
    lng: Number(lng),
    accuracy:
      location.accuracy ??
      location.gps_accuracy ??
      location.gpsAccuracy ??
      location.accuracy_m ??
      null,
  };
}

function formatGps(location) {
  const gps = getGpsParts(location);
  if (!gps || Number.isNaN(gps.lat) || Number.isNaN(gps.lng)) {
    return "No GPS saved yet";
  }

  return `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`;
}

function formatAccuracy(location) {
  const gps = getGpsParts(location);
  if (!gps?.accuracy && gps?.accuracy !== 0) return "N/A";

  const accuracy = Number(gps.accuracy);
  if (Number.isNaN(accuracy)) return "N/A";

  return `±${Math.round(accuracy)}m`;
}

export default function MobileProfile({
  user,
  isOnline = false,
  pendingSyncCount = 0,
  assignedOnlyCount = 0,
  inProcessCount = 0,
  completedCount = 0,
  allCount = 0,
  lastSuccessfulSyncAt,
  lastGpsLocation,
  gpsStatusMessage,
  gpsChecking = false,
  syncingPending = false,
  onRefreshGpsNow,
  onSyncNow,
  onLogout,
}) {
  const email = user?.email || "Unknown FE";
  const initials = email.slice(0, 2).toUpperCase();

  return (
    <div style={styles.page}>
      <section style={styles.heroCard}>
        <div style={styles.kicker}>FE PROFILE</div>
        <div style={styles.avatar}>{initials}</div>
        <h2 style={styles.title}>Field Engineer</h2>
        <p style={styles.subtitle}>{email}</p>
        <p style={styles.smallText}>
          Account, sync, GPS, and app status for the mobile field workflow.
        </p>
      </section>

      <section style={styles.grid}>
        <StatusCard
          label="Connection"
          value={isOnline ? "Online" : "Offline"}
          tone={isOnline ? "green" : "yellow"}
        />
        <StatusCard
          label="Pending Sync"
          value={pendingSyncCount}
          tone={pendingSyncCount > 0 ? "yellow" : "green"}
        />
        <StatusCard label="Assigned" value={assignedOnlyCount} />
        <StatusCard label="In-Process" value={inProcessCount} tone="blue" />
        <StatusCard label="Completed" value={completedCount} tone="green" />
        <StatusCard label="All Tasks" value={allCount} />
      </section>

      <section style={styles.card}>
        <div style={styles.kicker}>SYNC STATUS</div>

        <InfoRow
          label="Last successful sync"
          value={formatDateTime(lastSuccessfulSyncAt)}
        />

        <InfoRow label="Pending field changes" value={pendingSyncCount} />

        <button
          type="button"
          style={{
            ...styles.mainButton,
            opacity: syncingPending ? 0.65 : 1,
          }}
          onClick={onSyncNow}
          disabled={syncingPending}
        >
          {syncingPending ? "Syncing..." : "Refresh / Sync Now"}
        </button>
      </section>

      <section style={styles.card}>
        <div style={styles.kicker}>GPS STATUS</div>

        <InfoRow label="Last saved GPS" value={formatGps(lastGpsLocation)} />
        <InfoRow label="Accuracy" value={formatAccuracy(lastGpsLocation)} />
        <InfoRow label="GPS message" value={gpsStatusMessage || "GPS ready"} />

        <button
          type="button"
          style={{
            ...styles.secondaryButton,
            opacity: gpsChecking ? 0.65 : 1,
          }}
          onClick={onRefreshGpsNow}
          disabled={gpsChecking}
        >
          {gpsChecking ? "Checking GPS..." : "Refresh GPS"}
        </button>
      </section>

      <section style={styles.card}>
        <div style={styles.kicker}>APP STATUS</div>

        <InfoRow label="Version" value="BabyDragon Mobile V1.0-A" />
        <InfoRow label="APK Status" value="Ready for APK foundation" />
      </section>

      <button type="button" style={styles.logoutButton} onClick={onLogout}>
        Logout
      </button>
    </div>
  );
}

function StatusCard({ label, value, tone = "default" }) {
  const toneStyle =
    tone === "green"
      ? styles.greenCard
      : tone === "yellow"
      ? styles.yellowCard
      : tone === "blue"
      ? styles.blueCard
      : {};

  return (
    <div style={{ ...styles.statCard, ...toneStyle }}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={styles.infoRow}>
      <span style={styles.infoLabel}>{label}</span>
      <strong style={styles.infoValue}>{value}</strong>
    </div>
  );
}

const styles = {
  page: {
    padding: "14px 14px 92px",
    display: "grid",
    gap: "12px",
  },

  heroCard: {
    border: "1px solid rgba(148, 163, 184, 0.22)",
    background: "rgba(15, 23, 42, 0.88)",
    borderRadius: "20px",
    padding: "18px 14px",
    textAlign: "center",
    boxShadow: "0 16px 40px rgba(0, 0, 0, 0.18)",
  },

  kicker: {
    fontSize: "9px",
    letterSpacing: "0.14em",
    fontWeight: 900,
    color: "#93c5fd",
    marginBottom: "8px",
  },

  avatar: {
    width: "52px",
    height: "52px",
    borderRadius: "18px",
    margin: "0 auto 10px",
    display: "grid",
    placeItems: "center",
    background: "linear-gradient(135deg, #1d4ed8, #06b6d4)",
    color: "#fff",
    fontSize: "16px",
    fontWeight: 900,
    border: "1px solid rgba(147, 197, 253, 0.35)",
  },

  title: {
    margin: "0",
    fontSize: "20px",
    fontWeight: 900,
    color: "#f8fafc",
  },

  subtitle: {
    margin: "6px 0 0",
    fontSize: "13px",
    fontWeight: 800,
    color: "#e2e8f0",
    wordBreak: "break-word",
  },

  smallText: {
    margin: "8px auto 0",
    maxWidth: "270px",
    fontSize: "11px",
    lineHeight: 1.5,
    color: "#94a3b8",
  },

  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "8px",
  },

  statCard: {
    border: "1px solid rgba(148, 163, 184, 0.2)",
    background: "rgba(15, 23, 42, 0.82)",
    borderRadius: "16px",
    padding: "12px 8px",
    textAlign: "center",
  },

  greenCard: {
    borderColor: "rgba(34, 197, 94, 0.42)",
    background: "rgba(20, 83, 45, 0.22)",
  },

  yellowCard: {
    borderColor: "rgba(234, 179, 8, 0.45)",
    background: "rgba(113, 63, 18, 0.22)",
  },

  blueCard: {
    borderColor: "rgba(59, 130, 246, 0.5)",
    background: "rgba(30, 64, 175, 0.24)",
  },

  statLabel: {
    fontSize: "8px",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    fontWeight: 900,
    color: "#93c5fd",
    marginBottom: "7px",
  },

  statValue: {
    fontSize: "18px",
    fontWeight: 950,
    color: "#f8fafc",
  },

  card: {
    border: "1px solid rgba(148, 163, 184, 0.22)",
    background: "rgba(15, 23, 42, 0.88)",
    borderRadius: "18px",
    padding: "14px",
  },

  infoRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "9px 0",
    borderBottom: "1px solid rgba(148, 163, 184, 0.14)",
  },

  infoLabel: {
    color: "#94a3b8",
    fontSize: "11px",
  },

  infoValue: {
    color: "#f8fafc",
    fontSize: "11px",
    textAlign: "right",
    wordBreak: "break-word",
  },

  mainButton: {
    width: "100%",
    border: "0",
    borderRadius: "14px",
    padding: "12px",
    marginTop: "12px",
    background: "linear-gradient(135deg, #2563eb, #06b6d4)",
    color: "#fff",
    fontWeight: 900,
    fontSize: "12px",
    cursor: "pointer",
  },

  secondaryButton: {
    width: "100%",
    border: "1px solid rgba(56, 189, 248, 0.5)",
    borderRadius: "14px",
    padding: "12px",
    marginTop: "12px",
    background: "rgba(14, 165, 233, 0.12)",
    color: "#dbeafe",
    fontWeight: 900,
    fontSize: "12px",
    cursor: "pointer",
  },

  logoutButton: {
    width: "100%",
    border: "0",
    borderRadius: "14px",
    padding: "13px",
    background: "linear-gradient(135deg, #ef4444, #fb7185)",
    color: "#fff",
    fontWeight: 950,
    fontSize: "13px",
    cursor: "pointer",
  },
};
