// src/components/maps/CellSectorLayer.jsx
//
// BabyDragon / NetField-360
// Reusable cell-site + sector overlay for Leaflet maps.
//
// Use inside any <MapContainer>:
// <CellSectorLayer market={marketName} showSites showSectors />

import { useEffect, useMemo, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { supabase } from "../../lib/supabaseClient";

const DEFAULT_MAX_RECORDS = 1500;
const DEFAULT_SECTOR_RADIUS_M = 550;

const TECH_STYLE = {
  LTE: {
    sectorColor: "#22c55e",
    siteColor: "#bbf7d0",
  },
  "5G": {
    sectorColor: "#38bdf8",
    siteColor: "#bae6fd",
  },
  "3G": {
    sectorColor: "#f59e0b",
    siteColor: "#fde68a",
  },
  "2G": {
    sectorColor: "#a78bfa",
    siteColor: "#ddd6fe",
  },
  DEFAULT: {
    sectorColor: "#f97316",
    siteColor: "#fed7aa",
  },
};

export default function CellSectorLayer({
  market = "",
  visible = true,
  showSites = true,
  showSectors = true,
  maxRecords = DEFAULT_MAX_RECORDS,
  sectorRadiusM = DEFAULT_SECTOR_RADIUS_M,
}) {
  const map = useMap();
  const [sectors, setSectors] = useState([]);

  const cleanMarket = useMemo(() => {
    const value = String(market || "").trim();
    if (!value || value.toLowerCase() === "all") return "";
    if (value.toLowerCase() === "unknown market") return "";
    return value;
  }, [market]);

  useEffect(() => {
    if (!visible) {
      setSectors([]);
      return;
    }

    let cancelled = false;

    async function loadSectors() {
      let query = supabase
        .from("cell_sectors")
        .select(
          "id, market, system, technology, site_name, cell_name, cid, lat, lon, azimuth, antenna_bw, earfcn, pci, created_at"
        )
        .not("lat", "is", null)
        .not("lon", "is", null)
        .order("created_at", { ascending: false })
        .limit(Number(maxRecords) || DEFAULT_MAX_RECORDS);

      if (cleanMarket) {
        query = query.eq("market", cleanMarket);
      }

      const { data, error } = await query;

      if (cancelled) return;

      if (error) {
        console.error("CellSectorLayer load error:", error);
        setSectors([]);
        return;
      }

      setSectors(Array.isArray(data) ? data : []);
    }

    loadSectors();

    return () => {
      cancelled = true;
    };
  }, [visible, cleanMarket, maxRecords]);

  useEffect(() => {
    if (!visible || !map) return undefined;
    if (!showSites && !showSectors) return undefined;
    if (!sectors.length) return undefined;

    const layerGroup = L.layerGroup().addTo(map);

    if (showSectors) {
      sectors.forEach((sector) => {
        const lat = Number(sector.lat);
        const lon = Number(sector.lon);

        if (!isValidLatLon(lat, lon)) return;

        const technology = normalizeTechnology(sector.technology || sector.system);
        const style = getTechnologyStyle(technology);
        const azimuth = toFiniteNumber(sector.azimuth);
        const antennaBw = toFiniteNumber(sector.antenna_bw) || 65;

        if (azimuth === null) {
          L.circleMarker([lat, lon], {
            radius: 5,
            color: style.sectorColor,
            weight: 2,
            fillColor: style.sectorColor,
            fillOpacity: 0.65,
            opacity: 0.95,
          })
            .bindPopup(buildPopupHtml(sector, "Cell / Sector"))
            .addTo(layerGroup);
          return;
        }

        const wedgeCoords = buildSectorWedge({
          lat,
          lon,
          azimuth,
          beamWidth: antennaBw,
          radiusM: Number(sectorRadiusM) || DEFAULT_SECTOR_RADIUS_M,
        });

        L.polygon(wedgeCoords, {
          color: style.sectorColor,
          weight: 2,
          fillColor: style.sectorColor,
          fillOpacity: 0.18,
          opacity: 0.95,
        })
          .bindPopup(buildPopupHtml(sector, "Sector Beam"))
          .addTo(layerGroup);
      });
    }

    if (showSites) {
      const siteRecords = groupSectorsToSites(sectors);

      siteRecords.forEach((site) => {
        const technology = normalizeTechnology(site.technology || site.system);
        const style = getTechnologyStyle(technology);

        L.circleMarker([site.lat, site.lon], {
          radius: 6,
          color: "#ffffff",
          weight: 2,
          fillColor: style.siteColor,
          fillOpacity: 0.95,
          opacity: 0.95,
        })
          .bindPopup(buildSitePopupHtml(site))
          .addTo(layerGroup);
      });
    }

    try {
      layerGroup.bringToFront();
    } catch {
      // Some Leaflet layer groups may not support bringToFront in every state.
    }

    return () => {
      map.removeLayer(layerGroup);
    };
  }, [map, visible, showSites, showSectors, sectors, sectorRadiusM]);

  return null;
}

function groupSectorsToSites(sectors) {
  const grouped = new Map();

  sectors.forEach((sector) => {
    const lat = Number(sector.lat);
    const lon = Number(sector.lon);

    if (!isValidLatLon(lat, lon)) return;

    const key = [
      String(sector.market || "").trim().toLowerCase(),
      String(sector.site_name || "Unknown Site").trim().toLowerCase(),
      lat.toFixed(6),
      lon.toFixed(6),
    ].join("|");

    const existing = grouped.get(key);

    if (existing) {
      existing.sector_count += 1;
      if (sector.technology && !existing.technology) {
        existing.technology = sector.technology;
      }
      return;
    }

    grouped.set(key, {
      market: sector.market || "",
      site_name: sector.site_name || "Unknown Site",
      technology: sector.technology || sector.system || "",
      system: sector.system || "",
      lat,
      lon,
      sector_count: 1,
    });
  });

  return Array.from(grouped.values());
}

function buildSectorWedge({ lat, lon, azimuth, beamWidth, radiusM }) {
  const safeBeamWidth = Math.max(5, Math.min(Number(beamWidth) || 65, 180));
  const startBearing = Number(azimuth) - safeBeamWidth / 2;
  const endBearing = Number(azimuth) + safeBeamWidth / 2;
  const steps = 14;

  const coords = [[lat, lon]];

  for (let i = 0; i <= steps; i += 1) {
    const bearing = startBearing + ((endBearing - startBearing) * i) / steps;
    coords.push(destinationPoint(lat, lon, bearing, radiusM));
  }

  coords.push([lat, lon]);
  return coords;
}

function destinationPoint(lat, lon, bearingDeg, distanceM) {
  const radiusEarthM = 6371000;
  const angularDistance = distanceM / radiusEarthM;
  const bearing = toRad(normalizeBearing(bearingDeg));
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );

  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );

  return [toDeg(lat2), normalizeLongitude(toDeg(lon2))];
}

