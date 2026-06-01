// src/pages/CellFileManagement.jsx

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import {
  buildSiteIdMap,
  isSupportedCellFileName,
  parseCellFileText,
  prepareSectorsForInsert,
  prepareSitesForInsert,
} from "../utils/cellFileParser";

const CHUNK_SIZE = 500;

export default function CellFileManagement({ user }) {
  const fileInputRef = useRef(null);

  const [cellFiles, setCellFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [batchSites, setBatchSites] = useState([]);
  const [batchSectors, setBatchSectors] = useState([]);

  const [market, setMarket] = useState("");
  const [technology, setTechnology] = useState("");
  const [searchText, setSearchText] = useState("");
  const [marketFilter, setMarketFilter] = useState("all");
  const [techFilter, setTechFilter] = useState("all");
  const [parsedPreview, setParsedPreview] = useState(null);

  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadCellFiles();
  }, []);

  async function loadCellFiles() {
    setLoading(true);
    setMessage("");

    const { data, error } = await supabase
      .from("cell_files")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      setMessage(error.message || "Unable to load cell files.");
      setCellFiles([]);
    } else {
      setCellFiles(Array.isArray(data) ? data : []);
    }

    setLoading(false);
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];

    setParsedPreview(null);
    setSelectedBatch(null);
    setBatchSites([]);
    setBatchSectors([]);

    if (!file) {
      setSelectedFile(null);
      setMessage("");
      return;
    }

    if (!isSupportedCellFileName(file.name)) {
      setSelectedFile(null);
      setMessage("Only .txt and .csv cell files are supported in V1.");
      return;
    }

    setSelectedFile(file);
    setMessage(`Selected: ${file.name}`);
  }

  async function handleImportCellFile() {
    if (!selectedFile) {
      setMessage("Please select a .txt or .csv cell file first.");
      return;
    }

    if (!market.trim()) {
      setMessage("Please enter market name before importing.");
      return;
    }

    setImporting(true);
    setMessage("Reading cell file...");

    let createdFileId = null;

    try {
      const text = await selectedFile.text();
      const parsed = parseCellFileText(text, {
        fileName: selectedFile.name,
        market: market.trim(),
        technology: technology.trim(),
      });

      setParsedPreview(parsed);

      if (!parsed.ok) {
        const errorText = parsed.errors?.length
          ? parsed.errors.slice(0, 5).join(" | ")
          : "No valid sector records found.";
        throw new Error(errorText);
      }

      setMessage(
        `Parsed ${parsed.stats.total_sectors} sectors from ${parsed.stats.total_sites} sites. Saving to database...`
      );

      const userId = user?.id || (await getCurrentUserId());
      const { data: createdFile, error: fileError } = await supabase
        .from("cell_files")
        .insert({ ...parsed.file, uploaded_by: userId || null })
        .select("*")
        .single();

      if (fileError) throw fileError;
      createdFileId = createdFile.id;

      const siteRows = prepareSitesForInsert(parsed, createdFileId);
      const insertedSites = await insertRowsInChunks({
        tableName: "cell_sites",
        rows: siteRows,
        returning: true,
      });

      const siteIdByTempKey = buildSiteIdMap(insertedSites, parsed.sites);
      const sectorRows = prepareSectorsForInsert(parsed, createdFileId, siteIdByTempKey);

      await insertRowsInChunks({
        tableName: "cell_sectors",
        rows: sectorRows,
        returning: false,
      });

      setMessage(
        `Imported successfully: ${parsed.stats.total_sites} sites and ${parsed.stats.total_sectors} sectors.`
      );

      setSelectedFile(null);
      setMarket("");
      setTechnology("");

      if (fileInputRef.current) fileInputRef.current.value = "";

      await loadCellFiles();
      await loadBatchDetails(createdFile);
    } catch (error) {
      console.error(error);

      if (createdFileId) {
        await supabase.from("cell_files").delete().eq("id", createdFileId);
      }

      setMessage(error.message || "Cell file import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function insertRowsInChunks({ tableName, rows, returning }) {
    if (!rows?.length) return [];

    const inserted = [];

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      let query = supabase.from(tableName).insert(chunk);
      if (returning) query = query.select("*");

      const { data, error } = await query;
      if (error) throw error;
      if (returning && Array.isArray(data)) inserted.push(...data);
    }

    return inserted;
  }

  async function getCurrentUserId() {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data?.user?.id || null;
  }

  async function loadBatchDetails(batch) {
    if (!batch?.id) return;

    setDetailsLoading(true);
    setSelectedBatch(batch);
    setBatchSites([]);
    setBatchSectors([]);
    setMessage("");

    try {
      const [sitesResult, sectorsResult] = await Promise.all([
        supabase
          .from("cell_sites")
          .select("*")
          .eq("cell_file_id", batch.id)
          .order("site_name", { ascending: true }),
        supabase
          .from("cell_sectors")
          .select("*")
          .eq("cell_file_id", batch.id)
          .order("site_name", { ascending: true })
          .limit(300),
      ]);

      if (sitesResult.error) throw sitesResult.error;
      if (sectorsResult.error) throw sectorsResult.error;

      setBatchSites(Array.isArray(sitesResult.data) ? sitesResult.data : []);
      setBatchSectors(Array.isArray(sectorsResult.data) ? sectorsResult.data : []);
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Unable to load cell file details.");
    } finally {
      setDetailsLoading(false);
    }
  }

  async function deleteCellFile(batch) {
    if (!batch?.id) return;

    const ok = window.confirm(
      `Delete cell file "${batch.file_name}" and all related sites/sectors?`
    );

    if (!ok) return;

    setMessage("Deleting cell file...");

    const { error } = await supabase.from("cell_files").delete().eq("id", batch.id);

    if (error) {
      console.error(error);
      setMessage(error.message || "Unable to delete cell file.");
      return;
    }

    if (selectedBatch?.id === batch.id) {
      setSelectedBatch(null);
      setBatchSites([]);
      setBatchSectors([]);
    }

    setMessage("Cell file deleted.");
    await loadCellFiles();
  }

  const markets = useMemo(() => {
    return Array.from(new Set(cellFiles.map((file) => file.market).filter(Boolean))).sort();
  }, [cellFiles]);

  const technologies = useMemo(() => {
    return Array.from(new Set(cellFiles.map((file) => file.technology).filter(Boolean))).sort();
  }, [cellFiles]);

  const filteredCellFiles = useMemo(() => {
    const query = searchText.trim().toLowerCase();

    return cellFiles.filter((file) => {
      const matchesSearch =
        !query ||
        [file.file_name, file.market, file.technology, file.record_count, file.created_at]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);

      const matchesMarket = marketFilter === "all" || file.market === marketFilter;
      const matchesTech = techFilter === "all" || file.technology === techFilter;

      return matchesSearch && matchesMarket && matchesTech;
    });
  }, [cellFiles, searchText, marketFilter, techFilter]);

  const totals = useMemo(() => {
    const totalSectors = cellFiles.reduce((sum, file) => sum + Number(file.record_count || 0), 0);
    return {
      files: cellFiles.length,
      filtered: filteredCellFiles.length,
      sectors: totalSectors,
      markets: markets.length,
      technologies: technologies.length,
    };
  }, [cellFiles, filteredCellFiles, markets, technologies]);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Cell File Management</h2>
          <p style={styles.subtitle}>Import RF cell files and prepare site/sector layers for all BabyDragon maps.</p>
        </div>
        <button type="button" onClick={loadCellFiles} disabled={loading || importing} style={styles.secondaryButton}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {message && <div style={styles.message}>{message}</div>}

      <div style={styles.statsGrid}>
        <StatCard label="Cell Files" value={totals.files} />
        <StatCard label="Filtered" value={totals.filtered} />
        <StatCard label="Sectors" value={totals.sectors} tone="green" />
        <StatCard label="Markets" value={totals.markets} />
        <StatCard label="Techs" value={totals.technologies} />
      </div>

      <div style={styles.gridTwo}>
        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <h3 style={styles.cardTitle}>Import Cell File</h3>
              <p style={styles.cardText}>Supported columns: SYSTEM, SITE, LAT, LON, CELL_NAME, CID, DIR, ANT_BW, LAC, MCC, MNC, EARFCN, PCI.</p>
            </div>
          </div>

          <div style={styles.formGrid}>
            <label style={styles.label}>
              Market
              <input value={market} onChange={(event) => setMarket(event.target.value)} placeholder="Example: Dallas" style={styles.input} />
            </label>
            <label style={styles.label}>
              Default Technology
              <select value={technology} onChange={(event) => setTechnology(event.target.value)} style={styles.input}>
                <option value="">Auto Detect</option>
                <option value="LTE">LTE</option>
                <option value="5G">5G</option>
                <option value="3G">3G</option>
                <option value="2G">2G</option>
              </select>
            </label>
          </div>

          <div style={styles.uploadBox}>
            <input ref={fileInputRef} type="file" accept=".txt,.csv" onChange={handleFileChange} style={styles.fileInput} />
            <div style={styles.fileInfo}>
              <strong>{selectedFile ? selectedFile.name : "No file selected"}</strong>
              <span>{selectedFile ? `${formatBytes(selectedFile.size)} ready to import` : "Choose a .txt or .csv cell file"}</span>
            </div>
          </div>

          <button type="button" onClick={handleImportCellFile} disabled={importing} style={styles.primaryButton}>
            {importing ? "Importing..." : "Import Cell File"}
          </button>

          {parsedPreview && (
            <div style={styles.previewBox}>
              <strong>Last Parse Preview</strong>
              <div style={styles.previewGrid}>
                <span>Sites: {parsedPreview.stats.total_sites}</span>
                <span>Sectors: {parsedPreview.stats.total_sectors}</span>
                <span>Tech: {parsedPreview.stats.technologies?.length ? parsedPreview.stats.technologies.join(", ") : "N/A"}</span>
              </div>
              {!!parsedPreview.errors?.length && <div style={styles.errorText}>{parsedPreview.errors.slice(0, 5).join(" | ")}</div>}
              {!!parsedPreview.warnings?.length && <div style={styles.warningText}>{parsedPreview.warnings.slice(0, 5).join(" | ")}</div>}
            </div>
          )}
        </section>

        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <h3 style={styles.cardTitle}>Filters</h3>
              <p style={styles.cardText}>Find imported cell files by market, technology, or file name.</p>
            </div>
          </div>

          <div style={styles.filterStack}>
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search file, market, technology..." style={styles.input} />
            <select value={marketFilter} onChange={(event) => setMarketFilter(event.target.value)} style={styles.input}>
              <option value="all">All Markets</option>
              {markets.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select value={techFilter} onChange={(event) => setTechFilter(event.target.value)} style={styles.input}>
              <option value="all">All Technologies</option>
              {technologies.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <button type="button" onClick={() => { setSearchText(""); setMarketFilter("all"); setTechFilter("all"); }} style={styles.secondaryButton}>Clear Filters</button>
          </div>
        </section>
      </div>

      <section style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <h3 style={styles.cardTitle}>Imported Cell Files</h3>
            <p style={styles.cardText}>These files feed the site and sector overlay layer for maps.</p>
          </div>
        </div>

        {loading ? <div style={styles.emptyState}>Loading cell files...</div> : filteredCellFiles.length === 0 ? <div style={styles.emptyState}>No imported cell files found.</div> : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>File</th>
                  <th style={styles.th}>Market</th>
                  <th style={styles.th}>Technology</th>
                  <th style={styles.th}>Sectors</th>
                  <th style={styles.th}>Imported</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCellFiles.map((file) => (
                  <tr key={file.id} style={styles.tr}>
                    <td style={styles.td}><strong>{file.file_name}</strong></td>
                    <td style={styles.td}>{file.market || "N/A"}</td>
                    <td style={styles.td}>{file.technology || "N/A"}</td>
                    <td style={styles.td}>{file.record_count || 0}</td>
                    <td style={styles.td}>{formatDate(file.created_at)}</td>
                    <td style={styles.td}>
                      <div style={styles.actionRow}>
                        <button type="button" onClick={() => loadBatchDetails(file)} style={styles.smallButton}>View</button>
                        <button type="button" onClick={() => deleteCellFile(file)} style={styles.dangerButton}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedBatch && (
        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <h3 style={styles.cardTitle}>Selected Cell File Details</h3>
              <p style={styles.cardText}>{selectedBatch.file_name} - {selectedBatch.market || "N/A"} - {selectedBatch.technology || "N/A"}</p>
            </div>
            <button type="button" onClick={() => { setSelectedBatch(null); setBatchSites([]); setBatchSectors([]); }} style={styles.secondaryButton}>Close</button>
          </div>

          {detailsLoading ? <div style={styles.emptyState}>Loading details...</div> : (
            <>
              <div style={styles.statsGrid}>
                <StatCard label="Sites" value={batchSites.length} />
                <StatCard label="Preview Sectors" value={batchSectors.length} />
                <StatCard label="Total Sectors" value={selectedBatch.record_count || 0} tone="green" />
              </div>

              <h4 style={styles.sectionMiniTitle}>Sites</h4>
              {batchSites.length === 0 ? <div style={styles.emptyState}>No sites found for this file.</div> : (
                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead><tr><th style={styles.th}>Site</th><th style={styles.th}>Technology</th><th style={styles.th}>Latitude</th><th style={styles.th}>Longitude</th></tr></thead>
                    <tbody>{batchSites.slice(0, 100).map((site) => <tr key={site.id} style={styles.tr}><td style={styles.td}>{site.site_name}</td><td style={styles.td}>{site.technology || "N/A"}</td><td style={styles.td}>{site.lat}</td><td style={styles.td}>{site.lon}</td></tr>)}</tbody>
                  </table>
                </div>
              )}

              <h4 style={styles.sectionMiniTitle}>Sector Preview <span style={styles.mutedText}>showing max 300 records for page speed</span></h4>
              {batchSectors.length === 0 ? <div style={styles.emptyState}>No sectors found for this file.</div> : (
                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead><tr><th style={styles.th}>Site</th><th style={styles.th}>Cell</th><th style={styles.th}>PCI</th><th style={styles.th}>EARFCN</th><th style={styles.th}>Azimuth</th><th style={styles.th}>BW</th><th style={styles.th}>CID</th></tr></thead>
                    <tbody>{batchSectors.map((sector) => <tr key={sector.id} style={styles.tr}><td style={styles.td}>{sector.site_name || "N/A"}</td><td style={styles.td}>{sector.cell_name || "N/A"}</td><td style={styles.td}>{sector.pci || "N/A"}</td><td style={styles.td}>{sector.earfcn || "N/A"}</td><td style={styles.td}>{sector.azimuth ?? "N/A"}</td><td style={styles.td}>{sector.antenna_bw ?? "N/A"}</td><td style={styles.td}>{sector.cid || "N/A"}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={{ ...styles.statValue, color: tone === "green" ? "#22c55e" : "#38bdf8" }}>{value}</div>
    </div>
  );
}

function formatDate(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString();
}

function formatBytes(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size)) return "N/A";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = {
  page: { width: "100%", color: "#e5eefc" },
  header: { display: "flex", justifyContent: "space-between", gap: "14px", alignItems: "flex-start", marginBottom: "14px" },
  title: { margin: 0, fontSize: "22px", fontWeight: 900, color: "#f8fafc" },
  subtitle: { margin: "6px 0 0", fontSize: "13px", color: "#9fb3c8" },
  message: { border: "1px solid rgba(56, 189, 248, 0.35)", background: "rgba(14, 165, 233, 0.1)", color: "#dff6ff", borderRadius: "14px", padding: "10px 12px", fontSize: "13px", marginBottom: "14px" },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "10px", marginBottom: "14px" },
  statCard: { border: "1px solid rgba(148, 163, 184, 0.25)", background: "#111827", borderRadius: "14px", padding: "12px", textAlign: "center" },
  statLabel: { fontSize: "11px", color: "#9fb3c8", marginBottom: "5px" },
  statValue: { fontSize: "22px", fontWeight: 900 },
  gridTwo: { display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(260px, 0.75fr)", gap: "14px", marginBottom: "14px" },
  card: { border: "1px solid rgba(148, 163, 184, 0.25)", background: "#111827", borderRadius: "16px", padding: "14px", marginBottom: "14px" },
  cardHeader: { display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start", marginBottom: "12px" },
  cardTitle: { margin: 0, fontSize: "16px", fontWeight: 900, color: "#f8fafc" },
  cardText: { margin: "5px 0 0", fontSize: "12px", color: "#9fb3c8", lineHeight: 1.5 },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", marginBottom: "12px" },
  label: { display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", color: "#cbd5e1", fontWeight: 800 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid rgba(148, 163, 184, 0.35)", background: "#07111f", color: "#e5eefc", borderRadius: "12px", padding: "10px 11px", outline: "none", fontSize: "13px" },
  uploadBox: { border: "1px dashed rgba(56, 189, 248, 0.45)", background: "rgba(15, 23, 42, 0.75)", borderRadius: "14px", padding: "12px", marginBottom: "12px" },
  fileInput: { width: "100%", color: "#cbd5e1", marginBottom: "10px" },
  fileInfo: { display: "flex", flexDirection: "column", gap: "4px", color: "#e5eefc", fontSize: "13px" },
  primaryButton: { border: "none", borderRadius: "12px", padding: "10px 14px", background: "linear-gradient(135deg, #22c55e, #06b6d4)", color: "#04111f", fontWeight: 900, cursor: "pointer" },
  secondaryButton: { border: "1px solid rgba(148, 163, 184, 0.35)", borderRadius: "12px", padding: "9px 12px", background: "#07111f", color: "#e5eefc", fontWeight: 800, cursor: "pointer", fontSize: "12px" },
  smallButton: { border: "1px solid rgba(56, 189, 248, 0.45)", borderRadius: "10px", padding: "7px 10px", background: "rgba(14, 165, 233, 0.12)", color: "#bae6fd", fontWeight: 800, cursor: "pointer", fontSize: "12px" },
  dangerButton: { border: "1px solid rgba(248, 113, 113, 0.45)", borderRadius: "10px", padding: "7px 10px", background: "rgba(239, 68, 68, 0.12)", color: "#fecaca", fontWeight: 800, cursor: "pointer", fontSize: "12px" },
  filterStack: { display: "grid", gap: "10px" },
  previewBox: { marginTop: "12px", border: "1px solid rgba(148, 163, 184, 0.25)", background: "#0b1220", borderRadius: "14px", padding: "12px", fontSize: "12px", color: "#cbd5e1" },
  previewGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px", marginTop: "8px" },
  errorText: { marginTop: "8px", color: "#fecaca" },
  warningText: { marginTop: "8px", color: "#fde68a" },
  tableWrap: { overflowX: "auto", border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: "14px" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: "760px" },
  th: { textAlign: "left", padding: "10px", fontSize: "11px", color: "#93c5fd", background: "#0b1220", borderBottom: "1px solid rgba(148, 163, 184, 0.18)", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid rgba(148, 163, 184, 0.12)" },
  td: { padding: "10px", fontSize: "12px", color: "#dbeafe", verticalAlign: "top", whiteSpace: "nowrap" },
  actionRow: { display: "flex", gap: "8px", flexWrap: "wrap" },
  emptyState: { border: "1px solid rgba(148, 163, 184, 0.18)", background: "#0b1220", borderRadius: "14px", padding: "18px", color: "#9fb3c8", textAlign: "center", fontSize: "13px" },
  sectionMiniTitle: { margin: "16px 0 10px", color: "#f8fafc", fontSize: "14px" },
  mutedText: { color: "#94a3b8", fontWeight: 500, fontSize: "11px" },
};
