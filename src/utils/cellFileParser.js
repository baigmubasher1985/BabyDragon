// src/utils/cellFileParser.js
//
// BabyDragon / NetField-360
// Cell File Parser V1
//
// Purpose:
// Parse RF TXT / CSV cell files and prepare clean records for:
// - public.cell_files
// - public.cell_sites
// - public.cell_sectors
//
// KML / KMZ parsing is handled by:
// - src/utils/cellKmlParser.js
//
// Supported text format:
// SYSTEM, SITE, LAT, LON, CELL_NAME, CID, DIR, ANT_BW, LAC, MCC, MNC, EARFCN, PCI
//
// Supports:
// - .txt
// - .csv
// - .kml
// - .kmz
// - tab separated
// - comma separated
// - semicolon separated
// - pipe separated
// - basic whitespace separated fallback

export const CELL_FILE_REQUIRED_FIELDS = ["site_name", "lat", "lon"];

export const CELL_FILE_SUPPORTED_EXTENSIONS = [".txt", ".csv", ".kml", ".kmz"];

const HEADER_ALIASES = {
  system: ["SYSTEM", "TECH", "TECHNOLOGY", "RAT", "TYPE"],
  site_name: [
    "SITE",
    "SITE_NAME",
    "SITENAME",
    "ENODEB",
    "ENB",
    "GNODEB",
    "GNB",
    "NODEB",
  ],
  lat: ["LAT", "LATITUDE", "SITE_LAT", "CELL_LAT"],
  lon: ["LON", "LONG", "LNG", "LONGITUDE", "SITE_LON", "SITE_LONG", "CELL_LON"],
  cell_name: ["CELL_NAME", "CELLNAME", "CELL", "SECTOR", "SECTOR_NAME", "CELL ID NAME"],
  cid: ["CID", "CELL_ID", "CELLID", "CI", "ECI", "NCI"],
  azimuth: ["DIR", "DIRECTION", "AZIMUTH", "AZ", "BEARING"],
  antenna_bw: ["ANT_BW", "ANTBW", "ANTENNA_BW", "BEAMWIDTH", "BEAM_WIDTH", "HBW"],
  lac: ["LAC", "TAC"],
  mcc: ["MCC"],
  mnc: ["MNC"],
  earfcn: ["EARFCN", "ARFCN", "NRARFCN", "NR_ARFCN", "UARFCN"],
  pci: ["PCI", "PSC", "SC", "PILOT"],
};

