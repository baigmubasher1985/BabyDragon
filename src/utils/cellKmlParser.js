// src/utils/cellKmlParser.js
//
// BabyDragon / NetField-360
// Cell KML / KMZ Parser V1
//
// Purpose:
// Import RF cell sites/sectors from KML/KMZ files into the same structure used by:
// - cell_files
// - cell_sites
// - cell_sectors
//
// Supports example styles:
// 1. Sector polygon placemarks with description table using td/b tags
// 2. Sector polygon placemarks with description table using th/td tags
// 3. Point placemarks as fallback site locations
// 4. ExtendedData/Data fields when available
// 5. KMZ files containing a .kml file

import JSZip from "jszip";

export const CELL_KML_SUPPORTED_EXTENSIONS = [".kml", ".kmz"];

const FIELD_ALIASES = {
  system: ["SYSTEM", "TECH", "TECHNOLOGY", "RAT", "TYPE"],
  site_name: ["SITE", "SITE_NAME", "SITENAME", "ENODEB", "ENB", "GNODEB", "GNB", "NODEB"],
  lat: ["LAT", "LATITUDE", "SITE_LAT", "CELL_LAT"],
  lon: ["LON", "LONG", "LNG", "LONGITUDE", "SITE_LON", "SITE_LONG", "CELL_LON"],
  cell_name: ["CELL_NAME", "CELLNAME", "CELL", "SECTOR", "SECTOR_NAME"],
  cid: ["CID", "CELL_ID", "CELLID", "CI", "ECI", "NCI"],
  azimuth: ["DIR", "DIRECTION", "AZIMUTH", "AZ", "BEARING"],
  antenna_bw: ["ANT_BW", "ANTBW", "ANTENNA_BW", "BEAMWIDTH", "BEAM_WIDTH", "BW", "HBW"],
  lac: ["LAC", "TAC"],
  mcc: ["MCC"],
  mnc: ["MNC"],
  earfcn: ["EARFCN", "ARFCN", "NRARFCN", "NR_ARFCN", "UARFCN"],
  pci: ["PCI", "PSC", "SC", "PILOT"],
};