function buildPopupHtml(sector, title) {
  return `
    <div style="min-width:190px;font-family:Arial,sans-serif;">
      <strong>${escapeHtml(title)}</strong><br/>
      <b>Site:</b> ${escapeHtml(sector.site_name || "N/A")}<br/>
      <b>Cell:</b> ${escapeHtml(sector.cell_name || "N/A")}<br/>
      <b>Market:</b> ${escapeHtml(sector.market || "N/A")}<br/>
      <b>Tech:</b> ${escapeHtml(sector.technology || sector.system || "N/A")}<br/>
      <b>PCI:</b> ${escapeHtml(sector.pci || "N/A")}<br/>
      <b>EARFCN:</b> ${escapeHtml(sector.earfcn || "N/A")}<br/>
      <b>CID:</b> ${escapeHtml(sector.cid || "N/A")}<br/>
      <b>Azimuth:</b> ${escapeHtml(formatNumber(sector.azimuth))}<br/>
      <b>BW:</b> ${escapeHtml(formatNumber(sector.antenna_bw))}
    </div>
  `;
}

function buildSitePopupHtml(site) {
  return `
    <div style="min-width:170px;font-family:Arial,sans-serif;">
      <strong>${escapeHtml(site.site_name || "Site")}</strong><br/>
      <b>Market:</b> ${escapeHtml(site.market || "N/A")}<br/>
      <b>Tech:</b> ${escapeHtml(site.technology || site.system || "N/A")}<br/>
      <b>Sectors:</b> ${escapeHtml(site.sector_count || 0)}<br/>
      <b>Lat/Lon:</b> ${escapeHtml(site.lat?.toFixed?.(6) || site.lat)}, ${escapeHtml(
        site.lon?.toFixed?.(6) || site.lon
      )}
    </div>
  `;
}

function getTechnologyStyle(technology) {
  return TECH_STYLE[technology] || TECH_STYLE.DEFAULT;
}

function normalizeTechnology(value) {
  const text = String(value || "").trim().toUpperCase();

  if (text.includes("NR") || text.includes("5G")) return "5G";
  if (text.includes("LTE") || text.includes("4G")) return "LTE";
  if (text.includes("UMTS") || text.includes("WCDMA") || text.includes("3G")) return "3G";
  if (text.includes("GSM") || text.includes("2G")) return "2G";

  return text || "DEFAULT";
}

function isValidLatLon(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeBearing(value) {
  return ((Number(value) % 360) + 360) % 360;
}

function normalizeLongitude(value) {
  return ((((Number(value) + 180) % 360) + 360) % 360) - 180;
}

function toRad(value) {
  return (Number(value) * Math.PI) / 180;
}

function toDeg(value) {
  return (Number(value) * 180) / Math.PI;
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : "N/A";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
