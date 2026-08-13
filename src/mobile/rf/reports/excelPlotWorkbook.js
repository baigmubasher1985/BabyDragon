/**
 * ExcelJS workbook writer for BabyDragon Plot Report (Step 1J2-F4 / F6).
 * KPI summary, cleaned sheets, RF/Data maps without event clusters, Event Plots sheet.
 */

import { EXCEL_PLOT_SHEET_NAMES } from "./excelPlotReportExport.js";
import {
  renderRouteKpiMapPng,
  prepareSharedBasemap,
  computeProjectedRouteAspect,
  canvasSizeForOrientation,
} from "./excelMapPlotRenderer.js";
import { renderEventTimeSeriesPng } from "./excelEventPlotRenderer.js";

const BRAND = {
  navy: "FF0B3D5C",
  accent: "FF1B6CA8",
  headerFill: "FF0B3D5C",
  headerFont: "FFFFFFFF",
  sectionFill: "FFE8F1F8",
  altRow: "FFF8FAFC",
  border: "FFCBD5E1",
  muted: "FF475569",
};

/**
 * Excel cell presentation: never write empty strings into the workbook.
 * Empty strings enter ExcelJS Shared String Table and can appear to auditors as the
 * SST index number (e.g. index 37 → misread as numeric "37" in missing fields).
 * Source null/unavailable → null (true blank cell). Real measured numbers stay as numbers.
 */
function cellValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") {
    if (value.text != null && (value.hyperlink != null || value.formula != null)) {
      return cellValue(value.text);
    }
    return null;
  }
  const text = String(value).trim();
  if (!text) return null;
  if (text === "NaN" || text === "Infinity" || text === "-Infinity" || text === "undefined") return null;
  if (text === "[object Object]") return null;
  return text;
}

function setCell(sheet, row, col, value) {
  const v = cellValue(value);
  if (v === null || v === undefined) {
    sheet.getCell(row, col).value = null;
    return;
  }
  sheet.getCell(row, col).value = v;
}

/**
 * Field-aware smoke check for numeric sentinel injection (historically 42; F9 also 34).
 * Distinguishes legitimate measured KPIs (RSRP, Mbps, PCI, etc.) from placeholder
 * leakage into missing/notes/error/config fields. Column widths are never scanned.
 */
function countUnexpectedLiteralSentinel(workbook, sentinel) {
  const target = Number(sentinel);
  const targetText = String(sentinel);
  const allowedHeaders = new Set([
    "sample_index", "iteration", "event_id", "pci", "earfcn", "nrarfcn", "channel",
    "cell_id", "nci", "tac", "lac", "psc", "bsic", "arfcn", "uarfcn",
    "width", "column_width", "col_width", "dl_mbps", "ul_mbps",
    "api_level", "apilevel", "traffic_stats_api_level", "sdk", "sdk_int",
  ]);
  const allowedHeaderRe = /rsrp|rsrq|sinr|rssi|rscp|ecno|rxlev|mbps|throughput|accuracy|speed|age|duration|elapsed|pci|earfcn|bytes|count|avg|min|max|valid|ul\b|dl\b|ping|jitter|loss|interval|iteration|sample|related_iteration|event_id|api.?level|sdk/i;
  const forbiddenHeaderRe = /error|message|note|status|stage|bandwidth|config|missing|n\/a|unknown|not exposed|failure|raw_server|provider|carrier|operator|technology|label|purpose|item|field/i;
  const hits = [];
  for (const sheet of workbook.worksheets || []) {
    let headerRowNum = 1;
    let bestScore = -1;
    for (let hr = 1; hr <= Math.min(20, sheet.rowCount || 20); hr += 1) {
      const row = sheet.getRow(hr);
      let score = 0;
      let cells = 0;
      row.eachCell({ includeEmpty: false }, (cell) => {
        cells += 1;
        const t = String(cell.text ?? cell.value ?? "").trim().toLowerCase();
        if (!t || /^-?\d+(\.\d+)?$/.test(t)) return;
        if (t.includes("_") || allowedHeaderRe.test(t) || allowedHeaders.has(t)) score += 2;
        else if (t.length < 40) score += 1;
      });
      if (cells >= 3 && score > bestScore) {
        bestScore = score;
        headerRowNum = hr;
      }
    }
    sheet.eachRow((row, rn) => {
      if (rn <= headerRowNum) return;
      row.eachCell({ includeEmpty: false }, (cell, cn) => {
        // Only real cell values — never column.width or style metadata.
        if (cell.value && typeof cell.value === "object" && cell.value.hyperlink != null) return;
        const num = typeof cell.value === "number" ? cell.value : null;
        const text = String(cell.text ?? (typeof cell.value === "string" || typeof cell.value === "number" ? cell.value : "") ?? "").trim();
        if (num !== target && text !== targetText) return;
        const header = String(sheet.getRow(headerRowNum).getCell(cn).text || "").trim().toLowerCase();
        const labelLeft = String(row.getCell(Math.max(1, cn - 1)).text || "").trim().toLowerCase();
        const labelFar = String(row.getCell(Math.max(1, cn - 2)).text || "").trim().toLowerCase();
        if (allowedHeaders.has(header)) return;
        if (allowedHeaderRe.test(header) || allowedHeaderRe.test(labelLeft) || allowedHeaderRe.test(labelFar)) {
          // Still flag if the column is clearly a non-measurement field.
          if (!forbiddenHeaderRe.test(header) && !forbiddenHeaderRe.test(labelLeft)) return;
        }
        if (sheet.name.startsWith("01_") || sheet.name.startsWith("02_") || sheet.name.startsWith("15_")) return;
        hits.push({ sheet: sheet.name, row: rn, col: cn, header: header || labelLeft || `col${cn}`, sentinel: target });
      });
    });
  }
  return {
    [`unexpected_literal_${target}_count`]: hits.length,
    samples: hits.slice(0, 20),
  };
}

function countUnexpectedLiteral42(workbook) {
  return countUnexpectedLiteralSentinel(workbook, 42);
}

function countUnexpectedLiteral34(workbook) {
  return countUnexpectedLiteralSentinel(workbook, 34);
}

function thinBorder() {
  const edge = { style: "thin", color: { argb: BRAND.border } };
  return { top: edge, left: edge, bottom: edge, right: edge };
}