export function isKmlKmzFileName(fileName = "") {
  const lower = String(fileName).toLowerCase();
  return CELL_KML_SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export async function parseCellKmlFile(file, options = {}) {
  if (!file) {
    return emptyResult({
      fileName: "cell_file.kml",
      market: options.market,
      technology: options.technology,
      error: "No KML/KMZ file selected.",
    });
  }

  const fileName = file.name || "cell_file.kml";

  if (!isKmlKmzFileName(fileName)) {
    return emptyResult({
      fileName,
      market: options.market,
      technology: options.technology,
      error: "Only .kml and .kmz files are supported by the KML parser.",
    });
  }

  const kmlText = await getKmlTextFromFile(file);

  return parseCellKmlText(kmlText, {
    ...options,
    fileName,
  });
}

export function parseCellKmlText(kmlText, options = {}) {
  const fileName = options.fileName || "cell_file.kml";
  const market = cleanText(options.market || "");
  const defaultTechnology = cleanText(options.technology || "");

  if (!kmlText || !String(kmlText).trim()) {
    return emptyResult({
      fileName,
      market,
      technology: defaultTechnology,
      error: "KML file is empty.",
    });
  }

  let xmlDoc;

  try {
    xmlDoc = new DOMParser().parseFromString(kmlText, "text/xml");
  } catch (error) {
    return emptyResult({
      fileName,
      market,
      technology: defaultTechnology,
      error: error.message || "Unable to parse KML XML.",
    });
  }

  const parserError = xmlDoc.getElementsByTagName("parsererror")?.[0];

  if (parserError) {
    return emptyResult({
      fileName,
      market,
      technology: defaultTechnology,
      error: parserError.textContent || "Invalid KML XML.",
    });
  }

  const placemarks = getElementsByLocalName(xmlDoc, "Placemark");

  const sectors = [];
  const siteMap = new Map();
  const pointSiteHints = new Map();

  const errors = [];
  const warnings = [];

  placemarks.forEach((placemark, index) => {
    const name = getChildText(placemark, "name");
    const styleUrl = getChildText(placemark, "styleUrl");
    const description = getChildText(placemark, "description");

    const hasPolygon = getElementsByLocalName(placemark, "Polygon").length > 0;
    const hasPoint = getElementsByLocalName(placemark, "Point").length > 0;

    const descriptionAttrs = parseDescriptionAttributes(description);
    const extendedAttrs = parseExtendedDataAttributes(placemark);
    const attrs = normalizeAttrObject({
      ...descriptionAttrs,
      ...extendedAttrs,
    });

    const pointCoord = getFirstPointCoordinate(placemark);
    const polygonFirstCoord = getFirstPolygonCoordinate(placemark);

    if (hasPoint && !hasPolygon) {
      const siteName =
        getStandardValue(attrs, "site_name") ||
        parseSiteNameFromPlacemarkName(name) ||
        cleanText(name);

      const system =
        getStandardValue(attrs, "system") ||
        technologyFromStyle(styleUrl) ||
        defaultTechnology;

      const technology = normalizeTechnology(system || defaultTechnology);

      const lat =
        toNullableNumber(getStandardValue(attrs, "lat")) ??
        pointCoord?.lat ??
        null;

      const lon =
        toNullableNumber(getStandardValue(attrs, "lon")) ??
        pointCoord?.lon ??
        null;

      if (siteName && Number.isFinite(lat) && Number.isFinite(lon)) {
        const key = buildPointHintKey(siteName, market);
        pointSiteHints.set(key, {
          site_name: siteName,
          market: market || null,
          technology: technology || null,
          lat,
          lon,
        });
      }

      return;
    }

    const looksLikeSector =
      hasPolygon ||
      hasSectorAttributes(attrs) ||
      /pci/i.test(name || "") ||
      /sector/i.test(name || "");

    if (!looksLikeSector) return;

    const system =
      getStandardValue(attrs, "system") ||
      technologyFromStyle(styleUrl) ||
      defaultTechnology;

    const technology = normalizeTechnology(system || defaultTechnology);

    const siteName =
      getStandardValue(attrs, "site_name") ||
      parseSiteNameFromPlacemarkName(name) ||
      "Unknown Site";

    const cellName =
      getStandardValue(attrs, "cell_name") ||
      parseCellNameFromPlacemarkName(name, siteName) ||
      name ||
      null;

    const pci =
      getStandardValue(attrs, "pci") ||
      parsePciFromPlacemarkName(name) ||
      null;

    const cid = getStandardValue(attrs, "cid") || null;

    const hint = pointSiteHints.get(buildPointHintKey(siteName, market));

    const lat =
      toNullableNumber(getStandardValue(attrs, "lat")) ??
      polygonFirstCoord?.lat ??
      pointCoord?.lat ??
      hint?.lat ??
      null;

    const lon =
      toNullableNumber(getStandardValue(attrs, "lon")) ??
      polygonFirstCoord?.lon ??
      pointCoord?.lon ??
      hint?.lon ??
      null;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      errors.push(`Placemark ${index + 1}: Missing LAT/LON for ${name || "unnamed sector"}.`);
      return;
    }

    const azimuth = toNullableNumber(getStandardValue(attrs, "azimuth"));
    const antennaBw = toNullableNumber(getStandardValue(attrs, "antenna_bw"));

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
      system: cleanText(system) || technology || null,
      technology: technology || null,

      site_name: siteName,
      cell_name: cellName,
      cid,

      lat,
      lon,

      azimuth,
      antenna_bw: antennaBw,

      lac: getStandardValue(attrs, "lac") || null,
      mcc: getStandardValue(attrs, "mcc") || null,
      mnc: getStandardValue(attrs, "mnc") || null,
      earfcn: getStandardValue(attrs, "earfcn") || null,
      pci,

      raw_row: {
        placemark_name: name || "",
        style_url: styleUrl || "",
        attributes: attrs,
      },
    });
  });

  const sites = Array.from(siteMap.values());

  const detectedTechnologies = uniqueClean(
    sectors.map((sector) => sector.technology).filter(Boolean)
  );

  const technology =
    defaultTechnology ||
    (detectedTechnologies.length === 1 ? detectedTechnologies[0] : "Mixed");

  if (!sectors.length) {
    warnings.push(
      "No sector records found. This KML may contain only site points, or its sector attributes may use unsupported field names."
    );
  }

  return {
    ok: sectors.length > 0,
    file: {
      file_name: fileName,
      market: market || null,
      technology: technology || null,
      record_count: sectors.length,
    },
    delimiter: "kml",
    headers: getKnownHeadersFromSectors(sectors),
    mapped_headers: [
      "system",
      "site_name",
      "lat",
      "lon",
      "cell_name",
      "cid",
      "azimuth",
      "antenna_bw",
      "lac",
      "mcc",
      "mnc",
      "earfcn",
      "pci",
    ],
    sites,
    sectors,
    stats: {
      total_lines: placemarks.length,
      total_sites: sites.length,
      total_sectors: sectors.length,
      technologies: detectedTechnologies,
    },
    errors,
    warnings,
  };
}

