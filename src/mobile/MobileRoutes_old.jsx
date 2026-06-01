// src/mobile/MobileRoutes.jsx

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import MobileRouteMap from "./MobileRouteMap";
import MobileRouteIssuePanel from "./MobileRouteIssuePanel";
import {
  buildNavigationUrl,
  findGridsForTask,
  findRouteForGrid,
  formatDate,
  formatRouteMode,
  getGridLabel,
  getGridMarket,
  getRouteName,
  getTaskPriority,
  getTaskReference,
  getTaskScope,
  getTaskStatus,
  getTaskTitle,
  isAssignedToCurrentUser,
  isInProcessTask,
  normalizeText,
  prettyText,
} from "./mobileRouteUtils";

export default function MobileRoutes({ user: userProp = null }) {
  const [user, setUser] = useState(userProp);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [tasks, setTasks] = useState([]);
  const [grids, setGrids] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [taskGrids, setTaskGrids] = useState([]);
  const [routeGrids, setRouteGrids] = useState([]);
  const [issuesByTask, setIssuesByTask] = useState({});
  const [updatesByTask, setUpdatesByTask] = useState({});

  const [selectedRowKey, setSelectedRowKey] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadRoutesPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProp?.id]);

  async function loadRoutesPage() {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const activeUser = userProp || (await getCurrentUser());
      setUser(activeUser);

      if (!activeUser) {
        setTasks([]);
        setGrids([]);
        setRoutes([]);
        setTaskGrids([]);
        setRouteGrids([]);
        setIssuesByTask({});
        setUpdatesByTask({});
        setLoading(false);
        return;
      }

      const [taskRows, gridRows, routeRows, taskGridRows, routeGridRows] = await Promise.all([
        loadTasks(),
        loadGrids(),
        safeSelectAll("routes"),
        safeSelectAll("task_grids"),
        safeSelectAll("route_grids"),
      ]);

      const assignedTasks = taskRows.filter((task) => isAssignedToCurrentUser(task, activeUser));
      const taskIds = assignedTasks.map((task) => task.id).filter(Boolean);

      const [issueRows, updateRows] = await Promise.all([
        loadIssues(taskIds),
        loadUpdates(taskIds),
      ]);

      setTasks(assignedTasks);
      setGrids(gridRows);
      setRoutes(routeRows);
      setTaskGrids(taskGridRows);
      setRouteGrids(routeGridRows);
      setIssuesByTask(groupRowsByTask(issueRows));
      setUpdatesByTask(groupRowsByTask(updateRows));

      setMessage(
        `Routes synced at ${new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })}.`
      );
    } catch (loadError) {
      console.error("BabyDragon mobile route load error:", loadError);
      setError(loadError.message || "Unable to load mobile routes.");
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => {
    const output = [];

    tasks.forEach((task) => {
      const linkedGrids = findGridsForTask(task, grids, taskGrids);

      if (!linkedGrids.length) {
        output.push({
          key: `${task.id}-nogrid`,
          task,
          grid: null,
          route: null,
          issues: issuesByTask[String(task.id)] || [],
          updates: updatesByTask[String(task.id)] || [],
        });
        return;
      }

      linkedGrids.forEach((grid) => {
        const route = findRouteForGrid(grid, routes, routeGrids);
        output.push({
          key: `${task.id}-${grid?.id || getGridLabel(grid)}`,
          task,
          grid,
          route,
          issues: issuesByTask[String(task.id)] || [],
          updates: updatesByTask[String(task.id)] || [],
        });
      });
    });

    return output.sort((a, b) => {
      const aReady = Boolean(a.route);
      const bReady = Boolean(b.route);
      if (aReady !== bReady) return aReady ? -1 : 1;
      return getGridLabel(a.grid).localeCompare(getGridLabel(b.grid));
    });
  }, [grids, issuesByTask, routeGrids, routes, taskGrids, tasks, updatesByTask]);

  useEffect(() => {
    if (!rows.length) {
      setSelectedRowKey("");
      return;
    }

    const savedGridId = localStorage.getItem("feRouteSelectedGridId");
    const savedGridRow = savedGridId
      ? rows.find((row) =>
          [row.grid?.id, row.grid?.grid_id, row.grid?.grid_name, row.grid?.name]
            .filter(Boolean)
            .some((value) => String(value) === String(savedGridId))
        )
      : null;

    if (savedGridRow) {
      setSelectedRowKey(savedGridRow.key);
      localStorage.removeItem("feRouteSelectedGridId");
      return;
    }

    setSelectedRowKey((current) => {
      if (current && rows.some((row) => row.key === current)) return current;
      const firstReady = rows.find((row) => row.route);
      return (firstReady || rows[0]).key;
    });
  }, [rows]);

  const stats = useMemo(() => {
    const ready = rows.filter((row) => row.route).length;
    const inProgress = rows.filter((row) => getTaskStatus(row.task) === "in_progress").length;
    const issues = rows.reduce((sum, row) => sum + (row.issues?.length || 0), 0);

    return {
      total: rows.length,
      ready,
      missing: Math.max(rows.length - ready, 0),
      inProgress,
      issues,
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = normalizeText(search);

    return rows.filter((row) => {
      const routeReady = Boolean(row.route);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "ready" && routeReady) ||
        (statusFilter === "missing" && !routeReady) ||
        (statusFilter === "in_progress" && getTaskStatus(row.task) === "in_progress") ||
        (statusFilter === "issues" && (row.issues?.length || 0) > 0);

      const haystack = [
        getTaskTitle(row.task, row.grid),
        getGridLabel(row.grid),
        getGridMarket(row.grid, row.task),
        getRouteName(row.route, row.grid),
        getTaskScope(row.task),
        getTaskPriority(row.task),
        getTaskStatus(row.task),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return matchesStatus && (!query || haystack.includes(query));
    });
  }, [rows, search, statusFilter]);

  const selectedRow = useMemo(() => {
    return rows.find((row) => row.key === selectedRowKey) || filteredRows[0] || rows[0] || null;
  }, [filteredRows, rows, selectedRowKey]);

  function openNavigation(row) {
    const url = buildNavigationUrl(row);

    if (!url) {
      setError("Navigation is not ready because this grid or route has no usable coordinates yet.");
      return;
    }

    setError("");
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handleIssueSaved(payload) {
    if (!selectedRow?.task?.id || !payload?.issue) return;

    const taskId = String(selectedRow.task.id);
    setIssuesByTask((prev) => ({
      ...prev,
      [taskId]: [payload.issue, ...(prev[taskId] || [])],
    }));

    if (payload.photoUrl) {
      setUpdatesByTask((prev) => ({
        ...prev,
        [taskId]: [
          {
            id: `local-photo-${Date.now()}`,
            task_id: selectedRow.task.id,
            comment: "Route issue photo",
            photo_url: payload.photoUrl,
            created_at: new Date().toISOString(),
          },
          ...(prev[taskId] || []),
        ],
      }));
    }
  }

  return (
    <div style={styles.pageWrap}>
      <section style={styles.routeDesk}>
        <p style={styles.eyebrow}>Route Desk</p>
        <h2 style={styles.title}>Assigned Routes</h2>
        <p style={styles.subtitle}>
          Open route map, verify grid and sector coverage, then launch navigation.
        </p>
      </section>

      {error && <div style={styles.errorBox}>{error}</div>}
      {message && <div style={styles.successBox}>{message}</div>}

      <section style={styles.toolbarCard}>
        <div style={styles.statsRow}>
          <StatButton active={statusFilter === "all"} label="Assigned" value={stats.total} onClick={() => setStatusFilter("all")} />
          <StatButton active={statusFilter === "ready"} label="Ready" value={stats.ready} good onClick={() => setStatusFilter("ready")} />
          <StatButton active={statusFilter === "missing"} label="Missing" value={stats.missing} warn onClick={() => setStatusFilter("missing")} />
          <StatButton active={statusFilter === "issues"} label="Issues" value={stats.issues} warn onClick={() => setStatusFilter("issues")} />
        </div>

        <div style={styles.filterLine}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search grid, route, market..."
            style={styles.searchInput}
          />
          <button type="button" style={styles.smallButton} onClick={loadRoutesPage} disabled={loading}>
            {loading ? "Syncing" : "Refresh"}
          </button>
        </div>
      </section>

      {loading && <div style={styles.emptyCard}>Loading route desk...</div>}

      {!loading && !rows.length && (
        <div style={styles.emptyCard}>No assigned route records found for this FE.</div>
      )}

      {!loading && rows.length > 0 && (
        <>
          <section style={styles.routeList}>
            {filteredRows.map((row) => (
              <RouteCard
                key={row.key}
                row={row}
                active={selectedRow?.key === row.key}
                onSelect={() => setSelectedRowKey(row.key)}
                onNavigate={() => openNavigation(row)}
              />
            ))}
          </section>

          {selectedRow && (
            <>
              <MobileRouteMap row={selectedRow} />
              <MobileRouteIssuePanel row={selectedRow} user={user} onSaved={handleIssueSaved} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function RouteCard({ row, active, onSelect, onNavigate }) {
  const ready = Boolean(row.route);
  const status = getTaskStatus(row.task);

  return (
    <article style={{ ...styles.routeCard, ...(active ? styles.routeCardActive : {}) }}>
      <div style={styles.routeCardTop}>
        <div>
          <h3 style={styles.routeName}>{getGridLabel(row.grid)}</h3>
          <p style={styles.routeMeta}>{getGridMarket(row.grid, row.task)} • {prettyText(status)}</p>
        </div>
        <span style={ready ? styles.readyPill : styles.missingPill}>
          {ready ? "Route Ready" : "Grid Only"}
        </span>
      </div>

      <div style={styles.miniGrid}>
        <Info label="Task" value={getTaskTitle(row.task, row.grid)} />
        <Info label="Route" value={ready ? getRouteName(row.route, row.grid) : "Not linked"} />
        <Info label="Ref" value={getTaskReference(row.task, row.grid)} />
        <Info label="Mode" value={ready ? formatRouteMode(row.route) : "Grid only"} />
      </div>

      <div style={styles.taskBrief}>
        <span>{getTaskScope(row.task)}</span>
        <span>Priority: {getTaskPriority(row.task)}</span>
        <span>Issues: {row.issues?.length || 0}</span>
        <span>Due: {formatDate(row.task?.due_date, "No due date")}</span>
      </div>

      <div style={styles.actionRow}>
        <button type="button" style={active ? styles.primaryButton : styles.secondaryButton} onClick={onSelect}>
          {active ? "Map Open" : "View Route Map"}
        </button>
        <button type="button" style={styles.navigateButton} onClick={onNavigate}>
          Navigate
        </button>
      </div>
    </article>
  );
}

function Info({ label, value }) {
  return (
    <div style={styles.infoBox}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatButton({ label, value, active, good, warn, onClick }) {
  const style = {
    ...styles.statButton,
    ...(active ? styles.statButtonActive : {}),
    ...(good ? styles.goodBorder : {}),
    ...(warn ? styles.warnBorder : {}),
  };

  return (
    <button type="button" style={style} onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}

async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data?.user || null;
}

async function safeSelectAll(tableName) {
  const { data, error } = await supabase.from(tableName).select("*");

  if (error) {
    console.warn(`BabyDragon mobile routes could not load ${tableName}:`, error.message);
    return [];
  }

  return Array.isArray(data) ? data : [];
}

async function loadTasks() {
  const relationResult = await supabase
    .from("tasks")
    .select(`
      *,
      projects (
        id,
        name,
        customer,
        market,
        testing_type
      )
    `)
    .order("created_at", { ascending: false });

  if (!relationResult.error) return relationResult.data || [];

  console.warn("Project relation not available on mobile route task load:", relationResult.error.message);
  return safeSelectAll("tasks");
}

async function loadGrids() {
  const rpcResult = await supabase.rpc("get_grids_geojson");

  if (!rpcResult.error && Array.isArray(rpcResult.data)) {
    return rpcResult.data;
  }

  if (rpcResult.error) {
    console.warn("Grid RPC not available, falling back to grids table:", rpcResult.error.message);
  }

  return safeSelectAll("grids");
}

async function loadIssues(taskIds) {
  if (!taskIds?.length) return [];

  const { data, error } = await supabase
    .from("task_issue_reports")
    .select("*")
    .in("task_id", taskIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Mobile route issue load failed:", error.message);
    return [];
  }

  return data || [];
}

async function loadUpdates(taskIds) {
  if (!taskIds?.length) return [];

  const { data, error } = await supabase
    .from("task_updates")
    .select("*")
    .in("task_id", taskIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Mobile route update load failed:", error.message);
    return [];
  }

  return data || [];
}

function groupRowsByTask(rows) {
  const grouped = {};

  (rows || []).forEach((row) => {
    const taskId = String(row.task_id || "");
    if (!taskId) return;
    if (!grouped[taskId]) grouped[taskId] = [];
    grouped[taskId].push(row);
  });

  Object.values(grouped).forEach((items) => {
    items.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  });

  return grouped;
}

const styles = {
  pageWrap: {
    display: "grid",
    gap: 12,
  },
  routeDesk: {
    padding: 18,
    border: "1px solid rgba(148, 163, 184, 0.22)",
    borderRadius: 22,
    background: "linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.7))",
    textAlign: "center",
  },
  eyebrow: {
    margin: 0,
    color: "#93c5fd",
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  title: {
    margin: "6px 0",
    color: "#f8fafc",
    fontSize: 22,
    lineHeight: 1.1,
  },
  subtitle: {
    margin: 0,
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 1.5,
  },
  toolbarCard: {
    display: "grid",
    gap: 10,
    padding: 10,
    border: "1px solid rgba(148, 163, 184, 0.2)",
    borderRadius: 18,
    background: "rgba(15, 23, 42, 0.68)",
  },
  statsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 7,
  },
  statButton: {
    minHeight: 58,
    display: "grid",
    gap: 2,
    placeItems: "center",
    border: "1px solid rgba(148, 163, 184, 0.22)",
    borderRadius: 15,
    background: "rgba(2, 6, 23, 0.34)",
    color: "#94a3b8",
    cursor: "pointer",
  },
  statButtonActive: {
    borderColor: "rgba(96, 165, 250, 0.56)",
    background: "rgba(37, 99, 235, 0.22)",
    color: "#bfdbfe",
  },
  goodBorder: {
    borderColor: "rgba(34, 197, 94, 0.38)",
  },
  warnBorder: {
    borderColor: "rgba(251, 191, 36, 0.38)",
  },
  filterLine: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 8,
  },
  searchInput: {
    minHeight: 42,
    padding: "0 12px",
    border: "1px solid rgba(148, 163, 184, 0.26)",
    borderRadius: 14,
    background: "rgba(2, 6, 23, 0.72)",
    color: "#f8fafc",
    fontSize: 13,
  },
  smallButton: {
    minHeight: 42,
    padding: "0 12px",
    border: "1px solid rgba(148, 163, 184, 0.26)",
    borderRadius: 14,
    background: "rgba(30, 41, 59, 0.92)",
    color: "#e2e8f0",
    fontWeight: 900,
    cursor: "pointer",
  },
  routeList: {
    display: "grid",
    gap: 10,
  },
  routeCard: {
    display: "grid",
    gap: 10,
    padding: 12,
    border: "1px solid rgba(148, 163, 184, 0.22)",
    borderRadius: 18,
    background: "rgba(15, 23, 42, 0.82)",
  },
  routeCardActive: {
    borderColor: "rgba(56, 189, 248, 0.55)",
    boxShadow: "0 0 0 1px rgba(56, 189, 248, 0.18)",
  },
  routeCardTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
  },
  routeName: {
    margin: 0,
    color: "#f8fafc",
    fontSize: 17,
    overflowWrap: "anywhere",
  },
  routeMeta: {
    margin: "4px 0 0",
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: 800,
  },
  readyPill: {
    alignSelf: "start",
    padding: "7px 10px",
    borderRadius: 999,
    background: "rgba(34, 197, 94, 0.2)",
    color: "#bbf7d0",
    fontSize: 10,
    fontWeight: 950,
    whiteSpace: "nowrap",
  },
  missingPill: {
    alignSelf: "start",
    padding: "7px 10px",
    borderRadius: 999,
    background: "rgba(251, 191, 36, 0.18)",
    color: "#fde68a",
    fontSize: 10,
    fontWeight: 950,
    whiteSpace: "nowrap",
  },
  miniGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
  },
  infoBox: {
    minWidth: 0,
    display: "grid",
    gap: 5,
    padding: 10,
    border: "1px solid rgba(148, 163, 184, 0.18)",
    borderRadius: 14,
    background: "rgba(2, 6, 23, 0.28)",
  },
  taskBrief: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: 800,
  },
  actionRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
  },
  primaryButton: {
    minHeight: 42,
    border: "none",
    borderRadius: 14,
    background: "rgba(37, 99, 235, 0.92)",
    color: "#ffffff",
    fontSize: 13,
    fontWeight: 950,
    cursor: "pointer",
  },
  secondaryButton: {
    minHeight: 42,
    border: "1px solid rgba(148, 163, 184, 0.26)",
    borderRadius: 14,
    background: "rgba(30, 41, 59, 0.92)",
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: 950,
    cursor: "pointer",
  },
  navigateButton: {
    minHeight: 42,
    border: "none",
    borderRadius: 14,
    background: "linear-gradient(135deg, #2563eb, #06b6d4)",
    color: "#ffffff",
    fontSize: 13,
    fontWeight: 950,
    cursor: "pointer",
  },
  emptyCard: {
    padding: 18,
    border: "1px solid rgba(148, 163, 184, 0.2)",
    borderRadius: 18,
    background: "rgba(15, 23, 42, 0.72)",
    color: "#cbd5e1",
    textAlign: "center",
    fontWeight: 800,
  },
  errorBox: {
    padding: "11px 12px",
    border: "1px solid rgba(248, 113, 113, 0.36)",
    borderRadius: 14,
    background: "rgba(127, 29, 29, 0.36)",
    color: "#fecaca",
    fontWeight: 800,
  },
  successBox: {
    padding: "11px 12px",
    border: "1px solid rgba(34, 197, 94, 0.28)",
    borderRadius: 14,
    background: "rgba(20, 83, 45, 0.34)",
    color: "#bbf7d0",
    fontWeight: 800,
  },
};