export function isSupportedCellFileName(fileName = "") {
  const lower = String(fileName).toLowerCase();

  return CELL_FILE_SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function parseCellFileText(text, options = {}) {
  const fileName = options.fileName || "cell_file.txt";
  const market = cleanText(options.market || "");
  const defaultTechnology = cleanText(options.technology || "");

  if (!text || !String(text).trim()) {
    return emptyResult({
      fileName,
      market,
      technology: defaultTechnology,
      error: "Cell file is empty.",
    });
  }

  const lines = String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"));

  if (lines.length < 2) {
    return emptyResult({
      fileName,
      market,
      technology: defaultTechnology,
      error: "Cell file must contain a header row and at least one data row.",
    });
  }

  const delimiter = detectDelimiter(lines[0]);
  const rawHeaders = splitLine(lines[0], delimiter);
  const mappedHeaders = mapHeaders(rawHeaders);

  const missingFields = CELL_FILE_REQUIRED_FIELDS.filter(
    (field) => !mappedHeaders.includes(field)
  );

  if (missingFields.length) {
    return emptyResult({
      fileName,
      market,
      technology: defaultTechnology,
      error: `Missing required column(s): ${missingFields.join(", ")}`,
      warnings: [
        `Detected headers: ${rawHeaders.join(", ")}`,
        "Expected at minimum: SITE, LAT, LON",
      ],
    });
  }

  const sectors = [];
  const siteMap = new Map();
  const errors = [];
  const warnings = [];

  for (let i = 1; i < lines.length; i += 1) {
    const lineNumber = i + 1;
    const values = splitLine(lines[i], delimiter);

    if (!values.length) continue;

    const row = buildRowObject(rawHeaders, mappedHeaders, values);

    const siteName = cleanText(row.site_name);
    const lat = toNumber(row.lat);
    const lon = toNumber(row.lon);

    if (!siteName) {
      errors.push(`Line ${lineNumber}: Missing SITE value.`);
      continue;
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      errors.push(`Line ${lineNumber}: Invalid LAT/LON for site ${siteName}.`);
      continue;
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      errors.push(`Line ${lineNumber}: LAT/LON out of range for site ${siteName}.`);
      continue;
    }

    const system = cleanText(row.system || defaultTechnology);
    const technology = normalizeTechnology(system || defaultTechnology);
    const azimuth = toNullableNumber(row.azimuth);
    const antennaBw = toNullableNumber(row.antenna_bw);

    const siteKey = buildSiteKey({
      market,
      siteName,
      lat,
      lon,
      technology,
    });

    if (!siteMap.has(siteKey)) {
      siteMap.set(siteKey, {
        temp_key: siteKey,
        market: market || null,
        site_name: siteName,
        technology: technology || null,
        lat,
        lon,
      });
    }

    sectors.push({
      temp_site_key: siteKey,

      market: market || null,
      system: system || null,
      technology: technology || null,

      site_name: siteName,
      cell_name: cleanText(row.cell_name) || null,
      cid: cleanText(row.cid) || null,

      lat,
      lon,

      azimuth,
      antenna_bw: antennaBw,

      lac: cleanText(row.lac) || null,
      mcc: cleanText(row.mcc) || null,
      mnc: cleanText(row.mnc) || null,
      earfcn: cleanText(row.earfcn) || null,
      pci: cleanText(row.pci) || null,

      raw_row: row.__raw,
    });
  }

  const sites = Array.from(siteMap.values());

  const detectedTechnologies = uniqueClean(
    sectors.map((sector) => sector.technology).filter(Boolean)
  );

  const technology =
    defaultTechnology ||
    (detectedTechnologies.length === 1 ? detectedTechnologies[0] : "Mixed");

  if (!sectors.length && !errors.length) {
    warnings.push("No valid sector records found.");
  }

  return {
    ok: sectors.length > 0,
    file: {
      file_name: fileName,
      market: market || null,
      technology: technology || null,
      record_count: sectors.length,
    },
    delimiter,
    headers: rawHeaders,
    mapped_headers: mappedHeaders,
    sites,
    sectors,
    stats: {
      total_lines: lines.length,
      total_sites: sites.length,
      total_sectors: sectors.length,
      technologies: detectedTechnologies,
    },
    errors,
    warnings,
  };
}

export function prepareSitesForInsert(parsedResult, cellFileId) {
  if (!parsedResult?.sites?.length) return [];

  return parsedResult.sites.map((site) => ({
    cell_file_id: cellFileId,
    market: site.market,
    site_name: site.site_name,
    technology: site.technology,
    lat: site.lat,
    lon: site.lon,
  }));
}

export function prepareSectorsForInsert(parsedResult, cellFileId, siteIdByTempKey = {}) {
  if (!parsedResult?.sectors?.length) return [];

  return parsedResult.sectors.map((sector) => ({
    cell_file_id: cellFileId,
    site_id: siteIdByTempKey[sector.temp_site_key] || null,

    market: sector.market,
    system: sector.system,
    technology: sector.technology,

    site_name: sector.site_name,
    cell_name: sector.cell_name,
    cid: sector.cid,

    lat: sector.lat,
    lon: sector.lon,

    azimuth: sector.azimuth,
    antenna_bw: sector.antenna_bw,

    lac: sector.lac,
    mcc: sector.mcc,
    mnc: sector.mnc,
    earfcn: sector.earfcn,
    pci: sector.pci,

    raw_row: sector.raw_row,
  }));
}

export function buildSiteIdMap(insertedSites = [], parsedSites = []) {
  const map = {};

  parsedSites.forEach((parsedSite) => {
    const match = insertedSites.find((site) => {
      return (
        cleanText(site.site_name) === cleanText(parsedSite.site_name) &&
        nearlyEqual(Number(site.lat), Number(parsedSite.lat)) &&
        nearlyEqual(Number(site.lon), Number(parsedSite.lon))
      );
    });

    if (match?.id) {
      map[parsedSite.temp_key] = match.id;
    }
  });

  return map;
}

function emptyResult({ fileName, market, technology, error, warnings = [] }) {
  return {
    ok: false,
    file: {
      file_name: fileName,
      market: market || null,
      technology: technology || null,
      record_count: 0,
    },
    delimiter: null,
    headers: [],
    mapped_headers: [],
    sites: [],
    sectors: [],
    stats: {
      total_lines: 0,
      total_sites: 0,
      total_sectors: 0,
      technologies: [],
    },
    errors: error ? [error] : [],
    warnings,
  };
}

function detectDelimiter(headerLine) {
  const candidates = [
    { name: "tab", value: "\t" },
    { name: "comma", value: "," },
    { name: "semicolon", value: ";" },
    { name: "pipe", value: "|" },
  ];

  let best = {
    name: "whitespace",
    value: "whitespace",
    count: 0,
  };

  candidates.forEach((candidate) => {
    const count = countOccurrences(headerLine, candidate.value);

    if (count > best.count) {
      best = {
        ...candidate,
        count,
      };
    }
  });

  return best.value;
}

function splitLine(line, delimiter) {
  if (delimiter === "whitespace") {
    return String(line)
      .trim()
      .split(/\s+/)
      .map(cleanText);
  }

  return parseDelimitedLine(String(line), delimiter).map(cleanText);
}

function parseDelimitedLine(line, delimiter) {
  const result = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === delimiter && !insideQuotes) {
      result.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
}

function mapHeaders(rawHeaders) {
  return rawHeaders.map((header) => {
    const normalizedHeader = normalizeHeader(header);

    for (const [standardName, aliases] of Object.entries(HEADER_ALIASES)) {
      const normalizedAliases = aliases.map(normalizeHeader);

      if (normalizedAliases.includes(normalizedHeader)) {
        return standardName;
      }
    }

    return normalizedHeader.toLowerCase();
  });
}

function buildRowObject(rawHeaders, mappedHeaders, values) {
  const row = {};
  const raw = {};

  rawHeaders.forEach((header, index) => {
    const rawHeader = cleanText(header);
    const mappedHeader = mappedHeaders[index];
    const value = cleanText(values[index] ?? "");

    raw[rawHeader] = value;

    if (!row[mappedHeader]) {
      row[mappedHeader] = value;
    }
  });

  row.__raw = raw;

  return row;
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/[()]/g, "")
    .replace(/[\s\-./]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function normalizeTechnology(value) {
  const text = cleanText(value).toUpperCase();

  if (!text) return "";

  if (text.includes("NR") || text.includes("5G")) return "5G";
  if (text.includes("LTE") || text.includes("4G")) return "LTE";
  if (text.includes("UMTS") || text.includes("WCDMA") || text.includes("3G")) return "3G";
  if (text.includes("GSM") || text.includes("2G")) return "2G";

  return cleanText(value);
}

function buildSiteKey({ market, siteName, lat, lon, technology }) {
  return [
    cleanText(market).toLowerCase(),
    cleanText(siteName).toLowerCase(),
    Number(lat).toFixed(6),
    Number(lon).toFixed(6),
    cleanText(technology).toLowerCase(),
  ].join("|");
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
}

function toNumber(value) {
  const cleaned = cleanText(value).replace(/,/g, "");

  if (!cleaned) return NaN;

  const number = Number(cleaned);
  return Number.isFinite(number) ? number : NaN;
}

function toNullableNumber(value) {
  const number = toNumber(value);
  return Number.isFinite(number) ? number : null;
}

function countOccurrences(text, search) {
  return String(text).split(search).length - 1;
}

function uniqueClean(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function nearlyEqual(a, b, tolerance = 0.000001) {
  return Math.abs(a - b) <= tolerance;
}