async function getKmlTextFromFile(file) {
  const fileName = String(file.name || "").toLowerCase();

  if (fileName.endsWith(".kml")) {
    return await file.text();
  }

  if (fileName.endsWith(".kmz")) {
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);

    const kmlEntry = Object.values(zip.files).find((entry) => {
      const name = String(entry.name || "").toLowerCase();
      return !entry.dir && name.endsWith(".kml") && !name.includes("__macosx");
    });

    if (!kmlEntry) {
      throw new Error("KMZ file does not contain a .kml file.");
    }

    return await kmlEntry.async("text");
  }

  throw new Error("Unsupported file type. Please use .kml or .kmz.");
}

function getElementsByLocalName(parent, localName) {
  return Array.from(parent.getElementsByTagName("*")).filter(
    (node) => node.localName === localName
  );
}

function getDirectChildrenByLocalName(parent, localName) {
  return Array.from(parent.childNodes || []).filter(
    (node) => node.nodeType === 1 && node.localName === localName
  );
}

function getChildText(parent, localName) {
  const direct = getDirectChildrenByLocalName(parent, localName)?.[0];

  if (direct) return cleanText(direct.textContent || "");

  const nested = getElementsByLocalName(parent, localName)?.[0];

  return cleanText(nested?.textContent || "");
}

function parseDescriptionAttributes(description) {
  const attrs = {};

  if (!description) return attrs;

  try {
    const htmlDoc = new DOMParser().parseFromString(
      `<div>${description}</div>`,
      "text/html"
    );

    htmlDoc.querySelectorAll("tr").forEach((row) => {
      const cells = Array.from(row.querySelectorAll("th,td"));

      if (cells.length < 2) return;

      const key = cleanText(cells[0].textContent || "");
      const value = cleanText(cells[1].textContent || "");

      if (!key || key.toLowerCase() === "attributes") return;

      attrs[key] = value;
    });

    htmlDoc.querySelectorAll("b,strong").forEach((labelNode) => {
      const label = cleanText(labelNode.textContent || "").replace(/:$/, "");
      if (!label) return;

      let value = "";

      let cursor = labelNode.nextSibling;

      while (cursor) {
        if (cursor.nodeType === 1 && cursor.localName?.toLowerCase() === "br") {
          break;
        }

        value += cursor.textContent || "";
        cursor = cursor.nextSibling;
      }

      value = cleanText(value);

      if (value && !attrs[label]) {
        attrs[label] = value.replace(/^:/, "").trim();
      }
    });
  } catch {
    // Fallback below
  }

  const fallbackText = htmlToText(description);

  const labelValueRegex =
    /(SYSTEM|TECHNOLOGY|SITE|LAT|LON|CELL_NAME|CID|DIR|ANT_BW|LAC|MCC|MNC|EARFCN|PCI|AZIMUTH|BW)\s*[:=]\s*([^\n\r<]+)/gi;

  let match = labelValueRegex.exec(fallbackText);

  while (match) {
    const key = cleanText(match[1]);
    const value = cleanText(match[2]);

    if (key && value && !attrs[key]) {
      attrs[key] = value;
    }

    match = labelValueRegex.exec(fallbackText);
  }

  return attrs;
}

function parseExtendedDataAttributes(placemark) {
  const attrs = {};

  const dataNodes = getElementsByLocalName(placemark, "Data");

  dataNodes.forEach((node) => {
    const key = cleanText(node.getAttribute("name") || "");
    const valueNode = getDirectChildrenByLocalName(node, "value")?.[0];
    const value = cleanText(valueNode?.textContent || "");

    if (key && value) {
      attrs[key] = value;
    }
  });

  const simpleDataNodes = getElementsByLocalName(placemark, "SimpleData");

  simpleDataNodes.forEach((node) => {
    const key = cleanText(node.getAttribute("name") || "");
    const value = cleanText(node.textContent || "");

    if (key && value) {
      attrs[key] = value;
    }
  });

  return attrs;
}