function colLetters(col) {
  let n = col;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function parseA1Cell(ref) {
  const match = String(ref || "").trim().match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return null;
  const letters = match[1].toUpperCase();
  let col = 0;
  for (let i = 0; i < letters.length; i += 1) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return { row: Number(match[2]), col };
}

function parseA1Range(rangeRef) {
  const parts = String(rangeRef || "").split(":");
  if (parts.length !== 2) return null;
  const start = parseA1Cell(parts[0]);
  const end = parseA1Cell(parts[1]);
  if (!start || !end) return null;
  return {
    top: Math.min(start.row, end.row),
    left: Math.min(start.col, end.col),
    bottom: Math.max(start.row, end.row),
    right: Math.max(start.col, end.col),
  };
}

function normalizeMergeRange(startRow, startCol, endRow, endCol) {
  return {
    top: Math.min(startRow, endRow),
    left: Math.min(startCol, endCol),
    bottom: Math.max(startRow, endRow),
    right: Math.max(startCol, endCol),
  };
}

function formatMergeRangeLabel(sheetName, range) {
  const topLeft = `${colLetters(range.left)}${range.top}`;
  const bottomRight = `${colLetters(range.right)}${range.bottom}`;
  const addr = topLeft === bottomRight ? topLeft : `${topLeft}:${bottomRight}`;
  return `${sheetName || "sheet"}!${addr}`;
}

function mergeRangesEqual(a, b) {
  return a.top === b.top && a.left === b.left && a.bottom === b.bottom && a.right === b.right;
}

function mergeRangesOverlapKind(requested, existing) {
  if (mergeRangesEqual(requested, existing)) return "equal";
  const separated = requested.right < existing.left
    || existing.right < requested.left
    || requested.bottom < existing.top
    || existing.bottom < requested.top;
  return separated ? "none" : "partial";
}

function collectExistingMerges(sheet) {
  const seen = new Set();
  const merges = [];

  const addRange = (range) => {
    if (!range || range.top == null) return;
    const normalized = normalizeMergeRange(range.top, range.left, range.bottom, range.right);
    const key = `${normalized.top}:${normalized.left}:${normalized.bottom}:${normalized.right}`;
    if (seen.has(key)) return;
    seen.add(key);
    merges.push(normalized);
  };

  const dict = sheet?._merges || {};
  Object.keys(dict).forEach((address) => {
    const rangeObj = dict[address];
    if (rangeObj?.model) {
      addRange(rangeObj.model);
      return;
    }
    const parsed = parseA1Range(address);
    if (parsed) addRange(parsed);
  });

  (sheet?.model?.merges || []).forEach((address) => {
    addRange(parseA1Range(address));
  });

  return merges;
}

function safeMergeCells(sheet, startRow, startCol, endRow, endCol, contextLabel = "") {
  const requested = normalizeMergeRange(startRow, startCol, endRow, endCol);
  const sheetName = sheet?.name || "sheet";
  const requestedLabel = formatMergeRangeLabel(sheetName, requested);

  for (const existing of collectExistingMerges(sheet)) {
    const overlap = mergeRangesOverlapKind(requested, existing);
    if (overlap === "equal") return;
    if (overlap === "partial") {
      const existingLabel = formatMergeRangeLabel(sheetName, existing);
      throw new Error(
        `Excel merge conflict${contextLabel ? ` (${contextLabel})` : ""}: requested ${requestedLabel} overlaps existing ${existingLabel}`,
      );
    }
  }

  sheet.mergeCells(startRow, startCol, endRow, endCol);
}

function styleHeaderRow(sheet, rowNumber, colCount) {
  const row = sheet.getRow(rowNumber);
  row.font = { bold: true, color: { argb: BRAND.headerFont }, name: "Calibri", size: 11 };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.headerFill } };
  row.alignment = { vertical: "middle", wrapText: true };
  for (let c = 1; c <= colCount; c += 1) {
    row.getCell(c).border = thinBorder();
  }
  row.height = 22;
}

function styleDataRows(sheet, startRow, endRow, colCount) {
  for (let r = startRow; r <= endRow; r += 1) {
    const row = sheet.getRow(r);
    if ((r - startRow) % 2 === 1) {
      for (let c = 1; c <= colCount; c += 1) {
        row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.altRow } };
      }
    }
    for (let c = 1; c <= colCount; c += 1) {
      row.getCell(c).border = thinBorder();
      row.getCell(c).alignment = { vertical: "middle", wrapText: true };
    }
  }
}

function autoWidth(sheet, headers, min = 12, max = 48) {
  (headers || []).forEach((h, index) => {
    const col = sheet.getColumn(index + 1);
    col.width = Math.min(max, Math.max(min, String(h).length + 3));
  });
}

function addTitleBlock(sheet, title, subtitleLines = []) {
  safeMergeCells(sheet, 1, 1, 1, 6, "title block row 1");
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = cellValue(title);
  titleCell.font = { bold: true, size: 16, color: { argb: BRAND.headerFont }, name: "Calibri" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.navy } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  sheet.getRow(1).height = 28;

  let row = 2;
  (subtitleLines || []).forEach((line) => {
    safeMergeCells(sheet, row, 1, row, 6, `title block subtitle row ${row}`);
    const cell = sheet.getCell(row, 1);
    cell.value = cellValue(line);
    cell.font = { italic: true, size: 10, color: { argb: BRAND.muted }, name: "Calibri" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.sectionFill } };
    sheet.getRow(row).height = 18;
    row += 1;
  });
  return row + 1;
}

function writeSectionHeader(sheet, row, title) {
  safeMergeCells(sheet, row, 1, row, 2, `section header row ${row}`);
  const cell = sheet.getCell(row, 1);
  cell.value = cellValue(title);
  cell.font = { bold: true, size: 12, color: { argb: BRAND.headerFont }, name: "Calibri" };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.accent } };
  sheet.getRow(row).height = 20;
  return row + 1;
}

function writeLabelValueBlock(sheet, startRow, rows) {
  let r = startRow;
  sheet.getCell(r, 1).value = "Field";
  sheet.getCell(r, 2).value = "Value";
  styleHeaderRow(sheet, r, 2);
  r += 1;
  const dataStart = r;
  (rows || []).forEach((row) => {
    sheet.getCell(r, 1).value = cellValue(row.label);
    sheet.getCell(r, 2).value = cellValue(row.value);
    r += 1;
  });
  if ((rows || []).length) styleDataRows(sheet, dataStart, r - 1, 2);
  return r + 1;
}

function writeCustomerInfoSheet(sheet, customerInfo = {}, basemapMeta = {}, distance = {}, paletteSnapshot = null) {
  let r = addTitleBlock(sheet, "BabyDragon Excel Plot Report — Test / Grid Info", [
    "MobbiTech Global LLC",
    `Distance covered: ${cellValue(distance.distance_covered_miles)} mi  (${cellValue(distance.distance_covered_km)} km)`,
  ]);

  r = writeSectionHeader(sheet, r, "Project / Task");
  r = writeLabelValueBlock(sheet, r, customerInfo.projectRows || []);

  r = writeSectionHeader(sheet, r, "Session");
  r = writeLabelValueBlock(sheet, r, customerInfo.sessionRows || []);

  if ((customerInfo.testOutcomeRows || []).length) {
    r = writeSectionHeader(sheet, r, "Test Outcome");
    r = writeLabelValueBlock(sheet, r, customerInfo.testOutcomeRows || []);
  }

  r = writeSectionHeader(sheet, r, "Network");
  r = writeLabelValueBlock(sheet, r, customerInfo.networkRows || []);

  r = writeSectionHeader(sheet, r, "Report");
  const reportRows = customerInfo.reportRows || [
    { label: "Map provider", value: basemapMeta.map_background_provider },
    {
      label: "Color note",
      value: paletteSnapshot?.note || "Map and graph colors use the active BabyDragon KPI display profile captured at report export.",
    },
  ];
  r = writeLabelValueBlock(sheet, r, reportRows);

  sheet.getColumn(1).width = 36;
  sheet.getColumn(2).width = 72;
  for (let rowNum = 1; rowNum <= r; rowNum += 1) {
    sheet.getRow(rowNum).eachCell((cell) => {
      cell.alignment = { ...(cell.alignment || {}), wrapText: false, vertical: "middle" };
    });
  }
}

const INDEX_SHEET_HEADERS = ["Sheet Name", "Purpose"];

