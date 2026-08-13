/**
 * Canvas KPI route map PNGs for Excel Plot Report.
 * Real tile basemap (Esri/Carto/OSM) when network allows; styled fallback otherwise.
 * Session GPS + KPI only — no static sample images.
 */

import {
  RSRP_BINS,
  RSRQ_BINS,
  SINR_BINS,
  RSCP_BINS,
  ECNO_BINS,
  RXLEV_BINS,
  THP_DL_BINS,
  THP_UL_BINS,
  BER_BINS,
  GPS_ACCURACY_BINS,
  SERIES_COLORS,
  colorForValue,
  countBinsForValues,
  buildCategoryColorMap,
  styleForEventType,
  normalizeEventStyleKey,
} from "./excelMapPlotBins.js";
import {
  computeRouteDistanceFromGpsPoints,
} from "../utils/gpsDistanceUtils.js";
import { segmentRoutePoints } from "./excelRouteSegmentation.js";

export {
  RSRP_BINS,
  RSRQ_BINS,
  SINR_BINS,
  RSCP_BINS,
  ECNO_BINS,
  RXLEV_BINS,
  THP_DL_BINS,
  THP_UL_BINS,
  BER_BINS,
  GPS_ACCURACY_BINS,
  colorForValue,
  countBinsForValues,
  buildCategoryColorMap,
};

/** Always-shown event taxonomy in legend when events are enabled. */
const LEGEND_EVENT_TYPES = [
  "SERVING_CELL_CHANGE",
  "PCI_CHANGE",
  "CHANNEL_CHANGE",
  "RAT_CHANGE",
  "NR_SECONDARY",
];

/** Deterministic pixel fan-out for overlapping event markers (display-only). */
const EVENT_FAN_OFFSETS = [
  { dx: 16, dy: -16 },
  { dx: -16, dy: -16 },
  { dx: 16, dy: 16 },
  { dx: -16, dy: 16 },
  { dx: 0, dy: -20 },
  { dx: 0, dy: 20 },
  { dx: 22, dy: 0 },
  { dx: -22, dy: 0 },
  { dx: 12, dy: -22 },
  { dx: -12, dy: 22 },
];

/** Minimum geographic padding (~120 m) so short/single-point routes do not collapse. */
const MIN_BOUND_PAD_DEG_LAT = 120 / 111320;
const MIN_BOUND_PAD_DEG_LNG_AT_EQUATOR = 120 / 111320;

const TILE_TEMPLATES = [
  {
    key: "esri",
    label: "Esri",
    attribution: "Esri World Street Map",
    url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`,
  },
  {
    key: "carto",
    label: "Carto",
    attribution: "© CARTO, © OpenStreetMap contributors",
    url: (z, x, y) => `https://basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`,
  },
  {
    key: "osm",
    label: "OpenStreetMap",
    attribution: "© OpenStreetMap contributors",
    url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  },
];

const PROVIDER_DISPLAY = {
  esri: "Esri",
  carto: "Carto",
  osm: "OpenStreetMap",
  fallback: "Coordinate-only fallback",
};

function getNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

const PLACEHOLDER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FABJADveWkH6aAAAAAElFTkSuQmCC";

function createCanvas(width, height) {
  if (typeof document !== "undefined" && document.createElement) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  return null;
}

async function canvasToPngBase64(canvas) {
  if (!canvas) return PLACEHOLDER_PNG_BASE64;
  try {
    if (typeof canvas.toDataURL === "function") {
      const dataUrl = canvas.toDataURL("image/png");
      const parts = String(dataUrl).split(",");
      return parts[1] || PLACEHOLDER_PNG_BASE64;
    }
    if (typeof canvas.convertToBlob === "function") {
      const blob = await canvas.convertToBlob({ type: "image/png" });
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    }
  } catch {
    // Tainted canvas (cross-origin tiles) — caller should redraw without tiles
    return null;
  }
  return PLACEHOLDER_PNG_BASE64;
}

function lon2tile(lon, zoom) {
  return ((lon + 180) / 360) * (2 ** zoom);
}

function lat2tile(lat, zoom) {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * (2 ** zoom);
}

function tile2lon(x, zoom) {
  return (x / (2 ** zoom)) * 360 - 180;
}