function normalizeAttrObject(attrs) {
  const normalized = {};

  Object.entries(attrs || {}).forEach(([key, value]) => {
    const cleanKey = normalizeHeader(key);
    normalized[cleanKey] = cleanText(value);
  });

  return normalized;
}

function getStandardValue(attrs, fieldName) {
  const aliases = FIELD_ALIASES[fieldName] || [];

  for (const alias of aliases) {
    const key = normalizeHeader(alias);

    if (attrs[key] !== undefined && attrs[key] !== null && attrs[key] !== "") {
      return cleanText(attrs[key]);
    }
  }

  return "";
}

function hasSectorAttributes(attrs) {
  return Boolean(
    getStandardValue(attrs, "cell_name") ||
      getStandardValue(attrs, "azimuth") ||
      getStandardValue(attrs, "pci") ||
      getStandardValue(attrs, "cid")
  );
}

function getFirstPointCoordinate(placemark) {
  const point = getElementsByLocalName(placemark, "Point")?.[0];
  if (!point) return null;

  const coordinatesText = getChildText(point, "coordinates");
  return parseFirstCoordinate(coordinatesText);
}

function getFirstPolygonCoordinate(placemark) {
  const polygon = getElementsByLocalName(placemark, "Polygon")?.[0];
  if (!polygon) return null;

  const coordinatesNode = getElementsByLocalName(polygon, "coordinates")?.[0];
  const coordinatesText = cleanText(coordinatesNode?.textContent || "");

  return parseFirstCoordinate(coordinatesText);
}

function parseFirstCoordinate(coordinatesText) {
  const first = cleanText(coordinatesText).split(/\s+/)[0];

  if (!first) return null;

  const parts = first.split(",").map((value) => Number(value));

  if (parts.length < 2) return null;

  const lon = parts[0];
  const lat = parts[1];

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return { lat, lon };
}

function parseSiteNameFromPlacemarkName(name) {
  const text = cleanText(name);

  if (!text) return "";

  if (text.includes(" - ")) {
    return cleanText(text.split(" - ")[0]);
  }

  if (text.includes("_")) {
    return cleanText(text.split("_")[0]);
  }

  return text;
}

function parseCellNameFromPlacemarkName(name, siteName = "") {
  const text = cleanText(name);

  if (!text) return "";

  if (text.includes(" - ")) {
    const parts = text.split(" - ").map(cleanText);
    if (parts.length >= 2) return parts[1];
  }

  if (text.includes("_")) {
    const parts = text.split("_").map(cleanText);
    if (parts.length >= 2) return parts[1];
  }

  if (siteName && text.startsWith(siteName)) {
    return cleanText(text.replace(siteName, "").replace(/^[-_\s]+/, ""));
  }

  return "";
}

function parsePciFromPlacemarkName(name) {
  const text = cleanText(name);
  const match = text.match(/PCI\s*[_\-\s]*([A-Za-z0-9]+)/i);
  return match?.[1] || "";
}

function technologyFromStyle(styleUrl) {
  const text = cleanText(styleUrl).toUpperCase();

  if (text.includes("NR") || text.includes("5G")) return "5G";
  if (text.includes("LTE") || text.includes("4G")) return "LTE";
  if (text.includes("UMTS") || text.includes("WCDMA") || text.includes("3G")) return "3G";
  if (text.includes("GSM") || text.includes("2G")) return "2G";

  return "";
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

function buildPointHintKey(siteName, market) {
  return [
    cleanText(market).toLowerCase(),
    cleanText(siteName).toLowerCase(),
  ].join("|");
}

function getKnownHeadersFromSectors(sectors) {
  if (!sectors?.length) return [];

  return [
    "SYSTEM",
    "SITE",
    "LAT",
    "LON",
    "CELL_NAME",
    "CID",
    "DIR",
    "ANT_BW",
    "LAC",
    "MCC",
    "MNC",
    "EARFCN",
    "PCI",
  ];
}

function emptyResult({ fileName, market, technology, error, warnings = [] }) {
  return {
    ok: false,
    file: {
      file_name: fileName,
      market: cleanText(market) || null,
      technology: cleanText(technology) || null,
      record_count: 0,
    },
    delimiter: "kml",
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

function htmlToText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<\/th>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .trim();
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
}

function toNullableNumber(value) {
  const cleaned = cleanText(value).replace(/,/g, "");

  if (!cleaned) return null;

  const number = Number(cleaned);

  return Number.isFinite(number) ? number : null;
}

function uniqueClean(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}