function writeIndexSheetRows(sheet, indexRows, headerRow) {
  let r = headerRow + 1;
  (indexRows || []).forEach((row) => {
    const name = cellValue(row?.sheet_name);
    sheet.getCell(r, 1).value = {
      text: name,
      hyperlink: `#'${name}'!A1`,
    };
    sheet.getCell(r, 1).font = { color: { argb: "FF0563C1" }, underline: true, name: "Calibri" };
    sheet.getCell(r, 2).value = cellValue(row?.purpose);
    r += 1;
  });
  if ((indexRows || []).length) {
    styleDataRows(sheet, headerRow + 1, r - 1, INDEX_SHEET_HEADERS.length);
  }
  return r;
}

function writeIndexSheet(sheet, indexRows, distance = {}) {
  const next = addTitleBlock(sheet, "BabyDragon Excel Plot Report — Index", [
    `Distance covered: ${cellValue(distance.distance_covered_miles)} mi  |  ${cellValue(distance.distance_covered_km)} km`,
  ]);
  const headerRow = next;
  INDEX_SHEET_HEADERS.forEach((h, i) => {
    sheet.getCell(headerRow, i + 1).value = h;
  });
  styleHeaderRow(sheet, headerRow, INDEX_SHEET_HEADERS.length);
  const endRow = writeIndexSheetRows(sheet, indexRows, headerRow);
  autoWidth(sheet, INDEX_SHEET_HEADERS, 18, 56);
  sheet.getColumn(2).width = 64;
  sheet.views = [{ state: "frozen", ySplit: headerRow }];
  return { headerRow, endRow };
}

function refreshIndexSheetRows(sheet, indexRows, headerRow) {
  const endRow = writeIndexSheetRows(sheet, indexRows, headerRow);
  for (let r = endRow; r <= endRow + 20; r += 1) {
    sheet.getCell(r, 1).value = null;
    sheet.getCell(r, 2).value = null;
  }
  if ((indexRows || []).length) {
    styleDataRows(sheet, headerRow + 1, endRow - 1, INDEX_SHEET_HEADERS.length);
  }
  autoWidth(sheet, INDEX_SHEET_HEADERS, 18, 56);
  sheet.getColumn(2).width = 64;
}

function writeObjectRowsStyled(sheet, headers, rows, title, subtitleLines = []) {
  const next = addTitleBlock(sheet, title, subtitleLines);
  const headerRow = next;
  headers.forEach((h, i) => {
    sheet.getCell(headerRow, i + 1).value = cellValue(h);
  });
  styleHeaderRow(sheet, headerRow, headers.length);
  let r = headerRow + 1;
  (rows || []).forEach((row) => {
    headers.forEach((key, i) => {
      sheet.getCell(r, i + 1).value = cellValue(row?.[key]);
    });
    r += 1;
  });
  if ((rows || []).length) {
    styleDataRows(sheet, headerRow + 1, r - 1, headers.length);
  }
  autoWidth(sheet, headers);
  sheet.views = [{ state: "frozen", ySplit: headerRow, xSplit: Math.min(2, headers.length) }];
  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: Math.max(headerRow, r - 1), column: headers.length },
  };
  return r;
}