function tile2lat(y, zoom) {
  const n = Math.PI - (2 * Math.PI * y) / (2 ** zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function computeBounds(points, padFrac = 0.15) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs);
  let maxLng = Math.max(...lngs);
  const midLat = (minLat + maxLat) / 2;
  const cosLat = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const minLatPad = MIN_BOUND_PAD_DEG_LAT;
  const minLngPad = MIN_BOUND_PAD_DEG_LNG_AT_EQUATOR / cosLat;

  let latSpan = Math.max(maxLat - minLat, minLatPad * 2);
  let lngSpan = Math.max(maxLng - minLng, minLngPad * 2);
  // Ensure span after fractional pad still has meaningful geographic size
  const latPad = Math.max(latSpan * padFrac, minLatPad);
  const lngPad = Math.max(lngSpan * padFrac, minLngPad);
  minLat -= latPad;
  maxLat += latPad;
  minLng -= lngPad;
  maxLng += lngPad;
  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Projected route aspect using equirectangular cos(midLat) correction (same as buildProjection).
 */
export function computeProjectedRouteAspect(points = []) {
  const valid = (points || []).filter((p) => {
    const lat = getNumber(p.lat);
    const lng = getNumber(p.lng);
    return lat !== null && lng !== null && !(lat === 0 && lng === 0);
  }).map((p) => ({ lat: getNumber(p.lat), lng: getNumber(p.lng) }));

  if (valid.length === 0) {
    return {
      aspectRatio: 1,
      orientation: "landscape",
      stationary: true,
      midLat: 0,
      projectedWidth: 1,
      projectedHeight: 1,
      latSpan: 0,
      lngSpan: 0,
      routeExtentMeters: 0,
      pointCount: 0,
    };
  }

  const lats = valid.map((p) => p.lat);
  const lngs = valid.map((p) => p.lng);
  const rawMinLat = Math.min(...lats);
  const rawMaxLat = Math.max(...lats);
  const rawMinLng = Math.min(...lngs);
  const rawMaxLng = Math.max(...lngs);
  const rawLatSpan = rawMaxLat - rawMinLat;
  const rawLngSpan = rawMaxLng - rawMinLng;
  const midLat = (rawMinLat + rawMaxLat) / 2;
  const cosLat = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const minLatPad = MIN_BOUND_PAD_DEG_LAT;
  const minLngPad = MIN_BOUND_PAD_DEG_LNG_AT_EQUATOR / cosLat;

  const latSpan = Math.max(rawLatSpan, minLatPad * 2);
  const lngSpan = Math.max(rawLngSpan, minLngPad * 2);
  const projectedWidth = lngSpan * cosLat;
  const projectedHeight = latSpan;
  const aspectRatio = projectedHeight > 0 ? projectedWidth / projectedHeight : 1;

  let orientation = "balanced";
  if (aspectRatio >= 1.35) orientation = "landscape";
  else if (aspectRatio <= 0.74) orientation = "portrait";

  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * cosLat;
  const latExtentM = rawLatSpan * metersPerDegLat;
  const lngExtentM = rawLngSpan * metersPerDegLng;
  const routeExtentMeters = Math.sqrt(latExtentM * latExtentM + lngExtentM * lngExtentM);

  const nearMinPad = rawLatSpan <= minLatPad * 1.05 && rawLngSpan <= minLngPad * 1.05;
  const stationary = valid.length <= 1 || nearMinPad || routeExtentMeters < 40;

  return {
    aspectRatio,
    orientation,
    stationary,
    midLat,
    projectedWidth,
    projectedHeight,
    latSpan,
    lngSpan,
    routeExtentMeters,
    pointCount: valid.length,
  };
}

export function canvasSizeForOrientation(orientation) {
  if (orientation === "portrait") return { width: 1500, height: 2400 };
  if (orientation === "balanced") return { width: 2000, height: 1800 };
  return { width: 2400, height: 1400 };
}

function chooseZoom(bounds, mapW, mapH) {
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  for (let z = 18; z >= 3; z -= 1) {
    const x0 = lon2tile(bounds.minLng, z);
    const x1 = lon2tile(bounds.maxLng, z);
    const y0 = lat2tile(bounds.maxLat, z);
    const y1 = lat2tile(bounds.minLat, z);
    const tilesX = Math.abs(x1 - x0);
    const tilesY = Math.abs(y1 - y0);
    const pxW = tilesX * 256;
    const pxH = tilesY * 256;
    if (pxW <= mapW * 1.35 && pxH <= mapH * 1.35) return z;
  }
  return 12;
}

function buildProjection(bounds, mapLeft, mapTop, mapW, mapH) {
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const cosLat = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const spanY = bounds.maxLat - bounds.minLat;
  const spanX = bounds.maxLng - bounds.minLng;
  const geoAspect = (spanX * cosLat) / spanY;
  let drawW = mapW;
  let drawH = mapH;
  let offsetX = 0;
  let offsetY = 0;
  const boxAspect = mapW / mapH;
  if (geoAspect > boxAspect) {
    drawH = mapW / geoAspect;
    offsetY = (mapH - drawH) / 2;
  } else {
    drawW = mapH * geoAspect;
    offsetX = (mapW - drawW) / 2;
  }
  return {
    bounds,
    mapLeft,
    mapTop,
    mapW,
    mapH,
    drawW,
    drawH,
    offsetX,
    offsetY,
    project(lat, lng) {
      return {
        x: mapLeft + offsetX + ((lng - bounds.minLng) / spanX) * drawW,
        y: mapTop + offsetY + (1 - (lat - bounds.minLat) / spanY) * drawH,
      };
    },
  };
}

function loadImageFromUrl(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (img) => {
      if (settled) return;
      settled = true;
      resolve(img);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    const tryImageTag = () => {
      if (typeof Image === "undefined") {
        clearTimeout(timer);
        finish(null);
        return;
      }
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        clearTimeout(timer);
        finish(img);
      };
      img.onerror = () => {
        clearTimeout(timer);
        finish(null);
      };
      img.src = url;
    };

    if (typeof fetch === "function") {
      fetch(url, { mode: "cors", cache: "force-cache" })
        .then((res) => (res.ok ? res.blob() : Promise.reject(new Error("tile http"))))
        .then(async (blob) => {
          if (typeof createImageBitmap === "function") {
            const bmp = await createImageBitmap(blob);
            clearTimeout(timer);
            finish(bmp);
            return;
          }
          const objUrl = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            clearTimeout(timer);
            URL.revokeObjectURL(objUrl);
            finish(img);
          };
          img.onerror = () => {
            URL.revokeObjectURL(objUrl);
            tryImageTag();
          };
          img.src = objUrl;
        })
        .catch(() => tryImageTag());
    } else {
      tryImageTag();
    }
  });
}

/**
 * Composite real map tiles into an offscreen canvas for the route bbox.
 * Returns { canvas, source, zoom, attempts, attribution } or null with attempts.
 */
export async function fetchRealBasemapCanvas(bounds, pixelW, pixelH) {
  const attempts = [];
  if (!bounds || (typeof document === "undefined" && typeof OffscreenCanvas === "undefined")) {
    return { canvas: null, source: "fallback", attempts, attribution: null, failureNote: "Canvas unavailable for tile composite" };
  }
  const zoom = chooseZoom(bounds, pixelW, pixelH);
  const x0f = lon2tile(bounds.minLng, zoom);
  const x1f = lon2tile(bounds.maxLng, zoom);
  const y0f = lat2tile(bounds.maxLat, zoom);
  const y1f = lat2tile(bounds.minLat, zoom);
  const tx0 = Math.floor(Math.min(x0f, x1f));
  const tx1 = Math.floor(Math.max(x0f, x1f));
  const ty0 = Math.floor(Math.min(y0f, y1f));
  const ty1 = Math.floor(Math.max(y0f, y1f));
  const maxTiles = 48;
  const tilesX = tx1 - tx0 + 1;
  const tilesY = ty1 - ty0 + 1;
  if (tilesX * tilesY > maxTiles || tilesX < 1 || tilesY < 1) {
    return {
      canvas: null,
      source: "fallback",
      attempts,
      attribution: null,
      failureNote: `Tile window too large (${tilesX}x${tilesY}); using coordinate-only fallback`,
    };
  }

  const worldLeft = tile2lon(tx0, zoom);
  const worldRight = tile2lon(tx1 + 1, zoom);
  const worldTop = tile2lat(ty0, zoom);
  const worldBottom = tile2lat(ty1 + 1, zoom);

  for (const provider of TILE_TEMPLATES) {
    const jobs = [];
    for (let x = tx0; x <= tx1; x += 1) {
      for (let y = ty0; y <= ty1; y += 1) {
        const maxIndex = 2 ** zoom;
        if (x < 0 || y < 0 || x >= maxIndex || y >= maxIndex) continue;
        jobs.push({ x, y, url: provider.url(zoom, x, y) });
      }
    }
    const loaded = await Promise.all(jobs.map(async (job) => ({
      ...job,
      img: await loadImageFromUrl(job.url, 7000),
    })));
    const ok = loaded.filter((t) => t.img);
    const needed = Math.max(1, Math.ceil(jobs.length * 0.45));
    if (ok.length < needed) {
      attempts.push({
        provider: provider.key,
        label: provider.label,
        attempted: true,
        succeeded: false,
        note: `Fetched ${ok.length}/${jobs.length} tiles (need ≥${needed})`,
      });
      continue;
    }

    const tileCanvas = createCanvas(tilesX * 256, tilesY * 256);
    if (!tileCanvas) {
      attempts.push({
        provider: provider.key,
        label: provider.label,
        attempted: true,
        succeeded: false,
        note: "Tile canvas create failed",
      });
      continue;
    }
    const tctx = tileCanvas.getContext("2d");
    tctx.fillStyle = "#e2e8f0";
    tctx.fillRect(0, 0, tilesX * 256, tilesY * 256);
    ok.forEach((tile) => {
      const dx = (tile.x - tx0) * 256;
      const dy = (tile.y - ty0) * 256;
      try {
        tctx.drawImage(tile.img, dx, dy, 256, 256);
      } catch {
        // skip bad tile draw
      }
    });

    const out = createCanvas(Math.round(pixelW), Math.round(pixelH));
    if (!out) {
      attempts.push({
        provider: provider.key,
        label: provider.label,
        attempted: true,
        succeeded: true,
        note: `Used mosaic without crop (${ok.length} tiles)`,
      });
      return {
        canvas: tileCanvas,
        source: provider.key,
        zoom,
        tileCount: ok.length,
        attempts: [
          ...attempts,
          { provider: provider.key, label: provider.label, attempted: true, succeeded: true, note: `${ok.length} tiles` },
        ],
        attribution: provider.attribution,
        failureNote: null,
      };
    }
    const octx = out.getContext("2d");
    const srcX = ((bounds.minLng - worldLeft) / (worldRight - worldLeft)) * tilesX * 256;
    const srcY = ((worldTop - bounds.maxLat) / (worldTop - worldBottom)) * tilesY * 256;
    const srcW = ((bounds.maxLng - bounds.minLng) / (worldRight - worldLeft)) * tilesX * 256;
    const srcH = ((bounds.maxLat - bounds.minLat) / (worldTop - worldBottom)) * tilesY * 256;
    try {
      octx.drawImage(tileCanvas, srcX, srcY, Math.max(1, srcW), Math.max(1, srcH), 0, 0, pixelW, pixelH);
    } catch {
      attempts.push({
        provider: provider.key,
        label: provider.label,
        attempted: true,
        succeeded: false,
        note: "Crop/drawImage failed",
      });
      continue;
    }
    attempts.push({
      provider: provider.key,
      label: provider.label,
      attempted: true,
      succeeded: true,
      note: `${ok.length} tiles at z${zoom}`,
    });
    return {
      canvas: out,
      source: provider.key,
      zoom,
      tileCount: ok.length,
      attempts,
      attribution: provider.attribution,
      failureNote: null,
    };
  }

  return {
    canvas: null,
    source: "fallback",
    attempts,
    attribution: null,
    failureNote: "All tile providers failed or returned insufficient tiles; using coordinate-only fallback",
  };
}

