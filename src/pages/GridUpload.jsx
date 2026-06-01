import { useRef, useState } from "react";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { supabase } from "../lib/supabaseClient";
import GridMap from "../components/GridMap";

export default function GridUpload({ filters }) {
  const fileInputRef = useRef(null);

  const [market, setMarket] = useState("");
  const [fileName, setFileName] = useState("");
  const [message, setMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [showImportTools, setShowImportTools] = useState(false);

  const handleFileChange = (e) => {
    const file = e.target.files[0];

    if (!file) {
      setFileName("");
      return;
    }

    setFileName(file.name);
    setMessage("File selected. Ready to import.");
  };

  const readFileContent = async (file) => {
    const lowerName = file.name.toLowerCase();

    if (lowerName.endsWith(".kml")) {
      return await file.text();
    }

    if (lowerName.endsWith(".kmz")) {
      const zip = await JSZip.loadAsync(file);
      const kmlFileName = Object.keys(zip.files).find((name) =>
        name.toLowerCase().endsWith(".kml")
      );

      if (!kmlFileName) {
        throw new Error("No KML file found inside KMZ.");
      }

      return await zip.files[kmlFileName].async("text");
    }

    throw new Error("Only KML or KMZ files are supported.");
  };

  const collectPlacemarks = (node, result = []) => {
    if (!node || typeof node !== "object") return result;

    if (node.Placemark) {
      if (Array.isArray(node.Placemark)) {
        result.push(...node.Placemark);
      } else {
        result.push(node.Placemark);
      }
    }

    Object.values(node).forEach((value) => {
      if (Array.isArray(value)) {
        value.forEach((item) => collectPlacemarks(item, result));
      } else if (value && typeof value === "object") {
        collectPlacemarks(value, result);
      }
    });

    return result;
  };

  const extractCoordinates = (placemark) => {
    const coordinates =
      placemark?.Polygon?.outerBoundaryIs?.LinearRing?.coordinates ||
      placemark?.MultiGeometry?.Polygon?.outerBoundaryIs?.LinearRing
        ?.coordinates;

    if (!coordinates) return null;

    return String(coordinates)
      .trim()
      .split(/\s+/)
      .map((item) => {
        const [lng, lat] = item.split(",").map(Number);
        return [lng, lat];
      })
      .filter(([lng, lat]) => !Number.isNaN(lng) && !Number.isNaN(lat));
  };

  const clearImportForm = () => {
    setMarket("");
    setFileName("");
    setMessage("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleUpload = async () => {
    try {
      const file = fileInputRef.current?.files?.[0];

      if (!market.trim()) {
        setMessage("Please enter market before importing grids.");
        return;
      }

      if (!file) {
        setMessage("Please select a KML or KMZ file first.");
        return;
      }

      setUploading(true);
      setMessage("Reading file...");

      const text = await readFileContent(file);

      const parser = new XMLParser({
        ignoreAttributes: false,
        trimValues: true,
      });

      const json = parser.parse(text);
      const placemarks = collectPlacemarks(json);

      if (!placemarks || placemarks.length === 0) {
        setMessage("No placemarks found in this file.");
        setUploading(false);
        return;
      }

      const rows = [];

      placemarks.forEach((pm, index) => {
        const name =
          typeof pm.name === "string"
            ? pm.name
            : pm.name?.["#text"] || `Grid ${index + 1}`;

        const coords = extractCoordinates(pm);

        if (!coords || coords.length < 3) return;

        rows.push({
          name,
          market: market.trim(),
          geometry: {
            type: "Polygon",
            coordinates: [coords],
          },
        });
      });

      if (rows.length === 0) {
        setMessage("No valid polygon grids found.");
        setUploading(false);
        return;
      }

      setMessage(`Saving ${rows.length} grids in batches...`);

      const batchSize = 500;
      let savedCount = 0;

      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);

        const { error } = await supabase.from("grids").insert(batch);

        if (error) {
          console.error(error);
          setMessage(
            `Error saving batch ${Math.floor(i / batchSize) + 1}: ${error.message}. Saved ${savedCount} of ${rows.length} grids.`
          );
          setUploading(false);
          return;
        }

        savedCount += batch.length;
        setMessage(`Saving grids... ${savedCount} of ${rows.length} saved.`);
      }

      setMessage(`${savedCount} grids imported successfully.`);
      setMarket("");
      setFileName("");

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      setRefreshKey((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setMessage(`Import error: ${err.message}`);
    }

    setUploading(false);
  };

  return (
    <div className="bd-grid-page">
      <style>{`
        .bd-grid-page {
          --grid-card: #ffffff;
          --grid-soft-card: #f8fbff;
          --grid-border: #b9d4ff;
          --grid-border-soft: #d4e4ff;
          --grid-text: #071a33;
          --grid-muted: #35506f;
          --grid-blue: #2563eb;
          --grid-cyan: #06c7e8;
          --grid-success: #16a34a;
          color: var(--grid-text);
          padding: 12px;
        }

        body.bd-theme-night .bd-grid-page,
        .theme-night .bd-grid-page,
        body.dark .bd-grid-page,
        body.dark-mode .bd-grid-page,
        body.night .bd-grid-page,
        body.theme-dark .bd-grid-page,
        .bd-theme-night .bd-grid-page,
        .dark .bd-grid-page,
        .dark-mode .bd-grid-page,
        .night .bd-grid-page,
        .theme-dark .bd-grid-page,
        [data-theme="dark"] .bd-grid-page {
          --grid-card: #0b1b31;
          --grid-soft-card: #081525;
          --grid-border: #1f4b79;
          --grid-border-soft: #18395f;
          --grid-text: #edf6ff;
          --grid-muted: #a9c9ee;
          --grid-blue: #60a5fa;
          --grid-cyan: #22d3ee;
          --grid-success: #34d399;
        }

        .bd-grid-hero,
        .bd-grid-import,
        .bd-grid-import-closed {
          background: var(--grid-card);
          border: 1px solid var(--grid-border);
          border-radius: 18px;
          box-shadow: 0 14px 34px rgba(15, 44, 85, 0.08);
          text-align: left;
        }

        body.bd-theme-night .bd-grid-hero,
        .theme-night .bd-grid-hero,
        body.bd-theme-night .bd-grid-import,
        .theme-night .bd-grid-import,
        body.bd-theme-night .bd-grid-import-closed,
        .theme-night .bd-grid-import-closed,
        .bd-theme-night .bd-grid-hero,
        .bd-theme-night .bd-grid-import,
        .bd-theme-night .bd-grid-import-closed {
          box-shadow: none;
        }



        .theme-night .bd-grid-hero,
        .theme-night .bd-grid-import,
        .theme-night .bd-grid-import-closed,
        body.bd-theme-night .bd-grid-hero,
        body.bd-theme-night .bd-grid-import,
        body.bd-theme-night .bd-grid-import-closed {
          background: #0b1b31 !important;
          border-color: #1f4b79 !important;
          color: #edf6ff !important;
          box-shadow: none !important;
        }

        .theme-night .bd-grid-title,
        .theme-night .bd-grid-mini-title,
        .theme-night .bd-grid-import-head h3,
        body.bd-theme-night .bd-grid-title,
        body.bd-theme-night .bd-grid-mini-title,
        body.bd-theme-night .bd-grid-import-head h3 {
          color: #edf6ff !important;
        }

        .theme-night .bd-grid-subtitle,
        .theme-night .bd-grid-mini-subtitle,
        .theme-night .bd-grid-import-head p,
        body.bd-theme-night .bd-grid-subtitle,
        body.bd-theme-night .bd-grid-mini-subtitle,
        body.bd-theme-night .bd-grid-import-head p {
          color: #a9c9ee !important;
        }

        .bd-grid-hero {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          padding: 18px 22px;
          margin-bottom: 14px;
        }

        .bd-grid-hero > div:first-child,
        .bd-grid-import-closed > div,
        .bd-grid-import-head > div {
          text-align: left;
        }

        .bd-grid-kicker {
          color: var(--grid-blue);
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          margin-bottom: 8px;
        }

        .bd-grid-title {
          margin: 0;
          font-size: 26px;
          line-height: 1.1;
          font-weight: 900;
          color: var(--grid-text);
        }

        .bd-grid-subtitle {
          margin: 6px 0 0;
          color: var(--grid-muted);
          font-weight: 650;
          line-height: 1.35;
        }

        .bd-grid-pill {
          flex: 0 0 auto;
          border: 1px solid var(--grid-border);
          border-radius: 999px;
          padding: 12px 18px;
          color: var(--grid-blue);
          font-weight: 900;
          background: linear-gradient(90deg, rgba(37, 99, 235, 0.08), rgba(6, 199, 232, 0.08));
          white-space: nowrap;
        }

        .bd-grid-import-closed {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 14px 18px;
          margin-bottom: 14px;
        }

        .bd-grid-mini-title {
          margin: 0 0 4px;
          color: var(--grid-text);
          font-weight: 900;
        }

        .bd-grid-mini-subtitle {
          margin: 0;
          color: var(--grid-muted);
          font-size: 13px;
          font-weight: 650;
        }

        .bd-grid-import {
          padding: 16px 18px 18px;
          margin-bottom: 14px;
        }

        .bd-grid-import-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          border-bottom: 1px solid var(--grid-border-soft);
          padding-bottom: 12px;
          margin-bottom: 14px;
        }

        .bd-grid-import-head h3 {
          margin: 0 0 4px;
          font-size: 18px;
          color: var(--grid-text);
        }

        .bd-grid-import-head p {
          margin: 0;
          color: var(--grid-muted);
          font-weight: 650;
          font-size: 13px;
        }

        .bd-grid-form {
          display: grid;
          grid-template-columns: 1fr 1.3fr;
          gap: 12px;
          align-items: end;
        }

        .bd-grid-field label {
          display: block;
          margin: 0 0 7px;
          color: var(--grid-text);
          font-weight: 900;
          font-size: 13px;
        }

        .bd-grid-field input {
          width: 100%;
          min-height: 42px;
          border: 1px solid var(--grid-border);
          border-radius: 12px;
          padding: 0 12px;
          background: var(--grid-soft-card);
          color: var(--grid-text);
          font-weight: 650;
          outline: none;
          box-sizing: border-box;
        }

        .bd-grid-field input:focus {
          border-color: var(--grid-blue);
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.16);
        }

        .bd-grid-actions {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
          align-items: center;
          margin-top: 14px;
        }

        .bd-grid-btn,
        .bd-grid-btn-soft {
          border: 1px solid var(--grid-border);
          border-radius: 12px;
          padding: 11px 18px;
          font-weight: 900;
          cursor: pointer;
        }

        .bd-grid-btn {
          min-width: 170px;
          color: #fff;
          border: 0;
          background: linear-gradient(90deg, #2563eb, #06c7e8);
        }

        .bd-grid-btn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }

        .bd-grid-btn-soft {
          background: var(--grid-soft-card);
          color: var(--grid-text);
        }

        .bd-grid-import-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 12px;
        }

        .bd-grid-status-chip {
          border: 1px solid var(--grid-border);
          border-radius: 999px;
          background: var(--grid-soft-card);
          color: var(--grid-text);
          padding: 8px 12px;
          font-size: 12px;
          font-weight: 850;
        }

        .bd-grid-message {
          margin-top: 12px;
          border: 1px solid rgba(22, 163, 74, 0.35);
          border-radius: 14px;
          padding: 12px 14px;
          background: rgba(22, 163, 74, 0.1);
          color: var(--grid-success);
          font-weight: 900;
        }

        @media (max-width: 900px) {
          .bd-grid-hero,
          .bd-grid-import-closed,
          .bd-grid-import-head {
            align-items: stretch;
            flex-direction: column;
          }

          .bd-grid-pill {
            text-align: center;
            white-space: normal;
          }

          .bd-grid-form {
            grid-template-columns: 1fr;
          }

          .bd-grid-actions {
            flex-direction: column;
          }

          .bd-grid-btn,
          .bd-grid-btn-soft {
            width: 100%;
          }
        }
      `}</style>

      <section className="bd-grid-hero">
        <div>
          <div className="bd-grid-kicker">Route Management</div>
          <h2 className="bd-grid-title">Grid Management</h2>
          <p className="bd-grid-subtitle">
            Import KML/KMZ grid boundaries, draw manual grids, filter large markets, and manage grid records.
          </p>
        </div>
        <div className="bd-grid-pill">Import → Draw → Validate → Assign</div>
      </section>

      {!showImportTools ? (
        <section className="bd-grid-import-closed">
          <div>
            <p className="bd-grid-mini-title">Import tools are hidden to keep the grid map clean.</p>
            <p className="bd-grid-mini-subtitle">
              Open this only when adding KML/KMZ files. Existing grid map, drawing tools, and records stay below.
            </p>
          </div>
          <button
            type="button"
            className="bd-grid-btn-soft"
            onClick={() => setShowImportTools(true)}
          >
            Show Import Tools
          </button>
        </section>
      ) : (
        <section className="bd-grid-import">
          <div className="bd-grid-import-head">
            <div>
              <h3>Import Grids from KML / KMZ</h3>
              <p>
                Use a clear market name before importing. Large KML/KMZ files are saved in 500-grid batches.
              </p>
            </div>
            <button
              type="button"
              className="bd-grid-btn-soft"
              onClick={() => setShowImportTools(false)}
            >
              Hide Import Tools
            </button>
          </div>

          <div className="bd-grid-form">
            <div className="bd-grid-field">
              <label>Market *</label>
              <input
                type="text"
                placeholder="Example: Dallas, Alaska, Josephine TX"
                value={market}
                onChange={(e) => setMarket(e.target.value)}
              />
            </div>

            <div className="bd-grid-field">
              <label>KML / KMZ File *</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".kml,.kmz"
                onChange={handleFileChange}
              />
            </div>
          </div>

          <div className="bd-grid-actions">
            <button type="button" className="bd-grid-btn-soft" onClick={clearImportForm}>
              Clear Import Form
            </button>
            <button type="button" className="bd-grid-btn" onClick={handleUpload} disabled={uploading}>
              {uploading ? "Importing..." : "Upload Grid"}
            </button>
          </div>

          {(fileName || uploading) && (
            <div className="bd-grid-import-meta">
              {fileName && <span className="bd-grid-status-chip">Selected file: {fileName}</span>}
              {uploading && <span className="bd-grid-status-chip">Import running...</span>}
            </div>
          )}

          {message && <div className="bd-grid-message">{message}</div>}
        </section>
      )}

      <GridMap refreshKey={refreshKey} dashboardFilters={filters} />
    </div>
  );
}