function writeKpiSummarySheet(sheet, kpiSummary = {}, distance = {}) {
  let r = addTitleBlock(sheet, "03 — KPI Summary", [
    "Customer-readable KPI report. Finite numeric values only. Identifiers are not averaged.",
    `Distance covered: ${cellValue(distance.distance_covered_miles)} mi (total, not an average).`,
    kpiSummary.dbmNote || "Maximum is the strongest observed value and minimum is the weakest for dBm KPIs.",
  ]);

  const noWrapRows = (startRow, endRow, colCount) => {
    for (let rr = startRow; rr <= endRow; rr += 1) {
      for (let c = 1; c <= colCount; c += 1) {
        sheet.getRow(rr).getCell(c).alignment = { vertical: "middle", wrapText: false };
      }
    }
  };

  if ((kpiSummary.testOutcomeSummaryRows || []).length) {
    r = writeSectionHeader(sheet, r, "Test Outcome");
    sheet.getCell(r, 1).value = "Item";
    sheet.getCell(r, 2).value = "Value";
    sheet.getCell(r, 3).value = "Notes";
    styleHeaderRow(sheet, r, 3);
    r += 1;
    const toStart = r;
    (kpiSummary.testOutcomeSummaryRows || []).forEach((row) => {
      sheet.getCell(r, 1).value = cellValue(row.item);
      sheet.getCell(r, 2).value = cellValue(row.value);
      sheet.getCell(r, 3).value = cellValue(row.notes);
      r += 1;
    });
    if ((kpiSummary.testOutcomeSummaryRows || []).length) {
      styleDataRows(sheet, toStart, r - 1, 3);
      noWrapRows(toStart, r - 1, 3);
    }
    r += 1;
  }

  r = writeSectionHeader(sheet, r, "Session Totals");
  sheet.getCell(r, 1).value = "Item";
  sheet.getCell(r, 2).value = "Value";
  sheet.getCell(r, 3).value = "Notes";
  styleHeaderRow(sheet, r, 3);
  r += 1;
  const sessStart = r;
  (kpiSummary.sessionSummaryRows || []).forEach((row) => {
    sheet.getCell(r, 1).value = cellValue(row.item);
    sheet.getCell(r, 2).value = cellValue(row.value);
    sheet.getCell(r, 3).value = cellValue(row.notes);
    r += 1;
  });
  if ((kpiSummary.sessionSummaryRows || []).length) {
    styleDataRows(sheet, sessStart, r - 1, 3);
    noWrapRows(sessStart, r - 1, 3);
  }
  r += 1;

  const rfConfigRows = kpiSummary.rfConfigurationRows || [];
  if (rfConfigRows.length) {
    r = writeSectionHeader(sheet, r, "RF Configuration");
    const rfHeaders = ["Technology", "Serving role", "Band", "Channel", "BW DL (MHz)", "PCI/PSC/BSIC", "Cell ID/NCI", "TAC/LAC", "CA status", "First (s)", "Last (s)", "Source note"];
    const rfKeys = ["technology", "serving_role", "band", "channel", "bandwidth_dl", "pci_psc_bsic", "cell_id_nci", "tac_lac", "ca_status", "first_observed", "last_observed", "source_truth_note"];
    rfHeaders.forEach((h, i) => { sheet.getCell(r, i + 1).value = h; });
    styleHeaderRow(sheet, r, rfHeaders.length);
    r += 1;
    const rfStart = r;
    rfConfigRows.forEach((row) => {
      rfKeys.forEach((key, i) => { sheet.getCell(r, i + 1).value = cellValue(row[key]); });
      r += 1;
    });
    styleDataRows(sheet, rfStart, r - 1, rfHeaders.length);
    noWrapRows(rfStart, r - 1, rfHeaders.length);
    r += 1;
  }

  const cont = kpiSummary.continuousRows || [];
  const kpiCols = ["KPI", "Unit", "Average", "Minimum", "Maximum", "Valid Sample Count", "Notes"];
  const kpiKeys = ["kpi", "unit", "average", "minimum", "maximum", "valid_sample_count", "notes"];

  const writeGroupedSection = (title, rows) => {
    if (!rows.length) return;
    r = writeSectionHeader(sheet, r, title);
    kpiCols.forEach((h, i) => { sheet.getCell(r, i + 1).value = h; });
    styleHeaderRow(sheet, r, kpiCols.length);
    r += 1;
    const startRow = r;
    rows.forEach((row) => {
      kpiKeys.forEach((key, i) => { sheet.getCell(r, i + 1).value = cellValue(row[key]); });
      r += 1;
    });
    styleDataRows(sheet, startRow, r - 1, kpiCols.length);
    noWrapRows(startRow, r - 1, kpiCols.length);
    r += 1;
  };

  r = writeSectionHeader(sheet, r, "A. RF KPI Summary");
  const rfTechs = [
    { key: "LTE", title: "LTE Summary" },
    { key: "NR", title: "NR Summary" },
    { key: "WCDMA", title: "WCDMA Summary" },
    { key: "GSM", title: "GSM Summary" },
  ];
  let anyRf = false;
  rfTechs.forEach(({ key, title }) => {
    const rows = cont.filter((row) => row.category === "RF" && String(row.technology_source || "").toUpperCase().includes(key));
    if (rows.length) { anyRf = true; writeGroupedSection(title, rows); }
  });
  if (!anyRf) {
    sheet.getCell(r, 1).value = "No RF continuous KPI samples for active technologies.";
    r += 2;
  }
  writeGroupedSection("GPS / Device", cont.filter((row) => row.category === "GPS"));

  r = writeSectionHeader(sheet, r, "B. Accessibility / Data Test Summary");
  const dataGroups = [
    { match: (row) => String(row.technology_source || "").includes("Native HTTP"), title: "Native HTTP" },
    { match: (row) => String(row.technology_source || "").includes("FTP") && !String(row.technology_source || "").includes("Native"), title: "FTP" },
    { match: (row) => String(row.technology_source || "").toLowerCase().includes("iperf"), title: "iPerf3" },
    { match: (row) => row.category === "TrafficStats" && String(row.technology_source || "").includes("Mobile"), title: "TrafficStats Mobile" },
    { match: (row) => row.category === "TrafficStats" && String(row.technology_source || "").includes("Total"), title: "TrafficStats Total" },
    { match: (row) => row.category === "External evidence" && String(row.technology_source || "").includes("OOKLA"), title: "OOKLA External Evidence" },
    { match: (row) => row.category === "External evidence" && String(row.technology_source || "").includes("FCC"), title: "FCC External Evidence" },
  ];
  let anyData = false;
  dataGroups.forEach(({ match, title }) => {
    const rows = cont.filter(match);
    if (rows.length) { anyData = true; writeGroupedSection(title, rows); }
  });
  if (!anyData) {
    sheet.getCell(r, 1).value = "No data-test / TrafficStats / external evidence KPI rows for this session.";
    r += 2;
  }

  if ((kpiSummary.voiceSummaryRows || []).length) {
    r = writeSectionHeader(sheet, r, "C. Voice / Call Summary");
    sheet.getCell(r, 1).value = "Item";
    sheet.getCell(r, 2).value = "Value";
    sheet.getCell(r, 3).value = "Notes";
    styleHeaderRow(sheet, r, 3);
    r += 1;
    const vStart = r;
    (kpiSummary.voiceSummaryRows || []).forEach((row) => {
      sheet.getCell(r, 1).value = cellValue(row.item);
      sheet.getCell(r, 2).value = cellValue(row.value);
      sheet.getCell(r, 3).value = cellValue(row.notes);
      r += 1;
    });
    styleDataRows(sheet, vStart, r - 1, 3);
    r += 1;
  }

  r = writeSectionHeader(sheet, r, "D. Identifier / Serving Cell Summary");
  const idHeaders = ["Technology", "Identifier", "First observed", "Last observed", "Most frequent value", "Unique value count", "Change count", "Notes"];
  const idKeys = ["technology", "identifier", "first_observed", "last_observed", "most_frequent_value", "unique_value_count", "change_count", "notes"];
  idHeaders.forEach((h, i) => { sheet.getCell(r, i + 1).value = h; });
  styleHeaderRow(sheet, r, idHeaders.length);
  r += 1;
  const idStart = r;
  (kpiSummary.identifierRows || []).forEach((row) => {
    idKeys.forEach((key, i) => { sheet.getCell(r, i + 1).value = cellValue(row[key]); });
    r += 1;
  });
  if ((kpiSummary.identifierRows || []).length) {
    styleDataRows(sheet, idStart, r - 1, idHeaders.length);
    noWrapRows(idStart, r - 1, idHeaders.length);
  } else {
    sheet.getCell(r, 1).value = "No identifier observations for active technologies.";
    r += 1;
  }

  sheet.getColumn(1).width = 32;
  sheet.getColumn(2).width = 18;
  sheet.getColumn(3).width = 14;
  sheet.getColumn(4).width = 14;
  sheet.getColumn(5).width = 14;
  sheet.getColumn(6).width = 20;
  sheet.getColumn(7).width = 16;
  sheet.getColumn(8).width = 48;
  sheet.views = [{ state: "frozen", ySplit: 4 }];
}

function aggTrafficStats(rows, key) {
  // Shared finite-measurement predicate — never Number(null)===0.
  const nums = (rows || [])
    .map((row) => {
      const raw = row?.[key];
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
      if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) return Number(raw);
      return null;
    })
    .filter((v) => v !== null);
  if (!nums.length) return null;
  return {
    average: Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2)),
    minimum: Number(Math.min(...nums).toFixed(2)),
    maximum: Number(Math.max(...nums).toFixed(2)),
    count: nums.length,
  };
}

