// src/components/routes/RouteGeneratorPanel.jsx

import React, { useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  ROUTE_MODES,
  formatMeters,
  generateRouteForGrid,
} from "../../utils/routeGeneration";

export default function RouteGeneratorPanel({
  selectedGrid,
  cellSectors = [],
  onPreviewRoute,
  onSaved,
}) {
  const [mode, setMode] = useState("dense");
  const [generatedRoute, setGeneratedRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const selectedMode = useMemo(() => {
    return ROUTE_MODES.find((item) => item.value === mode) || ROUTE_MODES[0];
  }, [mode]);

  const gridLabel = useMemo(() => {
    if (!selectedGrid) return "No grid selected";

    return (
      selectedGrid.grid_name ||
      selectedGrid.name ||
      selectedGrid.grid_id ||
      selectedGrid.grid_code ||
      selectedGrid.number ||
      selectedGrid.id ||
      "Selected Grid"
    );
  }, [selectedGrid]);

  async function handleGenerateRoute() {
    if (!selectedGrid) {
      setMessage("Please select a grid first.");
      return;
    }

    setLoading(true);
    setMessage("");
    setGeneratedRoute(null);

    try {
      const result = await generateRouteForGrid({
        grid: selectedGrid,
        mode,
        sectors: cellSectors,
      });

      setGeneratedRoute(result);

      if (onPreviewRoute) {
        onPreviewRoute(result.geojson);
      }

      const sectorText =
        mode === "sector_coverage"
          ? ` Sector-aware: ${result.sectorAware ? "Yes" : "No"}. Sectors checked: ${result.sectorCount || 0}.`
          : "";

      setMessage(
        `Route generated: ${result.geojson.features.length} road segments, ${formatMeters(
          result.lengthM
        )}.${sectorText}`
      );
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Route generation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveRoute() {
    if (!selectedGrid || !generatedRoute) {
      setMessage("Generate a route before saving.");
      return;
    }

    const gridDbId = selectedGrid.id || selectedGrid.grid_db_id || selectedGrid.grid_id;

    if (!gridDbId) {
      setMessage("Unable to save route because selected grid has no id.");
      return;
    }

    setSaving(true);
    setMessage("");

    const routeName = buildRouteName({
      grid: selectedGrid,
      modeLabel: selectedMode.label,
    });

    const payload = {
      grid_id: gridDbId,
      route_name: routeName,
      route_mode: mode,
      route_geojson: generatedRoute.geojson,
      route_length_m: generatedRoute.lengthM,
      route_source: generatedRoute.source,
      generated_at: generatedRoute.generatedAt,
    };

    try {
      const { data: existingRoute, error: findError } = await supabase
        .from("routes")
        .select("id")
        .eq("grid_id", gridDbId)
        .limit(1)
        .maybeSingle();

      if (findError) throw findError;

      let saveError;

      if (existingRoute?.id) {
        const { error } = await supabase
          .from("routes")
          .update(payload)
          .eq("id", existingRoute.id);

        saveError = error;
      } else {
        const { error } = await supabase
          .from("routes")
          .insert(payload);

        saveError = error;
      }

      if (saveError) throw saveError;

      setMessage("Route saved successfully.");

      if (onSaved) {
        onSaved();
      }
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Unable to save route.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <div>
          <h3 style={styles.title}>Route Generation V2</h3>
          <p style={styles.subtitle}>{gridLabel}</p>
        </div>

        <span style={styles.badge}>Admin</span>
      </div>

      <label style={styles.label}>Route Mode</label>

      <select
        value={mode}
        onChange={(event) => {
          setMode(event.target.value);
          setGeneratedRoute(null);
          setMessage("");
          if (onPreviewRoute) onPreviewRoute(null);
        }}
        style={styles.select}
      >
        {ROUTE_MODES.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>

      <p style={styles.description}>{selectedMode.description}</p>

      {mode === "sector_coverage" && (
        <div style={styles.sectorInfoBox}>
          <span>Imported cell sectors available</span>
          <strong>{cellSectors.length}</strong>
        </div>
      )}

      <div style={styles.actions}>
        <button
          type="button"
          onClick={handleGenerateRoute}
          disabled={loading || !selectedGrid}
          style={{
            ...styles.button,
            opacity: loading || !selectedGrid ? 0.55 : 1,
          }}
        >
          {loading ? "Generating..." : "Generate Route"}
        </button>

        <button
          type="button"
          onClick={handleSaveRoute}
          disabled={saving || !generatedRoute}
          style={{
            ...styles.saveButton,
            opacity: saving || !generatedRoute ? 0.55 : 1,
          }}
        >
          {saving ? "Saving..." : "Save Route"}
        </button>
      </div>

      {generatedRoute && (
        <div style={styles.summaryBox}>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>Segments</span>
            <strong>{generatedRoute.geojson.features.length}</strong>
          </div>

          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>Length</span>
            <strong>{formatMeters(generatedRoute.lengthM)}</strong>
          </div>

          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>Mode</span>
            <strong>{selectedMode.label}</strong>
          </div>

          {mode === "sector_coverage" && (
            <div style={styles.summaryItem}>
              <span style={styles.summaryLabel}>Sector Aware</span>
              <strong>{generatedRoute.sectorAware ? "Yes" : "No"}</strong>
            </div>
          )}
        </div>
      )}

      {message && <p style={styles.message}>{message}</p>}
    </div>
  );
}

function buildRouteName({ grid, modeLabel }) {
  const market = grid.market || grid.market_name || "";
  const gridName =
    grid.grid_name ||
    grid.name ||
    grid.grid_id ||
    grid.grid_code ||
    grid.number ||
    grid.id ||
    "Grid";

  return `${market ? `${market} - ` : ""}${gridName} - ${modeLabel} Route`;
}

const styles = {
  card: {
    background: "#101828",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "16px",
    padding: "16px",
    color: "#fff",
    boxShadow: "0 14px 40px rgba(0,0,0,0.28)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    marginBottom: "14px",
  },
  title: {
    margin: 0,
    fontSize: "18px",
    fontWeight: 800,
  },
  subtitle: {
    margin: "4px 0 0",
    color: "#98A2B3",
    fontSize: "13px",
  },
  badge: {
    background: "rgba(0,229,255,0.14)",
    color: "#67E8F9",
    border: "1px solid rgba(103,232,249,0.35)",
    borderRadius: "999px",
    padding: "5px 10px",
    fontSize: "12px",
    fontWeight: 700,
  },
  label: {
    display: "block",
    fontSize: "13px",
    color: "#D0D5DD",
    marginBottom: "6px",
  },
  select: {
    width: "100%",
    background: "#0B1220",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.16)",
    borderRadius: "10px",
    padding: "11px 12px",
    outline: "none",
  },
  description: {
    color: "#98A2B3",
    fontSize: "13px",
    lineHeight: 1.5,
    margin: "10px 0 14px",
  },
  actions: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
  },
  button: {
    border: "none",
    borderRadius: "10px",
    background: "#2563EB",
    color: "#fff",
    padding: "10px 14px",
    fontWeight: 800,
    cursor: "pointer",
  },
  saveButton: {
    border: "none",
    borderRadius: "10px",
    background: "#16A34A",
    color: "#fff",
    padding: "10px 14px",
    fontWeight: 800,
    cursor: "pointer",
  },
  sectorInfoBox: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "10px",
    background: "rgba(34, 197, 94, 0.1)",
    border: "1px solid rgba(34, 197, 94, 0.25)",
    color: "#BBF7D0",
    borderRadius: "12px",
    padding: "10px 12px",
    margin: "0 0 14px",
    fontSize: "13px",
    fontWeight: 800,
  },
  summaryBox: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "8px",
    marginTop: "14px",
  },
  summaryItem: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: "12px",
    padding: "10px",
  },
  summaryLabel: {
    display: "block",
    color: "#98A2B3",
    fontSize: "11px",
    marginBottom: "4px",
  },
  message: {
    margin: "12px 0 0",
    color: "#FDE68A",
    fontSize: "13px",
  },
};