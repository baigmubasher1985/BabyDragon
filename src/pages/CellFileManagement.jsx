// src/pages/CellFileManagement.jsx

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

import {
  isSupportedCellFileName,
  parseCellFileText,
  prepareSitesForInsert,
  prepareSectorsForInsert,
  buildSiteIdMap,
} from "../utils/cellFileParser";

import { isKmlKmzFileName, parseCellKmlFile } from "../utils/cellKmlParser";

const CHUNK_SIZE = 500;

export default function CellFileManagement({ user }) {
  const fileInputRef = useRef(null);
  const isDark = useDarkMode();
  const styles = useMemo(() => createStyles(isDark), [isDark]);

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

  const [showImportTools, setShowImportTools] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  const [tableLimit, setTableLimit] = useState(25);

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
      setMessage("Only .txt, .csv, .kml, and .kmz cell files are supported.");
      return;
    }

    setSelectedFile(file);
    setMessage(`Selected: ${file.name}`);
  }

  async function handleImportCellFile() {
    if (!selectedFile) {
      setMessage("Please select a .txt, .csv, .kml, or .kmz cell file first.");
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
      const parserOptions = {
        fileName: selectedFile.name,
        market: market.trim(),
        technology: technology.trim(),
      };

      let parsed;

      if (isKmlKmzFileName(selectedFile.name)) {
        parsed = await parseCellKmlFile(selectedFile, parserOptions);
      } else {
        const text = await selectedFile.text();
        parsed = parseCellFileText(text, parserOptions);
      }

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

      const filePayload = {
        ...parsed.file,
        uploaded_by: userId || null,
      };

      const { data: createdFile, error: fileError } = await supabase
        .from("cell_files")
        .insert(filePayload)
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

      const sectorRows = prepareSectorsForInsert(
        parsed,
        createdFileId,
        siteIdByTempKey
      );

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

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      await loadCellFiles();
      await loadBatchDetails(createdFile);
      setShowRecords(true);
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

      if (returning) {
        query = query.select("*");
      }

      const { data, error } = await query;

      if (error) throw error;

      if (returning && Array.isArray(data)) {
        inserted.push(...data);
      }
    }

    return inserted;
  }

  async function getCurrentUserId() {
    const { data, error } = await supabase.auth.getUser();

    if (error) {
      console.warn(error);
      return null;
    }

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

    const { error } = await supabase
      .from("cell_files")
      .delete()
      .eq("id", batch.id);

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
    const values = new Set();

    cellFiles.forEach((file) => {
      if (file.market) values.add(file.market);
    });

    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [cellFiles]);

  const technologies = useMemo(() => {
    const values = new Set();

    cellFiles.forEach((file) => {
      if (file.technology) values.add(file.technology);
    });

    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [cellFiles]);

  const filteredCellFiles = useMemo(() => {
    const query = searchText.trim().toLowerCase();

    return cellFiles.filter((file) => {
      const matchesSearch =
        !query ||
        [
          file.file_name,
          file.market,
          file.technology,
          file.record_count,
          file.created_at,
        ]
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
    const totalSectors = cellFiles.reduce((sum, file) => {
      return sum + Number(file.record_count || 0);
    }, 0);

    return {
      files: cellFiles.length,
      filtered: filteredCellFiles.length,
      sectors: totalSectors,
      markets: markets.length,
      technologies: technologies.length,
    };
  }, [cellFiles, filteredCellFiles, markets, technologies]);

  const recordsAutoOpen = false;
  const recordsVisible = showRecords;
  const visibleCellFiles = filteredCellFiles.slice(0, tableLimit);

  return (
    <div style={styles.page}>
      <section style={styles.heroCard}>
        <div style={styles.heroCopy}>
          <div style={styles.eyebrow}>ROUTE MANAGEMENT</div>
          <h2 style={styles.title}>Cell File Management</h2>
          <p style={styles.subtitle}>
            Import RF cell files, validate sectors, and publish site/sector layers for BabyDragon maps.
          </p>
        </div>

        <div style={styles.workflowPill}>Import → Parse → Sector Layer → Map</div>
      </section>

      {message && <div style={styles.message}>{message}</div>}

      <div style={styles.statsGrid}>
        <StatCard label="Cell Files" value={totals.files} styles={styles} />
        <StatCard label="Filtered" value={totals.filtered} styles={styles} />
        <StatCard label="Sectors" value={totals.sectors} tone="green" styles={styles} />
        <StatCard label="Markets" value={totals.markets} styles={styles} />
        <StatCard label="Techs" value={totals.technologies} styles={styles} />
      </div>

      <section style={styles.utilityCard}>
        <div style={styles.utilityCopy}>
          <h3 style={styles.utilityTitle}>Import tools are hidden to keep the page clean.</h3>
          <p style={styles.utilityText}>
            Open this only when adding TXT, CSV, KML, or KMZ cell files. Existing files and filters stay available below.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowImportTools((value) => !value)}
          style={styles.secondaryButton}
        >
          {showImportTools ? "Hide Import Tools" : "Show Import Tools"}
        </button>
      </section>

      {showImportTools && (
        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <div style={styles.cardEyebrow}>CELL FILE IMPORT</div>
              <h3 style={styles.cardTitle}>Import Cell File</h3>
              <p style={styles.cardText}>
                Supported formats: TXT, CSV, KML, KMZ. Expected columns/attributes include SYSTEM, SITE, LAT, LON, CELL_NAME, CID, DIR, ANT_BW, LAC, MCC, MNC, EARFCN, and PCI.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setSelectedFile(null);
                setMarket("");
                setTechnology("");
                setParsedPreview(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              style={styles.ghostButton}
            >
              Clear Import Form
            </button>
          </div>

          <div style={styles.formGrid}>
            <label style={styles.label}>
              Market *
              <input
                value={market}
                onChange={(event) => setMarket(event.target.value)}
                placeholder="Example: Dallas"
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Default Technology
              <select
                value={technology}
                onChange={(event) => setTechnology(event.target.value)}
                style={styles.input}
              >
                <option value="">Auto Detect</option>
                <option value="LTE">LTE</option>
                <option value="5G">5G / NR</option>
                <option value="3G">3G</option>
                <option value="2G">2G</option>
              </select>
            </label>
          </div>

          <div style={styles.uploadBox}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.csv,.kml,.kmz"
              onChange={handleFileChange}
              style={styles.fileInput}
            />

            <div style={styles.fileInfo}>
              <strong>{selectedFile ? selectedFile.name : "No file selected"}</strong>
              <span>
                {selectedFile
                  ? `${formatBytes(selectedFile.size)} ready to import`
                  : "Choose a .txt, .csv, .kml, or .kmz cell file"}
              </span>
            </div>
          </div>

          <div style={styles.buttonRow}>
            <button
              type="button"
              onClick={handleImportCellFile}
              disabled={importing}
              style={{ ...styles.primaryButton, opacity: importing ? 0.7 : 1 }}
            >
              {importing ? "Importing..." : "Import Cell File"}
            </button>
          </div>

          {parsedPreview && (
            <div style={styles.previewBox}>
              <strong>Last Parse Preview</strong>

              <div style={styles.previewGrid}>
                <span>Sites: {parsedPreview.stats.total_sites}</span>
                <span>Sectors: {parsedPreview.stats.total_sectors}</span>
                <span>
                  Tech: {" "}
                  {parsedPreview.stats.technologies?.length
                    ? parsedPreview.stats.technologies.join(", ")
                    : parsedPreview.file?.technology || "N/A"}
                </span>
              </div>

              {!!parsedPreview.errors?.length && (
                <div style={styles.errorText}>{parsedPreview.errors.slice(0, 5).join(" | ")}</div>
              )}

              {!!parsedPreview.warnings?.length && (
                <div style={styles.warningText}>{parsedPreview.warnings.slice(0, 5).join(" | ")}</div>
              )}
            </div>
          )}
        </section>
      )}

      <section style={styles.card}>
        <div style={styles.cardHeaderCompact}>
          <div>
            <div style={styles.cardEyebrow}>CELL FILE LIBRARY</div>
            <h3 style={styles.cardTitle}>Filters</h3>
            <p style={styles.cardText}>Find imported cell files by file name, market, or technology.</p>
          </div>

          <button
            type="button"
            onClick={loadCellFiles}
            disabled={loading || importing}
            style={styles.secondaryButton}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div style={styles.filterGrid}>
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search file, market, technology..."
            style={styles.input}
          />

          <select
            value={marketFilter}
            onChange={(event) => setMarketFilter(event.target.value)}
            style={styles.input}
          >
            <option value="all">All Markets</option>
            {markets.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <select
            value={techFilter}
            onChange={(event) => setTechFilter(event.target.value)}
            style={styles.input}
          >
            <option value="all">All Technologies</option>
            {technologies.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              setSearchText("");
              setMarketFilter("all");
              setTechFilter("all");
            }}
            style={styles.secondaryButton}
          >
            Clear Filters
          </button>
        </div>
      </section>

      <section style={styles.card}>
        <div style={styles.cardHeaderCompact}>
          <div>
            <div style={styles.cardEyebrow}>MAP LAYER SOURCE</div>
            <h3 style={styles.cardTitle}>Imported Cell Files</h3>
            <p style={styles.cardText}>
              These files feed the site and sector overlay layer for all supported maps.
            </p>
          </div>

          <div style={styles.recordsControls}>
            <label style={styles.smallLabel}>
              Table Limit
              <select
                value={tableLimit}
                onChange={(event) => setTableLimit(Number(event.target.value))}
                style={styles.smallSelect}
              >
                <option value={25}>25 rows</option>
                <option value={50}>50 rows</option>
                <option value={100}>100 rows</option>
              </select>
            </label>

            {filteredCellFiles.length > 0 && (
              <button
                type="button"
                onClick={() => setShowRecords((value) => !value)}
                style={styles.secondaryButton}
              >
                {recordsVisible ? "Hide Cell File Records" : `Show Cell File Records (${filteredCellFiles.length})`}
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div style={styles.emptyState}>Loading cell files...</div>
        ) : filteredCellFiles.length === 0 ? (
          <div style={styles.emptyState}>No imported cell files found.</div>
        ) : !recordsVisible ? (
          <div style={styles.hiddenRecordsBox}>
            Imported cell file details are hidden to keep the page clean. {filteredCellFiles.length} filtered file(s) are available.
          </div>
        ) : (
          <>
            <div style={styles.tableMeta}>
              Showing {visibleCellFiles.length} of {filteredCellFiles.length} imported cell file(s)
            </div>

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
                  {visibleCellFiles.map((file) => (
                    <tr key={file.id} style={styles.tr}>
                      <td style={styles.td}>
                        <strong>{file.file_name}</strong>
                      </td>
                      <td style={styles.td}>{file.market || "N/A"}</td>
                      <td style={styles.td}>{file.technology || "N/A"}</td>
                      <td style={styles.td}>{file.record_count || 0}</td>
                      <td style={styles.td}>{formatDate(file.created_at)}</td>
                      <td style={styles.td}>
                        <div style={styles.actionRow}>
                          <button
                            type="button"
                            onClick={() => loadBatchDetails(file)}
                            style={styles.smallButton}
                          >
                            View
                          </button>

                          <button
                            type="button"
                            onClick={() => deleteCellFile(file)}
                            style={styles.dangerButton}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {selectedBatch && (
        <section style={styles.card}>
          <div style={styles.cardHeaderCompact}>
            <div>
              <div style={styles.cardEyebrow}>CELL FILE DETAILS</div>
              <h3 style={styles.cardTitle}>Selected Cell File Details</h3>
              <p style={styles.cardText}>
                {selectedBatch.file_name} • {selectedBatch.market || "N/A"} • {selectedBatch.technology || "N/A"}
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setSelectedBatch(null);
                setBatchSites([]);
                setBatchSectors([]);
              }}
              style={styles.secondaryButton}
            >
              Close
            </button>
          </div>

          {detailsLoading ? (
            <div style={styles.emptyState}>Loading details...</div>
          ) : (
            <>
              <div style={styles.statsGrid}>
                <StatCard label="Sites" value={batchSites.length} styles={styles} />
                <StatCard label="Preview Sectors" value={batchSectors.length} styles={styles} />
                <StatCard
                  label="Total Sectors"
                  value={selectedBatch.record_count || 0}
                  tone="green"
                  styles={styles}
                />
              </div>

              <h4 style={styles.sectionMiniTitle}>Sites</h4>

              {batchSites.length === 0 ? (
                <div style={styles.emptyState}>No sites found for this file.</div>
              ) : (
                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Site</th>
                        <th style={styles.th}>Technology</th>
                        <th style={styles.th}>Latitude</th>
                        <th style={styles.th}>Longitude</th>
                      </tr>
                    </thead>

                    <tbody>
                      {batchSites.slice(0, 100).map((site) => (
                        <tr key={site.id} style={styles.tr}>
                          <td style={styles.td}>{site.site_name}</td>
                          <td style={styles.td}>{site.technology || "N/A"}</td>
                          <td style={styles.td}>{site.lat}</td>
                          <td style={styles.td}>{site.lon}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h4 style={styles.sectionMiniTitle}>
                Sector Preview {" "}
                <span style={styles.mutedText}>showing max 300 records for page speed</span>
              </h4>

              {batchSectors.length === 0 ? (
                <div style={styles.emptyState}>No sectors found for this file.</div>
              ) : (
                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Site</th>
                        <th style={styles.th}>Cell</th>
                        <th style={styles.th}>Tech</th>
                        <th style={styles.th}>PCI</th>
                        <th style={styles.th}>EARFCN</th>
                        <th style={styles.th}>Azimuth</th>
                        <th style={styles.th}>BW</th>
                        <th style={styles.th}>CID</th>
                      </tr>
                    </thead>

                    <tbody>
                      {batchSectors.map((sector) => (
                        <tr key={sector.id} style={styles.tr}>
                          <td style={styles.td}>{sector.site_name || "N/A"}</td>
                          <td style={styles.td}>{sector.cell_name || "N/A"}</td>
                          <td style={styles.td}>{sector.technology || "N/A"}</td>
                          <td style={styles.td}>{sector.pci || "N/A"}</td>
                          <td style={styles.td}>{sector.earfcn || "N/A"}</td>
                          <td style={styles.td}>{sector.azimuth ?? "N/A"}</td>
                          <td style={styles.td}>{sector.antenna_bw ?? "N/A"}</td>
                          <td style={styles.td}>{sector.cid || "N/A"}</td>
                        </tr>
                      ))}
                    </tbody>
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

function StatCard({ label, value, tone, styles }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div
        style={{
          ...styles.statValue,
          color: tone === "green" ? styles.goodColor : styles.infoColor,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function useDarkMode() {
  const readTheme = () => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return false;
    }

    const root = document.documentElement;
    const body = document.body;

    const themeText = [
      root?.className,
      body?.className,
      root?.dataset?.theme,
      body?.dataset?.theme,
      root?.getAttribute?.("data-theme"),
      body?.getAttribute?.("data-theme"),
      window.localStorage?.getItem("theme"),
      window.localStorage?.getItem("mode"),
      window.localStorage?.getItem("colorMode"),
      window.localStorage?.getItem("babyDragonTheme"),
      window.localStorage?.getItem("babydragon_theme"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (themeText.includes("dark") || themeText.includes("night")) return true;
    if (themeText.includes("light") || themeText.includes("day")) return false;

    const bodyBg = window.getComputedStyle(body).backgroundColor || "";
    const rgb = bodyBg.match(/\d+/g)?.map(Number) || [];

    if (rgb.length >= 3) {
      const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
      return brightness < 90;
    }

    return false;
  };

  const [isDark, setIsDark] = useState(readTheme);

  useEffect(() => {
    const updateTheme = () => setIsDark(readTheme());

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });

    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme"],
      });
    }

    window.addEventListener("storage", updateTheme);
    const interval = window.setInterval(updateTheme, 1200);

    return () => {
      observer.disconnect();
      window.removeEventListener("storage", updateTheme);
      window.clearInterval(interval);
    };
  }, []);

  return isDark;
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

function createStyles(isDark) {
  const c = isDark
    ? {
        pageText: "#e5eefc",
        muted: "#a9c3df",
        title: "#f8fafc",
        panel: "#0b1829",
        panelSoft: "#0e1d31",
        card: "#0d1b2d",
        input: "#07111f",
        inputText: "#e5eefc",
        border: "rgba(96, 165, 250, 0.28)",
        borderStrong: "rgba(96, 165, 250, 0.45)",
        tableHeader: "#081426",
        rowBorder: "rgba(148, 163, 184, 0.16)",
        chip: "rgba(30, 64, 175, 0.22)",
        info: "#38bdf8",
        good: "#22c55e",
        danger: "#fecaca",
        warning: "#fde68a",
        buttonText: "#e5eefc",
        primaryText: "#04111f",
      }
    : {
        pageText: "#102033",
        muted: "#44556a",
        title: "#0f172a",
        panel: "#ffffff",
        panelSoft: "#f8fbff",
        card: "#ffffff",
        input: "#f8fbff",
        inputText: "#0f172a",
        border: "rgba(37, 99, 235, 0.24)",
        borderStrong: "rgba(37, 99, 235, 0.42)",
        tableHeader: "#eaf3ff",
        rowBorder: "rgba(37, 99, 235, 0.18)",
        chip: "#eaf3ff",
        info: "#0284c7",
        good: "#16a34a",
        danger: "#991b1b",
        warning: "#92400e",
        buttonText: "#0b3a7a",
        primaryText: "#ffffff",
      };

  return {
    goodColor: c.good,
    infoColor: c.info,

    page: {
      width: "100%",
      color: c.pageText,
      boxSizing: "border-box",
    },

    heroCard: {
      display: "flex",
      justifyContent: "space-between",
      gap: "18px",
      alignItems: "center",
      border: `1px solid ${c.border}`,
      background: c.panel,
      borderRadius: "18px",
      padding: "20px 22px",
      marginBottom: "14px",
      boxShadow: isDark ? "none" : "0 10px 26px rgba(15, 23, 42, 0.06)",
    },

    heroCopy: {
      minWidth: 0,
      textAlign: "left",
    },

    eyebrow: {
      color: "#2563eb",
      fontSize: "12px",
      fontWeight: 900,
      letterSpacing: "0.18em",
      marginBottom: "8px",
      textTransform: "uppercase",
    },

    title: {
      margin: 0,
      fontSize: "24px",
      fontWeight: 900,
      color: c.title,
      lineHeight: 1.15,
    },

    subtitle: {
      margin: "6px 0 0",
      fontSize: "14px",
      color: c.pageText,
      lineHeight: 1.5,
    },

    workflowPill: {
      border: `1px solid ${c.borderStrong}`,
      background: c.chip,
      borderRadius: "999px",
      color: "#2563eb",
      fontWeight: 900,
      padding: "11px 16px",
      whiteSpace: "nowrap",
      fontSize: "14px",
    },

    message: {
      border: `1px solid ${c.borderStrong}`,
      background: isDark ? "rgba(14, 165, 233, 0.12)" : "#eaf7ff",
      color: isDark ? "#dff6ff" : "#075985",
      borderRadius: "14px",
      padding: "10px 12px",
      fontSize: "13px",
      marginBottom: "14px",
      textAlign: "center",
      fontWeight: 800,
    },

    statsGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
      gap: "10px",
      marginBottom: "14px",
    },

    statCard: {
      border: `1px solid ${c.border}`,
      background: c.panelSoft,
      borderRadius: "16px",
      padding: "14px 12px",
      textAlign: "center",
    },

    statLabel: {
      fontSize: "11px",
      color: c.muted,
      marginBottom: "5px",
      fontWeight: 800,
    },

    statValue: {
      fontSize: "24px",
      fontWeight: 900,
    },

    utilityCard: {
      display: "flex",
      justifyContent: "space-between",
      gap: "12px",
      alignItems: "center",
      border: `1px solid ${c.border}`,
      background: c.panel,
      borderRadius: "16px",
      padding: "14px 16px",
      marginBottom: "14px",
    },

    utilityCopy: {
      flex: 1,
      minWidth: 0,
      textAlign: "left",
    },

    utilityTitle: {
      margin: 0,
      color: c.title,
      fontSize: "16px",
      fontWeight: 900,
      textAlign: "left",
    },

    utilityText: {
      margin: "5px 0 0",
      color: c.muted,
      fontSize: "12px",
      lineHeight: 1.5,
      textAlign: "left",
    },

    card: {
      border: `1px solid ${c.border}`,
      background: c.card,
      borderRadius: "18px",
      padding: "16px",
      marginBottom: "14px",
    },

    cardHeader: {
      display: "flex",
      justifyContent: "space-between",
      gap: "12px",
      alignItems: "flex-start",
      marginBottom: "14px",
      borderBottom: `1px solid ${c.rowBorder}`,
      paddingBottom: "12px",
    },

    cardHeaderCompact: {
      display: "flex",
      justifyContent: "space-between",
      gap: "12px",
      alignItems: "flex-start",
      marginBottom: "14px",
    },

    cardEyebrow: {
      color: "#2563eb",
      fontSize: "11px",
      fontWeight: 900,
      letterSpacing: "0.16em",
      textTransform: "uppercase",
      marginBottom: "6px",
    },

    cardTitle: {
      margin: 0,
      fontSize: "18px",
      fontWeight: 900,
      color: c.title,
      textAlign: "left",
    },

    cardText: {
      margin: "5px 0 0",
      fontSize: "12px",
      color: c.muted,
      lineHeight: 1.5,
      textAlign: "left",
    },

    formGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
      gap: "12px",
      marginBottom: "12px",
    },

    filterGrid: {
      display: "grid",
      gridTemplateColumns: "minmax(260px, 1.2fr) minmax(180px, 0.65fr) minmax(180px, 0.65fr) auto",
      gap: "10px",
      alignItems: "end",
    },

    label: {
      display: "flex",
      flexDirection: "column",
      gap: "7px",
      fontSize: "12px",
      color: c.pageText,
      fontWeight: 900,
    },

    smallLabel: {
      display: "flex",
      flexDirection: "column",
      gap: "5px",
      fontSize: "10px",
      color: "#2563eb",
      fontWeight: 900,
      letterSpacing: "0.1em",
      textTransform: "uppercase",
    },

    input: {
      width: "100%",
      boxSizing: "border-box",
      border: `1px solid ${c.borderStrong}`,
      background: c.input,
      color: c.inputText,
      borderRadius: "12px",
      padding: "10px 12px",
      outline: "none",
      fontSize: "13px",
      minHeight: "40px",
    },

    smallSelect: {
      width: "150px",
      boxSizing: "border-box",
      border: `1px solid ${c.borderStrong}`,
      background: c.input,
      color: c.inputText,
      borderRadius: "12px",
      padding: "8px 10px",
      outline: "none",
      fontSize: "12px",
      minHeight: "36px",
    },

    uploadBox: {
      border: `1px dashed ${c.borderStrong}`,
      background: isDark ? "rgba(15, 23, 42, 0.72)" : "#f8fbff",
      borderRadius: "16px",
      padding: "14px",
      marginBottom: "12px",
    },

    fileInput: {
      width: "100%",
      color: c.pageText,
      marginBottom: "10px",
    },

    fileInfo: {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      color: c.pageText,
      fontSize: "13px",
      textAlign: "center",
    },

    buttonRow: {
      display: "flex",
      justifyContent: "flex-start",
      gap: "10px",
      flexWrap: "wrap",
    },

    primaryButton: {
      border: "none",
      borderRadius: "12px",
      padding: "11px 16px",
      background: "linear-gradient(135deg, #2563eb, #06b6d4)",
      color: c.primaryText,
      fontWeight: 900,
      cursor: "pointer",
      minWidth: "170px",
    },

    secondaryButton: {
      border: `1px solid ${c.borderStrong}`,
      borderRadius: "12px",
      padding: "9px 13px",
      background: c.chip,
      color: c.buttonText,
      fontWeight: 900,
      cursor: "pointer",
      fontSize: "12px",
      whiteSpace: "nowrap",
    },

    ghostButton: {
      border: `1px solid ${c.border}`,
      borderRadius: "12px",
      padding: "9px 13px",
      background: "transparent",
      color: c.buttonText,
      fontWeight: 900,
      cursor: "pointer",
      fontSize: "12px",
      whiteSpace: "nowrap",
    },

    smallButton: {
      border: `1px solid ${c.borderStrong}`,
      borderRadius: "10px",
      padding: "8px 12px",
      background: isDark ? "rgba(14, 165, 233, 0.14)" : "#eaf7ff",
      color: isDark ? "#bae6fd" : "#075985",
      fontWeight: 900,
      cursor: "pointer",
      fontSize: "12px",
    },

    dangerButton: {
      border: "1px solid rgba(248, 113, 113, 0.5)",
      borderRadius: "10px",
      padding: "8px 12px",
      background: isDark ? "rgba(239, 68, 68, 0.12)" : "#fff1f2",
      color: c.danger,
      fontWeight: 900,
      cursor: "pointer",
      fontSize: "12px",
    },

    recordsControls: {
      display: "flex",
      gap: "10px",
      alignItems: "flex-end",
      flexWrap: "wrap",
      justifyContent: "flex-end",
    },

    previewBox: {
      marginTop: "12px",
      border: `1px solid ${c.border}`,
      background: c.panelSoft,
      borderRadius: "14px",
      padding: "12px",
      fontSize: "12px",
      color: c.pageText,
    },

    previewGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
      gap: "8px",
      marginTop: "8px",
    },

    errorText: {
      marginTop: "8px",
      color: c.danger,
      fontWeight: 800,
    },

    warningText: {
      marginTop: "8px",
      color: c.warning,
      fontWeight: 800,
    },

    tableMeta: {
      textAlign: "right",
      fontSize: "12px",
      color: "#2563eb",
      fontWeight: 900,
      marginBottom: "8px",
    },

    tableWrap: {
      overflowX: "auto",
      border: `1px solid ${c.rowBorder}`,
      borderRadius: "14px",
    },

    table: {
      width: "100%",
      borderCollapse: "collapse",
      minWidth: "760px",
    },

    th: {
      textAlign: "left",
      padding: "11px 12px",
      fontSize: "11px",
      color: "#2563eb",
      background: c.tableHeader,
      borderBottom: `1px solid ${c.rowBorder}`,
      whiteSpace: "nowrap",
      letterSpacing: "0.05em",
      textTransform: "uppercase",
    },

    tr: {
      borderBottom: `1px solid ${c.rowBorder}`,
    },

    td: {
      padding: "12px",
      fontSize: "13px",
      color: c.pageText,
      verticalAlign: "top",
      whiteSpace: "nowrap",
    },

    actionRow: {
      display: "flex",
      gap: "8px",
      flexWrap: "wrap",
    },

    emptyState: {
      border: `1px solid ${c.rowBorder}`,
      background: c.panelSoft,
      borderRadius: "14px",
      padding: "18px",
      color: c.muted,
      textAlign: "center",
      fontSize: "13px",
      fontWeight: 800,
    },

    hiddenRecordsBox: {
      border: `1px dashed ${c.borderStrong}`,
      background: c.panelSoft,
      borderRadius: "14px",
      padding: "16px",
      color: c.pageText,
      textAlign: "center",
      fontSize: "14px",
      fontWeight: 900,
    },

    sectionMiniTitle: {
      margin: "18px 0 10px",
      color: c.title,
      fontSize: "15px",
      fontWeight: 900,
    },

    mutedText: {
      color: c.muted,
      fontWeight: 600,
      fontSize: "12px",
    },
  };
}