function writeThroughputSections(sheet, throughputRows = [], model = {}) {
  let r = addTitleBlock(sheet, "06 — Data Throughput", [
    "Sections separated by source. External evidence is never labeled as APP throughput.",
    "TrafficStats definitions: see ReadMe.",
  ]);

  const outcome = model.dataTestOutcome || {};
  r = writeSectionHeader(sheet, r, "A. Test Outcome Summary");
  const outcomeRows = [
    { label: "Test type", value: outcome.testType },
    { label: "Status", value: outcome.status },
    { label: "Requested", value: outcome.requestedIterations == null ? "—" : outcome.requestedIterations },
    { label: "Attempted", value: outcome.attemptedIterations },
    { label: "Completed", value: outcome.completedIterations },
    { label: "Failed", value: outcome.failedIterations },
    { label: "Remaining", value: outcome.remainingIterations == null ? "—" : outcome.remainingIterations },
    { label: "Error", value: outcome.errorMessage },
    { label: "APP DL/UL note", value: outcome.hasSuccessfulAppThroughput
      ? "APP throughput from successful engine directions only (not TrafficStats)."
      : (String(outcome.engineKey || "").includes("ftp")
        ? "FTP APP throughput unavailable/failed. TrafficStats (if present) is separate device context — not FTP APP success."
        : "No successful engine iteration; APP DL/UL unavailable.") },
  ];
  r = writeLabelValueBlock(sheet, r, outcomeRows);

  const engineRows = (throughputRows || []).filter((row) => {
    const t = String(row.series_type || "");
    return t.includes("internal") && t !== "iperf3_interval";
  }).filter((row) => String(row.label || "").includes("result point") || String(row.label || "").includes("iteration"));
  if (engineRows.length) {
    r = writeSectionHeader(sheet, r, "B. Internal Engine Attempts");
    const attemptHeaders = ["Iteration", "Timestamp", "Elapsed (s)", "DL (Mbps)", "UL (Mbps)", "Notes"];
    attemptHeaders.forEach((h, i) => { sheet.getCell(r, i + 1).value = h; });
    styleHeaderRow(sheet, r, attemptHeaders.length);
    r += 1;
    const attemptStart = r;
    engineRows.forEach((row) => {
      sheet.getCell(r, 1).value = cellValue(row.iteration);
      sheet.getCell(r, 2).value = cellValue(row.timestamp_iso);
      sheet.getCell(r, 3).value = cellValue(row.elapsed_sec);
      sheet.getCell(r, 4).value = cellValue(row.y_dl_mbps);
      sheet.getCell(r, 5).value = cellValue(row.y_ul_mbps);
      sheet.getCell(r, 6).value = cellValue(row.notes);
      r += 1;
    });
    styleDataRows(sheet, attemptStart, r - 1, attemptHeaders.length);
    r += 1;
  }

  const iperfIntervalRows = (throughputRows || []).filter((row) => row.series_type === "iperf3_interval");
  if (iperfIntervalRows.length) {
    r = writeSectionHeader(sheet, r, "B2. iPerf3 Interval Throughput");
    const intervalHeaders = [
      "Iteration", "Direction", "Interval #", "Interval start", "Interval end",
      "Seconds", "Bytes", "Mbps", "Status",
    ];
    intervalHeaders.forEach((h, i) => { sheet.getCell(r, i + 1).value = h; });
    styleHeaderRow(sheet, r, intervalHeaders.length);
    r += 1;
    const intervalStart = r;
    iperfIntervalRows.forEach((row) => {
      const mbps = row.y_dl_mbps != null && row.y_dl_mbps !== "" ? row.y_dl_mbps : row.y_ul_mbps;
      const direction = String(row.direction || row.notes || "").toLowerCase().includes("ul")
        ? (row.y_ul_mbps != null && row.y_dl_mbps == null ? "UL" : (row.direction || ""))
        : (row.direction || (row.y_dl_mbps != null ? "DL" : (row.y_ul_mbps != null ? "UL" : "")));
      sheet.getCell(r, 1).value = cellValue(row.iteration);
      sheet.getCell(r, 2).value = cellValue(direction || row.direction);
      sheet.getCell(r, 3).value = cellValue(row.interval_index ?? row.interval);
      sheet.getCell(r, 4).value = cellValue(row.interval_start_iso ?? row.timestamp_iso);
      sheet.getCell(r, 5).value = cellValue(row.interval_end_iso ?? "");
      sheet.getCell(r, 6).value = cellValue(row.seconds ?? row.elapsed_sec);
      sheet.getCell(r, 7).value = cellValue(row.bytes ?? "");
      sheet.getCell(r, 8).value = cellValue(mbps);
      sheet.getCell(r, 9).value = cellValue(row.status || row.notes || "measured");
      r += 1;
    });
    styleDataRows(sheet, intervalStart, r - 1, intervalHeaders.length);
    r += 1;
  }

  const mobileRows = (throughputRows || []).filter((row) => row.series_type === "android_trafficstats_mobile");
  const mobileDl = aggTrafficStats(mobileRows, "y_dl_mbps");
  const mobileUl = aggTrafficStats(mobileRows, "y_ul_mbps");
  r = writeSectionHeader(sheet, r, "C. TrafficStats Summary");
  if (!mobileDl && !mobileUl) {
    sheet.getCell(r, 1).value = "No Android traffic observed during this session.";
    r += 2;
  } else {
    const summaryHeaders = ["Metric", "Average", "Minimum", "Maximum", "Sample count"];
    summaryHeaders.forEach((h, i) => { sheet.getCell(r, i + 1).value = h; });
    styleHeaderRow(sheet, r, summaryHeaders.length);
    r += 1;
    const sumStart = r;
    if (mobileDl) {
      sheet.getCell(r, 1).value = "Mobile DL (Mbps)";
      sheet.getCell(r, 2).value = mobileDl.average;
      sheet.getCell(r, 3).value = mobileDl.minimum;
      sheet.getCell(r, 4).value = mobileDl.maximum;
      sheet.getCell(r, 5).value = mobileDl.count;
      r += 1;
    }
    if (mobileUl) {
      sheet.getCell(r, 1).value = "Mobile UL (Mbps)";
      sheet.getCell(r, 2).value = mobileUl.average;
      sheet.getCell(r, 3).value = mobileUl.minimum;
      sheet.getCell(r, 4).value = mobileUl.maximum;
      sheet.getCell(r, 5).value = mobileUl.count;
      r += 1;
    }
    styleDataRows(sheet, sumStart, r - 1, summaryHeaders.length);
    r += 1;
  }

  if (mobileRows.length) {
    r = writeSectionHeader(sheet, r, "D. TrafficStats Sample Data — Engineering Detail");
    const headers = [
      "series_type", "label", "timestamp_iso", "elapsed_sec",
      "y_dl_mbps", "y_ul_mbps", "notes",
    ];
    headers.forEach((h, i) => { sheet.getCell(r, i + 1).value = h; });
    styleHeaderRow(sheet, r, headers.length);
    r += 1;
    const start = r;
    mobileRows.forEach((row) => {
      headers.forEach((key, i) => {
        sheet.getCell(r, i + 1).value = cellValue(row[key]);
      });
      r += 1;
    });
    styleDataRows(sheet, start, r - 1, headers.length);
  }

  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 24;
  sheet.getColumn(3).width = 14;
  sheet.getColumn(4).width = 14;
  sheet.getColumn(5).width = 14;
  sheet.getColumn(6).width = 36;
  sheet.getColumn(7).width = 36;
}

async function loadExcelJS() {
  const mod = await import("exceljs");
  return mod?.default || mod;
}

function arrayBufferToBase64(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer || buffer);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function renderPlotImages(specs = [], sharedBasemap = null, canvasDefaults = {}) {
  const images = [];
  const orient = canvasDefaults.orientation || "landscape";
  const size = canvasSizeForOrientation(orient);
  for (const spec of specs) {
    if (!spec) continue;
    if (spec.kind === "note") continue;
    const showEvents = spec.showEvents === true;
    images.push(await renderRouteKpiMapPng({
      ...spec,
      showEvents,
      eventMarkers: showEvents ? (spec.eventMarkers || []) : [],
      sharedBasemap,
      orientation: spec.orientation || orient,
      width: spec.width ?? canvasDefaults.width ?? size.width,
      height: spec.height ?? canvasDefaults.height ?? size.height,
    }));
  }
  return images;
}

async function renderEventImages(specs = []) {
  const images = [];
  for (const spec of specs) {
    if (!spec) continue;
    images.push(await renderEventTimeSeriesPng(spec));
  }
  return images;
}