/** Clean geographic fallback — no fake streets/terrain/place labels. */
function drawCoordinateFallback(ctx, x, y, w, h, bounds) {
  // Distinct cool canvas (not beige) so fallback is obviously rendered
  ctx.fillStyle = "#eef2f7";
  ctx.fillRect(x, y, w, h);

  // Outer border
  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

  // Axis frame inset
  const pad = 36;
  const ax = x + pad;
  const ay = y + pad;
  const aw = w - pad * 2;
  const ah = h - pad * 2;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(ax, ay, aw, ah);
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(ax, ay, aw, ah);

  // Grid
  ctx.strokeStyle = "rgba(71, 85, 105, 0.28)";
  ctx.lineWidth = 1;
  const gridN = 5;
  for (let i = 1; i < gridN; i += 1) {
    const gx = ax + (aw * i) / gridN;
    const gy = ay + (ah * i) / gridN;
    ctx.beginPath();
    ctx.moveTo(gx, ay);
    ctx.lineTo(gx, ay + ah);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ax, gy);
    ctx.lineTo(ax + aw, gy);
    ctx.stroke();
  }

  // Axis titles (x = longitude, y = latitude)
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 11px Segoe UI, Arial, sans-serif";
  ctx.fillText("Longitude →", ax + 4, ay - 10);
  ctx.save();
  ctx.translate(x + 14, ay + ah / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Latitude →", 0, 0);
  ctx.restore();

  if (bounds) {
    ctx.font = "10px Segoe UI, Arial, sans-serif";
    ctx.fillStyle = "#1e293b";
    const latMin = bounds.minLat.toFixed(5);
    const latMax = bounds.maxLat.toFixed(5);
    const lngMin = bounds.minLng.toFixed(5);
    const lngMax = bounds.maxLng.toFixed(5);
    ctx.fillText(latMax, ax + 4, ay + 12);
    ctx.fillText(latMin, ax + 4, ay + ah - 6);
    ctx.fillText(lngMin, ax + 4, ay + ah + 14);
    const lngMaxLabel = lngMax;
    ctx.fillText(lngMaxLabel, ax + aw - ctx.measureText(lngMaxLabel).width - 4, ay + ah + 14);

    // North indicator
    const nx = ax + aw - 22;
    const ny = ay + 22;
    ctx.strokeStyle = "#0f172a";
    ctx.fillStyle = "#0f172a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(nx, ny + 12);
    ctx.lineTo(nx, ny - 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(nx, ny - 10);
    ctx.lineTo(nx - 5, ny - 2);
    ctx.lineTo(nx + 5, ny - 2);
    ctx.closePath();
    ctx.fill();
    ctx.font = "bold 11px Segoe UI, Arial, sans-serif";
    ctx.fillText("N", nx - 4, ny - 14);

    // Scale bar
    const midLat = (bounds.minLat + bounds.maxLat) / 2;
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
    const spanM = Math.max(
      (bounds.maxLat - bounds.minLat) * metersPerDegLat,
      (bounds.maxLng - bounds.minLng) * metersPerDegLng,
    );
    let scaleM = 50;
    if (spanM > 5000) scaleM = 1000;
    else if (spanM > 2000) scaleM = 500;
    else if (spanM > 800) scaleM = 200;
    else if (spanM > 300) scaleM = 100;
    const pxPerM = aw / Math.max(spanM, 1);
    const scalePx = Math.min(aw * 0.28, Math.max(40, scaleM * pxPerM));
    const sx = ax + 10;
    const sy = ay + ah - 14;
    ctx.strokeStyle = "#0f172a";
    ctx.fillStyle = "#0f172a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + scalePx, sy);
    ctx.moveTo(sx, sy - 4);
    ctx.lineTo(sx, sy + 4);
    ctx.moveTo(sx + scalePx, sy - 4);
    ctx.lineTo(sx + scalePx, sy + 4);
    ctx.stroke();
    const scaleLabel = scaleM >= 1000 ? `${(scaleM / 1000).toFixed(1)} km` : `${scaleM} m`;
    ctx.font = "10px Segoe UI, Arial, sans-serif";
    ctx.fillText(scaleLabel, sx, sy - 8);
  } else {
    ctx.fillStyle = "#64748b";
    ctx.font = "12px Segoe UI, Arial, sans-serif";
    ctx.fillText("No GPS bounds available for this plot", ax + 12, ay + ah / 2);
  }

  // Honest fallback banner (high contrast)
  ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
  ctx.fillRect(x + 8, y + 8, Math.min(w - 16, 460), 40);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 12px Segoe UI, Arial, sans-serif";
  ctx.fillText("Online map tiles unavailable", x + 16, y + 24);
  ctx.font = "11px Segoe UI, Arial, sans-serif";
  ctx.fillText("Coordinate-only fallback — real GPS bounds (no invented roads)", x + 16, y + 40);

  return { plotLeft: ax, plotTop: ay, plotW: aw, plotH: ah };
}

function assignEventDisplayOffsets(events, projectFn) {
  const groups = new Map();
  (events || []).forEach((evt, index) => {
    const lat = getNumber(evt.lat);
    const lng = getNumber(evt.lng);
    if (lat === null || lng === null) return;
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ evt, index, lat, lng });
  });

  const placed = [];
  groups.forEach((members) => {
    members.forEach((member, fanIndex) => {
      const anchor = projectFn(member.lat, member.lng);
      const fan = EVENT_FAN_OFFSETS[fanIndex % EVENT_FAN_OFFSETS.length];
      // Always apply at least a small base offset so events do not sit on data points
      const base = EVENT_FAN_OFFSETS[0];
      const dx = members.length === 1 ? base.dx : fan.dx;
      const dy = members.length === 1 ? base.dy : fan.dy;
      placed.push({
        evt: member.evt,
        eventType: member.evt.eventType || "DEFAULT",
        anchorX: anchor.x,
        anchorY: anchor.y,
        displayX: anchor.x + dx,
        displayY: anchor.y + dy,
        displayOffsetX: dx,
        displayOffsetY: dy,
      });
    });
  });
  return placed;
}