function embedImagesOnSheet(workbook, sheet, images, title, subtitleLines = []) {
  const next = addTitleBlock(sheet, title, subtitleLines);
  let rowCursor = next;
  sheet.getColumn(1).width = 18;
  sheet.getColumn(2).width = 18;

  if (!images.length) {
    sheet.getCell(rowCursor, 1).value = "No plots available for this session.";
    return;
  }

  images.forEach((img, index) => {
    const labelRow = rowCursor;
    safeMergeCells(sheet, labelRow, 1, labelRow, 8, `plot label row ${labelRow}`);
    sheet.getCell(labelRow, 1).value = cellValue(`${index + 1}. ${img.title || "Plot"}`);
    sheet.getCell(labelRow, 1).font = { bold: true, size: 12, color: { argb: BRAND.navy }, name: "Calibri" };
    sheet.getCell(labelRow, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.sectionFill } };
    rowCursor = labelRow + 1;

    const imageId = workbook.addImage({
      base64: img.base64,
      extension: "png",
    });
    const imgW = img.width || 1000;
    const imgH = img.height || 640;
    const orient = img.orientation || (imgW >= imgH ? "landscape" : "portrait");
    const maxDisplayW = orient === "portrait" ? 520 : 720;
    const displayW = Math.min(maxDisplayW, imgW);
    const displayH = displayW * (imgH / imgW);
    sheet.addImage(imageId, {
      tl: { col: 0.2, row: rowCursor - 1 },
      ext: { width: displayW, height: displayH },
      editAs: "oneCell",
    });
    const rowsNeeded = Math.ceil(displayH / 15) + 2;
    rowCursor += rowsNeeded;
  });
}

/**
 * Build .xlsx ArrayBuffer + base64 from plot report model.
 */