function drawLeaderLine(ctx, ax, ay, dx, dy) {
  ctx.strokeStyle = "rgba(30, 41, 59, 0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(dx, dy);
  ctx.stroke();
  // tiny anchor dot
  ctx.fillStyle = "rgba(30, 41, 59, 0.7)";
  ctx.beginPath();
  ctx.arc(ax, ay, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

export function formatBasemapAttemptSummary(attempts = [], source = "fallback", failureNote = null) {
  const lines = (attempts || []).map((a) => {
    if (!a.attempted) return `${a.label}: not attempted`;
    return a.succeeded ? `${a.label} succeeded (${a.note || "ok"})` : `${a.label} failed (${a.note || "no tiles"})`;
  });
  const providerLabel = PROVIDER_DISPLAY[source] || source;
  return {
    map_background_provider: providerLabel,
    map_provider_attempts: lines.join("; ") || "No providers attempted",
    map_tile_failure_note: failureNote || (source === "fallback" ? "Coordinate-only fallback used" : null),
    map_attribution: source === "fallback"
      ? "No tile attribution (coordinate-only fallback)"
      : (TILE_TEMPLATES.find((t) => t.key === source)?.attribution || providerLabel),
  };
}

function drawEventMarkerShape(ctx, x, y, eventType, size) {
  const style = styleForEventType(eventType);
  ctx.fillStyle = style.color;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(1, size * 0.15);

  if (style.shape === "triangle") {
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size * 0.9, y + size * 0.7);
    ctx.lineTo(x - size * 0.9, y + size * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (style.shape === "square") {
    ctx.fillRect(x - size * 0.7, y - size * 0.7, size * 1.4, size * 1.4);
    ctx.strokeRect(x - size * 0.7, y - size * 0.7, size * 1.4, size * 1.4);
  } else if (style.shape === "ring") {
    ctx.beginPath();
    ctx.arc(x, y, size * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = Math.max(1.5, size * 0.2);
    ctx.beginPath();
    ctx.arc(x, y, size + 2, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawEventMarker(ctx, x, y, eventType, badge = null, scale = 1) {
  const style = styleForEventType(eventType);
  const size = 9 * scale;
  const badgeText = badge != null && String(badge).trim() !== "" ? String(badge).trim().slice(0, 8) : null;

  ctx.fillStyle = SERIES_COLORS.eventHalo;
  if (badgeText) {
    const fontSize = Math.max(8, Math.round(10 * scale));
    ctx.font = `bold ${fontSize}px Segoe UI, Arial, sans-serif`;
    const textW = ctx.measureText(badgeText).width;
    const padX = 6 * scale;
    const padY = 3 * scale;
    const pillW = textW + padX * 2;
    const pillH = fontSize + padY * 2;
    const px = x - pillW / 2;
    const py = y - pillH / 2;
    const radius = pillH / 2;

    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(px - 3, py - 3, pillW + 6, pillH + 6, radius + 3);
    } else {
      ctx.rect(px - 3, py - 3, pillW + 6, pillH + 6);
    }
    ctx.fill();

    ctx.fillStyle = style.color;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(px, py, pillW, pillH, radius);
    } else {
      ctx.rect(px, py, pillW, pillH);
    }
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.fillText(badgeText, px + padX, py + padY + fontSize * 0.85);

    drawEventMarkerShape(ctx, x, y + pillH / 2 + size * 0.85, eventType, size * 0.55);
    return;
  }

  ctx.beginPath();
  ctx.arc(x, y, size + 3, 0, Math.PI * 2);
  ctx.fill();
  drawEventMarkerShape(ctx, x, y, eventType, size);
}

function drawLegend(ctx, legendX, legendY, legendW, bins, categoryItems, unitLabel, eventTypesUsed = [], showEvents = false, scale = 1) {
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  const binRows = bins?.length || categoryItems?.length || 0;
  const eventList = showEvents
    ? (() => {
      const list = [];
      (eventTypesUsed || []).forEach((t) => {
        if (t && !list.includes(t)) list.push(t);
      });
      if (!list.length) {
        LEGEND_EVENT_TYPES.forEach((t) => list.push(t));
      }
      return list;
    })()
    : [];
  const rowStep = Math.round(22 * scale);
  const legendH = Math.round(44 * scale) + Math.max(binRows, 1) * rowStep + (eventList.length ? (eventList.length + 1) * Math.round(18 * scale) : 0) + Math.round(32 * scale);
  const boxH = Math.min(legendH, Math.round(620 * scale));
  ctx.fillRect(legendX, legendY, legendW, boxH);
  ctx.strokeRect(legendX, legendY, legendW, boxH);

  ctx.fillStyle = "#0f172a";
  ctx.font = `bold ${Math.round(13 * scale)}px Segoe UI, Arial, sans-serif`;
  ctx.fillText("Legend", legendX + 12 * scale, legendY + 22 * scale);
  if (unitLabel) {
    ctx.font = `${Math.round(11 * scale)}px Segoe UI, Arial, sans-serif`;
    ctx.fillStyle = "#475569";
    ctx.fillText(unitLabel, legendX + 12 * scale, legendY + 38 * scale);
  }

  let y = legendY + 54 * scale;
  const swatch = Math.round(16 * scale);
  const labelFont = `${Math.round(9.5 * scale)}px Segoe UI, Arial, sans-serif`;
  if (bins && bins.length) {
    bins.forEach((bin) => {
      ctx.fillStyle = bin.color;
      ctx.fillRect(legendX + 12 * scale, y - swatch * 0.65, swatch, Math.round(12 * scale));
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = Math.max(1, scale * 0.8);
      ctx.strokeRect(legendX + 12 * scale, y - swatch * 0.65, swatch, Math.round(12 * scale));
      ctx.fillStyle = "#1e293b";
      ctx.font = labelFont;
      const text = bin.legendLabel || bin.label;
      ctx.fillText(text, legendX + 34 * scale, y);
      y += rowStep;
    });
  } else if (categoryItems && categoryItems.length) {
    categoryItems.slice(0, 10).forEach((item) => {
      ctx.fillStyle = item.color;
      ctx.fillRect(legendX + 12 * scale, y - swatch * 0.65, swatch, Math.round(12 * scale));
      ctx.strokeStyle = "#64748b";
      ctx.strokeRect(legendX + 12 * scale, y - swatch * 0.65, swatch, Math.round(12 * scale));
      ctx.fillStyle = "#1e293b";
      ctx.font = labelFont;
      const text = item.legendLabel || item.label;
      ctx.fillText(text, legendX + 34 * scale, y);
      y += rowStep;
    });
    if (categoryItems.length > 10) {
      ctx.fillStyle = "#64748b";
      ctx.fillText(`+${categoryItems.length - 10} more`, legendX + 34 * scale, y);
      y += Math.round(18 * scale);
    }
  }

  if (showEvents && eventList.length) {
    y += 6 * scale;
    ctx.fillStyle = "#0f172a";
    ctx.font = `bold ${Math.round(11 * scale)}px Segoe UI, Arial, sans-serif`;
    ctx.fillText("Events", legendX + 12 * scale, y);
    y += Math.round(16 * scale);
    eventList.forEach((type) => {
      if (y > legendY + boxH - 40 * scale) return;
      const style = styleForEventType(type);
      drawEventMarker(ctx, legendX + 20 * scale, y - 4 * scale, type, null, scale);
      ctx.fillStyle = "#1e293b";
      ctx.font = labelFont;
      ctx.fillText(style.label, legendX + 34 * scale, y);
      y += Math.round(18 * scale);
    });
  }

  y += 4 * scale;
  const dotR = 4 * scale;
  ctx.fillStyle = SERIES_COLORS.start;
  ctx.beginPath();
  ctx.arc(legendX + 18 * scale, y - 4 * scale, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1e293b";
  ctx.font = labelFont;
  ctx.fillText("Start", legendX + 28 * scale, y);
  ctx.fillStyle = SERIES_COLORS.end;
  ctx.beginPath();
  ctx.arc(legendX + 78 * scale, y - 4 * scale, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1e293b";
  ctx.fillText("End", legendX + 88 * scale, y);
}

/**
 * Prepare a shared basemap for a set of GPS points (call once per workbook export).
 */
export async function prepareSharedBasemap(points = [], mapPixelW = 1900, mapPixelH = 1100) {
  const valid = (points || []).filter((p) => {
    const lat = getNumber(p.lat);
    const lng = getNumber(p.lng);
    return lat !== null && lng !== null && !(lat === 0 && lng === 0);
  }).map((p) => ({ lat: getNumber(p.lat), lng: getNumber(p.lng) }));

  if (valid.length < 1) {
    return {
      bounds: null,
      basemap: null,
      source: "fallback",
      attempts: [],
      meta: formatBasemapAttemptSummary([], "fallback", "No GPS points for basemap"),
    };
  }
  const bounds = computeBounds(valid, 0.18);
  try {
    const result = await fetchRealBasemapCanvas(bounds, mapPixelW, mapPixelH);
    const source = result?.canvas ? result.source : "fallback";
    const meta = formatBasemapAttemptSummary(
      result?.attempts || [],
      source,
      result?.failureNote || null,
    );
    if (result?.canvas) {
      return {
        bounds,
        basemap: result,
        source,
        attempts: result.attempts,
        attribution: result.attribution,
        meta,
      };
    }
    return {
      bounds,
      basemap: null,
      source: "fallback",
      attempts: result?.attempts || [],
      attribution: null,
      meta,
    };
  } catch (error) {
    return {
      bounds,
      basemap: null,
      source: "fallback",
      attempts: [],
      meta: formatBasemapAttemptSummary([], "fallback", error?.message || "Basemap fetch threw"),
    };
  }
}

function formatSegmentTimeRange(segmentPoints = []) {
  const elapsed = segmentPoints
    .map((p) => getNumber(p.elapsed_sec ?? p.elapsedSec))
    .filter((v) => v !== null);
  if (elapsed.length >= 2) {
    const min = Math.min(...elapsed);
    const max = Math.max(...elapsed);
    return `${min.toFixed(0)}–${max.toFixed(0)} s`;
  }
  const ts = segmentPoints
    .map((p) => getNumber(p.timestampMs ?? p.timestamp_ms))
    .filter((v) => v !== null);
  if (ts.length >= 2) {
    const min = Math.min(...ts);
    const max = Math.max(...ts);
    const fmt = (ms) => {
      try { return new Date(ms).toISOString().slice(11, 19); } catch { return String(ms); }
    };
    return `${fmt(min)}–${fmt(max)}`;
  }
  return null;
}

/**
 * Display-only detail map segments for extreme routes.
 * Trigger ONLY when projected aspectRatio > 4.0 OR (route extent > 25000 m AND point count > 200).
 * Splits the route into up to maxDetails equal-index segments; caller keeps the overview spec.
 */
export function maybeBuildDetailMapSpecs(baseSpec = {}, points = [], maxDetails = 4) {
  const valid = (Array.isArray(points) ? points : []).filter((p) => {
    const lat = getNumber(p.lat);
    const lng = getNumber(p.lng);
    return lat !== null && lng !== null && !(lat === 0 && lng === 0);
  });
  if (valid.length < 2 || !baseSpec || typeof baseSpec !== "object") return [];

  const aspect = computeProjectedRouteAspect(valid);
  const shouldSplit = aspect.aspectRatio > 4.0
    || (aspect.routeExtentMeters > 25000 && valid.length > 200);
  if (!shouldSplit) return [];

  const segmentCount = Math.min(maxDetails, valid.length);
  const chunkSize = Math.ceil(valid.length / segmentCount);
  const baseTitle = String(baseSpec.title || "Route detail");
  const specs = [];

  for (let i = 0; i < segmentCount; i += 1) {
    const startIdx = i * chunkSize;
    const endIdx = Math.min(valid.length, startIdx + chunkSize);
    if (startIdx >= endIdx) continue;
    const segmentPoints = valid.slice(startIdx, endIdx);
    const segDist = computeRouteDistanceFromGpsPoints(segmentPoints);
    const distLabel = segDist.distance_covered_km >= 1
      ? `${segDist.distance_covered_km.toFixed(2)} km`
      : `${Math.round(segDist.distance_covered_m || 0)} m`;
    const timeLabel = formatSegmentTimeRange(segmentPoints);
    const rangeBits = [distLabel, timeLabel].filter(Boolean).join(" · ");
    specs.push({
      ...baseSpec,
      title: `${baseTitle} — segment ${i + 1}/${segmentCount}${rangeBits ? ` (${rangeBits})` : ""}`,
      subtitle: baseSpec.subtitle || "Detail segment (display-only zoom)",
      points: segmentPoints,
      isDetailSegment: true,
      detailSegmentIndex: i + 1,
      detailSegmentCount: segmentCount,
    });
  }
  return specs;
}

/**
 * Render one KPI-over-route map plot as PNG base64 (no data-URL prefix).
 */
export async function renderRouteKpiMapPng(spec = {}) {
  const normalizeMapPoints = (list = []) => (Array.isArray(list) ? list : []).filter((p) => {
    const lat = getNumber(p.lat);
    const lng = getNumber(p.lng);
    return lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
  }).map((p, index) => ({
    ...p,
    lat: getNumber(p.lat),
    lng: getNumber(p.lng),
    sampleIndex: getNumber(p.sampleIndex ?? p.sample_index) ?? index,
    timestampMs: getNumber(p.timestampMs ?? p.timestamp_ms ?? p.location_fix_timestamp_ms ?? p.timestamp),
    accuracyM: getNumber(p.accuracyM ?? p.gps_accuracy_m ?? p.accuracy),
    gpsStatus: p.gpsStatus ?? p.gps_status ?? null,
    gpsProvider: p.gpsProvider ?? p.gps_provider ?? p.provider ?? null,
  }));

  const pointsIn = normalizeMapPoints(spec.points);
  const contextTrail = normalizeMapPoints(spec.contextTrail || []);
  const resultMarkers = normalizeMapPoints(spec.resultMarkers || []);
  const failMarkers = normalizeMapPoints(spec.failMarkers || []);
  const connectMode = String(spec.connectMode || "segments"); // segments | markers_only | none
  const boundsPoints = pointsIn.length
    ? pointsIn
    : (contextTrail.length ? contextTrail : [...resultMarkers, ...failMarkers]);

  const routeAspect = computeProjectedRouteAspect(boundsPoints);
  const orientation = spec.orientation || routeAspect.orientation;
  const stationary = spec.stationary != null ? spec.stationary === true : routeAspect.stationary;
  const defaultCanvas = canvasSizeForOrientation(orientation);
  const explicitW = getNumber(spec.width);
  const explicitH = getNumber(spec.height);
  const width = explicitW != null
    ? Math.max(640, Math.min(2600, explicitW))
    : defaultCanvas.width;
  const height = explicitH != null
    ? Math.max(420, Math.min(2600, explicitH))
    : defaultCanvas.height;
  const scale = width / 1000;

  const title = String(spec.title || "KPI Over Route");
  let subtitle = String(spec.subtitle || "");
  const defaultSubtitle = "BabyDragon / MobbiTech Global LLC — route trail colored by KPI";
  if (!subtitle) subtitle = defaultSubtitle;
  if (stationary && !subtitle.includes("Stationary")) {
    subtitle = `${subtitle}  |  Stationary / limited route spread`;
  }

  const canvas = createCanvas(width, height);
  if (!canvas) {
    return {
      base64: PLACEHOLDER_PNG_BASE64,
      width: 10,
      height: 10,
      orientation,
      stationary,
      title,
      note: "Canvas unavailable — placeholder PNG used",
      pointCount: pointsIn.length,
    };
  }

  const ctx = canvas.getContext("2d");
  const headerH = Math.round(58 * scale);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#0b3d5c";
  ctx.fillRect(0, 0, width, headerH);
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.round(18 * scale)}px Segoe UI, Arial, sans-serif`;
  ctx.fillText(title, 18 * scale, 28 * scale);
  ctx.font = `${Math.round(12 * scale)}px Segoe UI, Arial, sans-serif`;
  ctx.fillStyle = "#cbd5e1";
  ctx.fillText(subtitle, 18 * scale, 48 * scale);

  const legendW = Math.round(268 * scale);
  const mapLeft = Math.round(18 * scale);
  const mapTop = headerH + Math.round(14 * scale);
  const mapRightPad = legendW + Math.round(28 * scale);
  const mapBottom = Math.round(30 * scale);
  const mapW = width - mapLeft - mapRightPad;
  const mapH = height - mapTop - mapBottom;

  const shared = spec.sharedBasemap || null;
  // Prefer plot-local bounds (with min padding) so short routes do not collapse
  const localBounds = boundsPoints.length ? computeBounds(boundsPoints, 0.18) : null;
  const bounds = localBounds || shared?.bounds || null;
  let basemapMeta = shared?.basemap || null;
  let basemapSource = shared?.source || "fallback";
  let basemapAttempts = shared?.attempts || [];
  let basemapAttribution = shared?.attribution || null;
  let failureNote = shared?.meta?.map_tile_failure_note || null;
  let usedTiles = false;
  // Fallback inset plot rect (axes/banner reserved); overwritten if tiles succeed
  let plotRect = drawCoordinateFallback(ctx, mapLeft, mapTop, mapW, mapH, bounds);

  if (!basemapMeta?.canvas && boundsPoints.length >= 1 && bounds) {
    try {
      const fetched = await fetchRealBasemapCanvas(bounds, mapW, mapH);
      basemapAttempts = fetched?.attempts || basemapAttempts;
      if (fetched?.canvas) {
        basemapMeta = fetched;
        basemapSource = fetched.source;
        basemapAttribution = fetched.attribution;
        failureNote = null;
      } else {
        basemapSource = "fallback";
        failureNote = fetched?.failureNote || "Online map tiles unavailable";
      }
    } catch (error) {
      basemapMeta = null;
      basemapSource = "fallback";
      failureNote = error?.message || "Basemap fetch failed";
    }
  }

  if (basemapMeta?.canvas) {
    try {
      ctx.drawImage(basemapMeta.canvas, mapLeft, mapTop, mapW, mapH);
      ctx.fillStyle = "rgba(15, 23, 42, 0.05)";
      ctx.fillRect(mapLeft, mapTop, mapW, mapH);
      usedTiles = true;
      plotRect = { plotLeft: mapLeft, plotTop: mapTop, plotW: mapW, plotH: mapH };
      ctx.fillStyle = "rgba(255,255,255,0.82)";
      ctx.fillRect(mapLeft + 6, mapTop + mapH - 22, Math.min(mapW - 12, 340), 16);
      ctx.fillStyle = "#334155";
      ctx.font = "9px Segoe UI, Arial, sans-serif";
      ctx.fillText(basemapAttribution || PROVIDER_DISPLAY[basemapSource] || basemapSource, mapLeft + 10, mapTop + mapH - 10);
    } catch {
      plotRect = drawCoordinateFallback(ctx, mapLeft, mapTop, mapW, mapH, bounds);
      basemapSource = "fallback";
      failureNote = "Tile image draw failed; coordinate-only fallback";
      usedTiles = false;
    }
  } else {
    basemapSource = "fallback";
    if (!failureNote) failureNote = "Online map tiles unavailable";
  }
  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 2;
  ctx.strokeRect(mapLeft + 0.5, mapTop + 0.5, mapW - 1, mapH - 1);

  const mode = spec.mode === "category" ? "category" : "bins";
  const binsRaw = Array.isArray(spec.bins) ? spec.bins : [];
  // Legend + marker color must share the same finite numeric value set.
  const legendValueSource = Array.isArray(spec.legendValues) && spec.legendValues.length
    ? spec.legendValues
    : (resultMarkers.length
      ? resultMarkers.map((p) => p.value)
      : pointsIn.map((p) => p.value));
  const bins = mode === "bins" && binsRaw.length
    ? countBinsForValues(legendValueSource, binsRaw)
    : binsRaw;
  let categoryMap = new Map();
  let categoryItems = [];

  if (mode === "category") {
    const catSource = Array.isArray(spec.legendValues) && spec.legendValues.length
      ? spec.legendValues
      : (resultMarkers.length ? resultMarkers.map((p) => p.value) : pointsIn.map((p) => p.value));
    const built = buildCategoryColorMap(catSource);
    categoryMap = built.map;
    const totalCat = built.unique.reduce((sum, key) => {
      const n = catSource.filter((v) => String(v) === key).length;
      return sum + n;
    }, 0);
    categoryItems = built.unique.map((key) => {
      const count = catSource.filter((v) => String(v) === key).length;
      const pct = totalCat > 0 ? Number(((count / totalCat) * 100).toFixed(1)) : 0;
      return {
        label: `${spec.categoryLabel || "ID"} ${key}`,
        color: categoryMap.get(key),
        count,
        percent: pct,
        legendLabel: `${spec.categoryLabel || "ID"} ${key} — ${count} (${pct.toFixed(1)}%)`,
      };
    });
  }

  // RF/Data maps are KPI-only by default. Event overlays live on 13_Event_Plots.
  const showEvents = spec.showEvents === true;
  const events = showEvents && Array.isArray(spec.eventMarkers) ? spec.eventMarkers : [];
  const eventTypesUsed = [];
  events.forEach((evt) => {
    const type = normalizeEventStyleKey(evt.eventType || "DEFAULT");
    if (!eventTypesUsed.includes(type)) eventTypesUsed.push(type);
  });

  const resolvePointColor = (p) => {
    const val = getNumber(p?.value);
    if (mode === "category") {
      const key = p?.value === null || p?.value === undefined || p?.value === "" ? null : String(p.value);
      return key ? (categoryMap.get(key) || "#64748b") : "#64748b";
    }
    if (val !== null) return colorForValue(val, bins);
    return SERIES_COLORS.neutralRoute || "#64748b";
  };

  const drawSegmentPolylines = (projectedSegments, { colored = true, lineWidth = 7.5, halo = true } = {}) => {
    projectedSegments.forEach((segment) => {
      if (segment.length < 2) return;
      if (halo) {
        ctx.strokeStyle = "rgba(15, 23, 42, 0.45)";
        ctx.lineWidth = (lineWidth + 3.5) * scale;
        ctx.beginPath();
        segment.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
      }
      for (let i = 1; i < segment.length; i += 1) {
        const a = segment[i - 1];
        const b = segment[i];
        const coloredPoint = getNumber(b.value) !== null ? b : a;
        ctx.strokeStyle = colored ? resolvePointColor(coloredPoint) : (SERIES_COLORS.neutralRoute || "#64748b");
        ctx.lineWidth = lineWidth * scale;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    });
  };

  const drawDots = (projected, { size = 5.2, labeled = false } = {}) => {
    projected.forEach((p) => {
      const color = resolvePointColor(p);
      ctx.fillStyle = color;
      ctx.beginPath();
      let dotR = size * scale;
      if (projected.length === 1 || stationary) dotR = Math.max(dotR, 9.5 * scale);
      else if (projected.length < 8) dotR = Math.max(dotR, 7 * scale);
      ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = Math.max(1.4, 1.35 * scale);
      ctx.stroke();
      ctx.strokeStyle = "rgba(15, 23, 42, 0.35)";
      ctx.lineWidth = Math.max(0.8, 0.7 * scale);
      ctx.stroke();
      if (labeled && (p.label != null || p.iteration != null)) {
        const text = String(p.label ?? p.iteration);
        ctx.fillStyle = "#0f172a";
        ctx.font = `bold ${Math.round(9 * scale)}px Segoe UI, Arial, sans-serif`;
        ctx.fillText(text, p.x + 6 * scale, p.y - 6 * scale);
      }
    });
  };

  let routeSegmentMeta = {
    sourceGpsPointCount: pointsIn.length || contextTrail.length,
    validPlottedPointCount: 0,
    renderedSegmentCount: 0,
    rejectedConnectionCount: 0,
    rejectionReasonCounts: {},
  };

  const drawRouteLayer = () => {
    const hasAnything = pointsIn.length || contextTrail.length || resultMarkers.length || failMarkers.length;
    if (!hasAnything) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
      ctx.fillRect(mapLeft + 20 * scale, mapTop + mapH / 2 - 24 * scale, mapW - 40 * scale, 48 * scale);
      ctx.fillStyle = "#334155";
      ctx.font = `${Math.round(14 * scale)}px Segoe UI, Arial, sans-serif`;
      ctx.fillText(spec.emptyNote || "No GPS points with this KPI in this session", mapLeft + 32 * scale, mapTop + mapH / 2);
      return;
    }

    const projBounds = bounds || computeBounds(boundsPoints, 0.18);
    const proj = buildProjection(
      projBounds,
      plotRect.plotLeft,
      plotRect.plotTop,
      plotRect.plotW,
      plotRect.plotH,
    );

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Shared route segmentation for RF / Data / Event maps (single implementation).
    let trailSeg = null;
    let primarySeg = null;

    // Neutral context trail (driven route without inventing KPI coloring).
    if (contextTrail.length) {
      trailSeg = segmentRoutePoints(contextTrail);
      routeSegmentMeta = trailSeg.meta;
      const projectedTrailSegs = trailSeg.segments.map((seg) => seg.map((p) => ({ ...p, ...proj.project(p.lat, p.lng) })));
      drawSegmentPolylines(projectedTrailSegs, { colored: false, lineWidth: 3.2, halo: false });
    }

    // Primary KPI / event-route points — segment so filtered gaps never create false chords.
    let projectedPoints = [];
    if (pointsIn.length && connectMode !== "none") {
      primarySeg = segmentRoutePoints(pointsIn);
      if (!contextTrail.length) routeSegmentMeta = primarySeg.meta;
      else {
        routeSegmentMeta = {
          ...routeSegmentMeta,
          rejectedConnectionCount: (routeSegmentMeta.rejectedConnectionCount || 0) + primarySeg.meta.rejectedConnectionCount,
          rejectionReasonCounts: {
            ...routeSegmentMeta.rejectionReasonCounts,
            ...Object.fromEntries(
              Object.entries(primarySeg.meta.rejectionReasonCounts || {}).map(([k, v]) => [
                k,
                (routeSegmentMeta.rejectionReasonCounts?.[k] || 0) + v,
              ]),
            ),
          },
          validPlottedPointCount: Math.max(routeSegmentMeta.validPlottedPointCount, primarySeg.meta.validPlottedPointCount),
          renderedSegmentCount: Math.max(routeSegmentMeta.renderedSegmentCount, primarySeg.meta.renderedSegmentCount),
        };
      }
      const projectedSegs = primarySeg.segments.map((seg) => seg.map((p) => ({ ...p, ...proj.project(p.lat, p.lng) })));
      projectedPoints = projectedSegs.flat();
      if (connectMode === "segments") {
        drawSegmentPolylines(projectedSegs, { colored: true, lineWidth: 7.5, halo: true });
      }
      drawDots(projectedPoints, { size: resultMarkers.length ? 4.2 : 5.2 });
    } else if (pointsIn.length) {
      projectedPoints = pointsIn.map((p) => ({ ...p, ...proj.project(p.lat, p.lng) }));
      drawDots(projectedPoints);
      routeSegmentMeta = {
        sourceGpsPointCount: pointsIn.length,
        validPlottedPointCount: projectedPoints.length,
        renderedSegmentCount: 0,
        rejectedConnectionCount: 0,
        rejectionReasonCounts: {},
      };
    }

    if (resultMarkers.length) {
      const projectedResults = resultMarkers.map((p) => ({ ...p, ...proj.project(p.lat, p.lng) }));
      drawDots(projectedResults, { size: 7.2, labeled: true });
    }

    if (failMarkers.length) {
      failMarkers.forEach((p) => {
        const { x, y } = proj.project(p.lat, p.lng);
        ctx.fillStyle = "#dc2626";
        ctx.beginPath();
        ctx.moveTo(x, y - 8 * scale);
        ctx.lineTo(x + 7 * scale, y + 6 * scale);
        ctx.lineTo(x - 7 * scale, y + 6 * scale);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.4 * scale;
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${Math.round(7 * scale)}px Segoe UI, Arial, sans-serif`;
        ctx.fillText("F", x - 2.2 * scale, y + 3 * scale);
        if (p.label != null || p.iteration != null) {
          ctx.fillStyle = "#7f1d1d";
          ctx.font = `bold ${Math.round(9 * scale)}px Segoe UI, Arial, sans-serif`;
          ctx.fillText(String(p.label ?? `FAIL ${p.iteration}`), x + 8 * scale, y - 6 * scale);
        }
      });
    }

    if (showEvents && events.length) {
      const placedEvents = assignEventDisplayOffsets(events, (lat, lng) => proj.project(lat, lng));
      placedEvents.forEach((item) => {
        drawLeaderLine(ctx, item.anchorX, item.anchorY, item.displayX, item.displayY);
        const badge = item.evt?.badge ?? null;
        drawEventMarker(ctx, item.displayX, item.displayY, item.eventType, badge, scale);
      });
    }

    const startEndSource = trailSeg
      ? trailSeg.segments.flat()
      : (primarySeg
        ? primarySeg.segments.flat()
        : (projectedPoints.length ? pointsIn : [...resultMarkers, ...failMarkers]));
    const startEndProjected = startEndSource.map((p) => ({ ...p, ...proj.project(p.lat, p.lng) }));
    if (!startEndProjected.length) return;

    let start = startEndProjected[0];
    let end = startEndProjected[startEndProjected.length - 1];
    const samePixel = Math.abs(start.x - end.x) < 1 && Math.abs(start.y - end.y) < 1;
    const sepPx = stationary || samePixel ? 16 * scale : 0;
    if (samePixel || stationary) {
      start = { ...start, x: start.x - sepPx, y: start.y - sepPx };
      end = { ...end, x: end.x + sepPx, y: end.y + sepPx };
      drawLeaderLine(ctx, startEndProjected[0].x, startEndProjected[0].y, start.x, start.y);
      drawLeaderLine(
        ctx,
        startEndProjected[startEndProjected.length - 1].x,
        startEndProjected[startEndProjected.length - 1].y,
        end.x,
        end.y,
      );
    }

    const markerR = 6 * scale;
    ctx.fillStyle = SERIES_COLORS.start;
    ctx.beginPath();
    ctx.arc(start.x, start.y, markerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.8 * scale;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(8 * scale)}px Segoe UI, Arial, sans-serif`;
    ctx.fillText("S", start.x - 2.5 * scale, start.y + 2.5 * scale);

    ctx.fillStyle = SERIES_COLORS.end;
    ctx.beginPath();
    ctx.arc(end.x, end.y, markerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.8 * scale;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillText("E", end.x - 2.5 * scale, end.y + 2.5 * scale);
  };

  drawRouteLayer();

  drawLegend(
    ctx,
    width - legendW - Math.round(14 * scale),
    mapTop,
    legendW,
    mode === "bins" ? bins : null,
    mode === "category" ? categoryItems : null,
    spec.unitLabel || "",
    eventTypesUsed,
    showEvents,
    scale,
  );

  const providerLabel = PROVIDER_DISPLAY[basemapSource] || basemapSource;
  const basemapNote = basemapSource === "fallback"
    ? `Map background: Coordinate-only fallback${failureNote ? ` — ${failureNote}` : ""}`
    : `Map background: ${providerLabel}${basemapAttribution ? ` | ${basemapAttribution}` : ""}`;
  const metaNote = `src ${routeSegmentMeta.sourceGpsPointCount || boundsPoints.length} · plotted ${routeSegmentMeta.validPlottedPointCount || boundsPoints.length} · segs ${routeSegmentMeta.renderedSegmentCount || 0} · rejected ${routeSegmentMeta.rejectedConnectionCount || 0}`;
  ctx.fillStyle = "#64748b";
  ctx.font = `${Math.round(10 * scale)}px Segoe UI, Arial, sans-serif`;
  ctx.fillText(
    `GPS: ${metaNote}  |  BabyDragon Excel Plot  |  ${basemapNote}`,
    18 * scale,
    height - 10 * scale,
  );

  let base64 = await canvasToPngBase64(canvas);
  if (!base64 && usedTiles) {
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#0b3d5c";
    ctx.fillRect(0, 0, width, headerH);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(18 * scale)}px Segoe UI, Arial, sans-serif`;
    ctx.fillText(title, 18 * scale, 28 * scale);
    ctx.font = `${Math.round(12 * scale)}px Segoe UI, Arial, sans-serif`;
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(subtitle, 18 * scale, 48 * scale);
    plotRect = drawCoordinateFallback(ctx, mapLeft, mapTop, mapW, mapH, bounds);
    basemapSource = "fallback";
    failureNote = "Tile basemap tainted export canvas; coordinate-only fallback used";
    usedTiles = false;
    drawRouteLayer();
    drawLegend(
      ctx,
      width - legendW - Math.round(14 * scale),
      mapTop,
      legendW,
      mode === "bins" ? bins : null,
      mode === "category" ? categoryItems : null,
      spec.unitLabel || "",
      eventTypesUsed,
      showEvents,
      scale,
    );
    ctx.fillStyle = "#64748b";
    ctx.font = `${Math.round(10 * scale)}px Segoe UI, Arial, sans-serif`;
    ctx.fillText(
      `GPS: ${metaNote}  |  BabyDragon Excel Plot  |  Map background: Coordinate-only fallback — ${failureNote}`,
      18 * scale,
      height - 10 * scale,
    );
    base64 = await canvasToPngBase64(canvas);
  }

  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // ignore canvas cleanup failures
  }

  return {
    base64: base64 || PLACEHOLDER_PNG_BASE64,
    width,
    height,
    orientation,
    stationary,
    title,
    subtitle,
    pointCount: pointsIn.length || resultMarkers.length || contextTrail.length,
    routeMeta: routeSegmentMeta,
    basemapSource,
    basemapProviderLabel: PROVIDER_DISPLAY[basemapSource] || basemapSource,
    basemapAttempts,
    basemapAttribution: basemapSource === "fallback" ? null : basemapAttribution,
    failureNote,
    note: spec.note || (stationary ? "Stationary / limited route spread" : null),
  };
}

export async function renderTechAbsentNotePng(spec = {}) {
  const width = 900;
  const height = 120;
  const title = String(spec.title || "Technology note");
  const message = String(spec.message || "No samples in this session");
  const canvas = createCanvas(width, height);
  if (!canvas) {
    return { base64: PLACEHOLDER_PNG_BASE64, width: 10, height: 10, title, pointCount: 0 };
  }
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#94a3b8";
  ctx.strokeRect(1, 1, width - 2, height - 2);
  ctx.fillStyle = "#0b3d5c";
  ctx.font = "bold 16px Segoe UI, Arial, sans-serif";
  ctx.fillText(title, 20, 40);
  ctx.fillStyle = "#334155";
  ctx.font = "13px Segoe UI, Arial, sans-serif";
  ctx.fillText(message, 20, 70);
  const base64 = await canvasToPngBase64(canvas);
  return { base64, width, height, title, pointCount: 0, note: message };
}