export async function buildExcelPlotWorkbookBuffer(model = {}, options = {}) {
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const reportProgress = (stage) => {
    if (onProgress) onProgress(stage);
  };

  reportProgress("Preparing session data");

  const ExcelJS = await loadExcelJS();
  if (!ExcelJS?.Workbook) {
    throw new Error("exceljs Workbook unavailable after dynamic import");
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BabyDragon / MobbiTech Global LLC";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.description = "BabyDragon Excel Plot Report";

  const distance = model.distance || {};
  const mapSpecs = model.mapPlotSpecs || { rfPlots: [], dataPlots: [], gpsPointsForBasemap: [] };
  const sheetFlags = model.sheetFlags || {
    hasRfMaps: (mapSpecs.rfPlots || []).length > 0,
    hasDataMaps: (mapSpecs.dataPlots || []).length > 0,
    hasEventPlots: (model.eventPlotSpecs || []).length > 0,
    hasEventMaps: (model.eventMapPlotSpecs || []).length > 0,
    hasVoice: (model.voiceEvents || []).length > 0,
    hasExternalEvidence: (model.externalEvidenceRows || []).length > 0,
  };

  reportProgress("Calculating KPI summary");

  const gpsForBasemap = mapSpecs.gpsPointsForBasemap || [];
  const sessionAspect = computeProjectedRouteAspect(gpsForBasemap);
  const sessionOrientation = sessionAspect.orientation;
  const canvasSize = canvasSizeForOrientation(sessionOrientation);
  const mapPixelW = Math.round(canvasSize.width * 0.79);
  const mapPixelH = Math.round(canvasSize.height * 0.786);
  const canvasDefaults = {
    orientation: sessionOrientation,
    width: canvasSize.width,
    height: canvasSize.height,
  };

  let sharedBasemap = null;
  try {
    sharedBasemap = await prepareSharedBasemap(gpsForBasemap, mapPixelW, mapPixelH);
  } catch {
    sharedBasemap = null;
  }

  const basemapMeta = sharedBasemap?.meta || {
    map_background_provider: "Coordinate-only fallback",
    map_provider_attempts: "No providers attempted",
    map_tile_failure_note: "Basemap prep unavailable",
    map_attribution: "No tile attribution (coordinate-only fallback)",
  };

  reportProgress("Building event timelines");

  reportProgress("Rendering RF maps");
  const rfImages = sheetFlags.hasRfMaps
    ? await renderPlotImages(mapSpecs.rfPlots || [], sharedBasemap, canvasDefaults)
    : [];

  reportProgress("Rendering data maps");
  const dataImages = sheetFlags.hasDataMaps
    ? await renderPlotImages(mapSpecs.dataPlots || [], sharedBasemap, canvasDefaults)
    : [];

  reportProgress("Rendering event maps");
  const eventImages = sheetFlags.hasEventPlots
    ? await renderEventImages(model.eventPlotSpecs || [])
    : [];
  const eventMapImages = sheetFlags.hasEventMaps
    ? await renderPlotImages(model.eventMapPlotSpecs || [], sharedBasemap, canvasDefaults)
    : [];

  if (sharedBasemap?.basemap?.canvas) {
    try {
      sharedBasemap.basemap.canvas.width = 0;
      sharedBasemap.basemap.canvas.height = 0;
    } catch {
      // ignore
    }
    sharedBasemap.basemap.canvas = null;
  }

  reportProgress("Writing workbook");

  const sheetNamesCreated = [];
  let indexSheetLayout = null;
  const N = EXCEL_PLOT_SHEET_NAMES;
  const paletteSnapshot = model.paletteSnapshot || null;

  // 01_Test_Grid_Info
  {
    const sheet = workbook.addWorksheet(N[0], {
      properties: { tabColor: { argb: BRAND.navy } },
    });
    const customerInfoForSheet = {
      ...(model.customerInfo || {}),
      reportRows: [
        { label: "Map provider", value: basemapMeta.map_background_provider },
        {
          label: "Color note",
          value: paletteSnapshot?.note || "Map and graph colors use the active BabyDragon KPI display profile captured at report export.",
        },
      ],
    };
    writeCustomerInfoSheet(sheet, customerInfoForSheet, basemapMeta, distance, paletteSnapshot);
    sheetNamesCreated.push(N[0]);
  }

  // 02_Index
  {
    const sheet = workbook.addWorksheet(N[1], {
      properties: { tabColor: { argb: BRAND.accent } },
    });
    indexSheetLayout = writeIndexSheet(sheet, model.indexRows || [], distance);
    sheetNamesCreated.push(N[1]);
  }

  // 03_KPI_Summary
  {
    const sheet = workbook.addWorksheet(N[2]);
    writeKpiSummarySheet(sheet, model.kpiSummary || {}, distance);
    sheetNamesCreated.push(N[2]);
  }

  // 04_RF_Plot_Data (no event columns)
  {
    const sheet = workbook.addWorksheet(N[3]);
    const headers = [
      "elapsed_sec", "timestamp_iso", "timestamp_local", "record_state", "rat",
      "lte_rsrp", "lte_rsrq", "lte_sinr", "lte_pci", "lte_earfcn", "lte_cell_id", "lte_tac", "lte_rssi",
      "nr_ss_rsrp", "nr_ss_rsrq", "nr_ss_sinr", "nr_pci", "nr_nrarfcn", "nr_nci", "nr_tac", "nr_secondary_status",
      "wcdma_rscp", "wcdma_ecno", "wcdma_psc", "wcdma_uarfcn",
      "gsm_rxlev", "gsm_ber", "gsm_bsic", "gsm_arfcn",
    ];
    writeObjectRowsStyled(
      sheet,
      headers,
      model.plotRows || [],
      "04 — RF Plot Data",
      [
        "Active-technology KPI columns for engineering review.",
        "Event markers are on 07_Data_Events, 13_Event_Graphs, and 14_Event_Map_Plots — not duplicated here.",
        sheetFlags.hasRfMaps
          ? "See 11_RF_Map_Plots for embedded KPI route maps (Start/End only)."
          : "No RF map plot sheet in this workbook.",
      ],
    );
    sheetNamesCreated.push(N[3]);
  }

  // 05_RF_Raw_Data
  {
    const sheet = workbook.addWorksheet(N[4]);
    const headers = [
      "sample_index", "timestamp_iso", "timestamp_local", "elapsed_sec", "record_state", "mode",
      "gps_lat", "gps_lon", "gps_accuracy_m", "gps_speed_mps",
      "gps_status", "gps_fix_age_ms", "location_fix_timestamp_iso", "gps_provider",
      "rat", "technology_label", "call_state",
      "lte_rsrp", "lte_rsrq", "lte_sinr", "lte_pci", "lte_earfcn", "lte_cell_id", "lte_tac", "lte_rssi",
      "nr_ss_rsrp", "nr_ss_rsrq", "nr_ss_sinr", "nr_pci", "nr_nrarfcn", "nr_nci", "nr_tac", "nr_secondary_status",
      "wcdma_rscp", "wcdma_ecno", "wcdma_psc", "wcdma_uarfcn",
      "gsm_rxlev", "gsm_ber", "gsm_bsic", "gsm_arfcn",
      "traffic_stats_supported", "traffic_stats_dl_mbps", "traffic_stats_ul_mbps",
      "traffic_stats_total_dl_mbps", "traffic_stats_total_ul_mbps",
      "traffic_stats_counter_reset", "traffic_stats_note", "pause_note",
    ];
    writeObjectRowsStyled(
      sheet,
      headers,
      model.rawRows || [],
      "05 — RF Raw Data",
      [model.sampleCapNote || "Sample list may be capped by live collector."],
    );
    sheetNamesCreated.push(N[4]);
  }

  // 06_Data_Throughput
  {
    const sheet = workbook.addWorksheet(N[5]);
    writeThroughputSections(sheet, model.throughputRows || [], model);
    sheetNamesCreated.push(N[5]);
  }

  // 07_Data_Events — customer columns first, audit afterward
  {
    const sheet = workbook.addWorksheet(N[6]);
    const headers = [
      "local_time", "elapsed_sec", "event_family", "event_type", "label",
      "iteration_test", "result_status", "error_code", "error_message", "failure_stage",
      "dl_mbps", "ul_mbps", "gps_matched", "notes",
      "event_id", "timestamp_iso", "source", "confidence",
      "map_lat", "map_lon", "map_gps_attach_mode", "map_gps_match_delta_sec",
      "rat", "pci", "channel", "cell_id", "direction", "error_text",
      "timestamp_origin",
    ];
    const rows = (model.dataEvents || []).map((evt) => ({
      local_time: evt.timestampIso ? (() => {
        try { return new Date(evt.timestampIso).toLocaleString(); } catch { return ""; }
      })() : "",
      elapsed_sec: evt.elapsedSec,
      event_family: evt.category,
      event_type: evt.eventType,
      label: evt.label,
      iteration_test: evt.relatedIteration ?? evt.relatedTestId ?? "",
      result_status: evt.resultStatus || (evt.errorText ? "failure/error noted" : (evt.confidence || "")),
      error_code: evt.errorCode || "",
      error_message: evt.errorMessage || evt.errorText || "",
      failure_stage: evt.failureStage || "",
      dl_mbps: evt.dlMbps,
      ul_mbps: evt.ulMbps,
      gps_matched: evt.mapGpsMatched === true ? "yes" : "no",
      notes: evt.notes,
      event_id: evt.eventId,
      timestamp_iso: evt.timestampIso,
      source: evt.source,
      confidence: evt.confidence,
      map_lat: evt.mapGpsMatched ? evt.mapLat : "",
      map_lon: evt.mapGpsMatched ? evt.mapLon : "",
      map_gps_attach_mode: evt.mapGpsAttachMode || "none",
      map_gps_match_delta_sec: evt.mapGpsMatchDeltaSec,
      rat: evt.rat,
      pci: evt.pci,
      channel: evt.channel,
      cell_id: evt.cellId,
      direction: evt.direction,
      error_text: evt.errorText,
      timestamp_origin: evt.timestampOrigin || "recorded",
    }));
    writeObjectRowsStyled(
      sheet,
      headers,
      rows,
      "07 — Data / RF / Session Events",
      [
        "Customer-readable columns first; technical audit columns follow.",
        "Blank map_lat/map_lon means the event is not drawn on geographic maps (may still appear on 13_Event_Graphs).",
        "Derived Native HTTP DL/UL end times are labeled timestamp_origin=derived_wall_duration.",
      ],
    );
    sheetNamesCreated.push(N[6]);
  }

  // 08_Voice_Events — only when meaningful
  if (sheetFlags.hasVoice) {
    const sheet = workbook.addWorksheet(N[7]);
    const headers = [
      "local_time", "elapsed_sec", "event_type", "call_state", "call_direction",
      "ringing_episode", "transition_from", "transition_to", "setup_time_ms",
      "observed_offhook_duration_sec", "disconnect_cause", "phone_number_masked",
      "source", "confidence", "notes",
    ];
    const rows = (model.voiceEvents || []).map((evt) => {
      const localTime = evt.timestampIso
        ? (() => {
          try { return new Date(evt.timestampIso).toLocaleString(); } catch { return evt.timestampIso; }
        })()
        : "";
      return {
        local_time: localTime,
        elapsed_sec: evt.elapsedSec ?? "",
        event_type: evt.eventType || "",
        call_state: evt.callState || "",
        call_direction: "Unknown",
        ringing_episode: evt.ringingEpisode ?? "",
        transition_from: evt.transitionFrom || "",
        transition_to: evt.transitionTo || "",
        setup_time_ms: evt.setupTimeMs ?? "",
        observed_offhook_duration_sec: evt.observedOffhookDurationSec ?? "",
        disconnect_cause: "N/A",
        phone_number_masked: "Not exposed",
        source: evt.source || "",
        confidence: evt.confidence || "",
        notes: evt.notes || evt.details || "",
      };
    });
    writeObjectRowsStyled(
      sheet,
      headers,
      rows,
      "08 — Voice Events",
      [model.voiceNote || "Passive call-state observation only. MO/MT/SRVCC/CSFB/drops are never invented."],
    );
    sheetNamesCreated.push(N[7]);
  }

  // 09_External_Evidence — only when rows exist
  if (sheetFlags.hasExternalEvidence) {
    const sheet = workbook.addWorksheet(N[8]);
    const headers = [
      "source_type", "evidence_source", "iteration_or_test_id", "result_id", "result_url",
      "result_timestamp", "start_timestamp", "end_timestamp",
      "dl_mbps", "ul_mbps", "ping_ms", "jitter_ms", "loss_pct",
      "server", "provider", "connection_type",
      "matched_rf_status", "matched_rf_time_delta_sec", "matched_gps_lat", "matched_gps_lon",
      "matched_traffic_dl_mbps", "matched_traffic_ul_mbps",
      "inside_babydragon_window", "completeness_status", "notes",
    ];
    writeObjectRowsStyled(
      sheet,
      headers,
      model.externalEvidenceRows || [],
      "09 — External Evidence (OOKLA / FCC)",
      ["External evidence only. APP DL/UL remains N/A for OOKLA/FCC sessions."],
    );
    sheetNamesCreated.push(N[8]);
  }

  // 11_RF_Map_Plots
  if (rfImages.length > 0) {
    const sheet = workbook.addWorksheet(N[9], {
      properties: { tabColor: { argb: "FF1A9850" } },
    });
    embedImagesOnSheet(
      workbook,
      sheet,
      rfImages,
      "11 — RF KPI Map Plots",
      [
        `Distance covered: ${cellValue(distance.distance_covered_miles)} mi`,
        `Map background: ${cellValue(basemapMeta.map_background_provider)}`,
        `Attribution: ${cellValue(basemapMeta.map_attribution)}`,
        "KPI-colored route with Start/End only. Event markers are on 13_Event_Graphs and 14_Event_Map_Plots.",
      ],
    );
    sheetNamesCreated.push(N[9]);
  }

  // 12_Data_Map_Plots
  if (dataImages.length > 0) {
    const sheet = workbook.addWorksheet(N[10], {
      properties: { tabColor: { argb: "FFD73027" } },
    });
    embedImagesOnSheet(
      workbook,
      sheet,
      dataImages,
      "12 — Data Throughput Map Plots",
      [
        `Distance covered: ${cellValue(distance.distance_covered_miles)} mi`,
        distance?.stationary
          ? `GPS Positional Variation: ${cellValue(distance.gps_positional_variation_m ?? distance?.diagnostics?.gps_positional_variation_m)} m`
          : null,
        `Map background: ${cellValue(basemapMeta.map_background_provider)}`,
        "Throughput route maps with Start/End only. Mobile and Total TrafficStats are never silently mixed.",
        model.mapPlotSpecs?.mobileTrafficNote || null,
        "OOKLA/FCC are never used as APP DL/UL.",
      ].filter(Boolean),
    );
    sheetNamesCreated.push(N[10]);
  }

  const outcomeSubtitle = (() => {
    const o = model.dataTestOutcome || {};
    if (o.attemptedIterations == null && o.completedIterations == null) return null;
    return `Attempts ${o.attemptedIterations ?? 0}  |  Completed ${o.completedIterations ?? 0}  |  Failed ${o.failedIterations ?? 0}`;
  })();

  // 13_Event_Graphs
  if (eventImages.length > 0) {
    const sheet = workbook.addWorksheet(N[11], {
      properties: { tabColor: { argb: "FF7C3AED" } },
    });
    embedImagesOnSheet(
      workbook,
      sheet,
      eventImages,
      "13 — Event Graphs (consolidated timelines)",
      [
        outcomeSubtitle,
        "Each image is a consolidated elapsed-time graph for Start/End, radio, voice, or failure events.",
        "True timestamps are unchanged; near-coincident markers use display-only offsets.",
        "Derived Native HTTP end times are labeled when computed from recorded wall duration.",
        "Legend colors match the plotted KPI bins and event marker style.",
      ].filter(Boolean),
    );
    sheetNamesCreated.push(N[11]);
  }

  // 14_Event_Map_Plots
  if (eventMapImages.length > 0) {
    const sheet = workbook.addWorksheet(N[12], {
      properties: { tabColor: { argb: "FF9333EA" } },
    });
    embedImagesOnSheet(
      workbook,
      sheet,
      eventMapImages,
      "14 — Event Map Plots (GPS-matched events)",
      [
        outcomeSubtitle,
        `Map background: ${cellValue(basemapMeta.map_background_provider)}`,
        "GPS-matched occurrences only. Unmatched events remain on Event Graphs and Data Events.",
        "One map per meaningful radio-event type that occurred. Empty event types omitted. Unmatched events stay on graphs/Data Events.",
        "Start/End markers included. Legend colors match rendering.",
      ].filter(Boolean),
    );
    sheetNamesCreated.push(N[12]);
  }

  // 15_ReadMe — last sheet; technical metadata from cover lives here
  {
    const sheet = workbook.addWorksheet(N[13]);
    const readMeRows = [...(model.readMeRows || [])];
    const technicalRows = model.customerInfo?.technicalRows || [];
    technicalRows.forEach((row) => {
      readMeRows.push({ topic: row.label, rule: row.value });
    });
    if (paletteSnapshot?.metrics?.length) {
      paletteSnapshot.metrics.forEach((metric) => {
        const binSummary = (metric.bins || [])
          .slice(0, 4)
          .map((b) => b.label)
          .filter(Boolean)
          .join(", ");
        readMeRows.push({
          topic: `Palette — ${metric.displayName || metric.metricKey}`,
          rule: `${metric.unit || ""}${binSummary ? ` (${binSummary}${(metric.bins || []).length > 4 ? ", …" : ""})` : ""}`.trim(),
        });
      });
    }
    const headerRow = writeObjectRowsStyled(
      sheet,
      ["topic", "rule"],
      readMeRows,
      "15 — ReadMe / Truth Rules",
      ["Concise interpretation rules for this parallel Excel Plot Report. Technical metadata follows truth rules."],
    );
    for (let rr = headerRow; rr >= 1; rr -= 1) {
      sheet.getRow(rr).eachCell((cell) => {
        cell.alignment = { ...(cell.alignment || {}), wrapText: false, vertical: "middle" };
      });
    }
    sheet.getColumn(1).width = 36;
    sheet.getColumn(2).width = 96;
    sheetNamesCreated.push(N[13]);
  }

  // Rebuild index rows only — avoid re-merging title block on sheet 02_Index.
  if (workbook.getWorksheet(N[1]) && indexSheetLayout?.headerRow) {
    refreshIndexSheetRows(
      workbook.getWorksheet(N[1]),
      (model.indexRows || []).filter((row) => sheetNamesCreated.includes(row.sheet_name)),
      indexSheetLayout.headerRow,
    );
  }

  sheetNamesCreated.forEach((name, index) => {
    const sheet = workbook.getWorksheet(name);
    if (sheet) sheet.orderNo = index + 1;
  });

  reportProgress("Saving report");

  const buffer = await workbook.xlsx.writeBuffer();
  const arrayBuffer = buffer instanceof ArrayBuffer
    ? buffer
    : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const base64 = arrayBufferToBase64(buffer);
  const sizeBytes = buffer.byteLength || arrayBuffer.byteLength || 0;

  const magic = new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer);
  const looksZip = magic.length >= 2 && magic[0] === 0x50 && magic[1] === 0x4b;
  const sentinel42Smoke = countUnexpectedLiteral42(workbook);
  const sentinel34Smoke = countUnexpectedLiteral34(workbook);

  return {
    arrayBuffer,
    base64,
    sizeBytes,
    looksZip,
    sheetNames: sheetNamesCreated.slice(),
    mapImageCounts: {
      rf: rfImages.length,
      data: dataImages.length,
      events: eventImages.length,
      eventMaps: eventMapImages.length,
    },
    basemapSource: sharedBasemap?.source || "fallback",
    basemapMeta,
    sessionOrientation,
    sentinel42Smoke,
    sentinel34Smoke,
  };
}

export async function buildExcelPlotReportFile(model = {}, fileName = "BabyDragon_Plots_Report.xlsx", options = {}) {
  const built = await buildExcelPlotWorkbookBuffer(model, options);
  return {
    fileName,
    reportLabel: "Excel Plot Report",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    encoding: "base64",
    contentBase64: built.base64,
    content: "",
    sizeBytes: built.sizeBytes,
    looksZip: built.looksZip,
    sheetNames: built.sheetNames,
    mapImageCounts: built.mapImageCounts,
  };
}
