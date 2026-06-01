// src/components/maps/CellSectorLayer.jsx

import { useEffect, useMemo, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { supabase } from "../../lib/supabaseClient";

const DEFAULT_MAX_RECORDS = 2500;
const DEFAULT_SECTOR_RADIUS_M = 550;

const TECH_CONFIG = {
  "2G": {
    label: "2G",
    sectorColor: "#f59e0b",
    siteColor: "#fbbf24",
    radiusM: 900,
    fillOpacity: 0.15,
    weight: 2,
    order: 1,
    pane: "cellSector2gPane",
    zIndex: 410,
    legendText: "2G - Largest fan",
  },
  "3G": {
    label: "3G",
    sectorColor: "#8b5cf6",
    siteColor: "#c4b5fd",
    radiusM: 760,
    fillOpacity: 0.17,
    weight: 2,
    order: 2,
    pane: "cellSector3gPane",
    zIndex: 420,
    legendText: "3G - Larger fan",
  },
  LTE: {
    label: "LTE",
    sectorColor: "#22c55e",
    siteColor: "#86efac",
    radiusM: 620,
    fillOpacity: 0.2,
    weight: 2,
    order: 3,
    pane: "cellSectorLtePane",
    zIndex: 430,
    legendText: "LTE - Medium fan",
  },
  "5G": {
    label: "5G / NR",
    sectorColor: "#ef4444",
    siteColor: "#fca5a5",
    radiusM: 430,
    fillOpacity: 0.24,
    weight: 2,
    order: 4,
    pane: "cellSector5gPane",
    zIndex: 440,
    legendText: "5G / NR - Smallest fan, top layer",
  },
  DEFAULT: {
    label: "Unknown",
    sectorColor: "#38bdf8",
    siteColor: "#bae6fd",
    radiusM: DEFAULT_SECTOR_RADIUS_M,
    fillOpacity: 0.18,
    weight: 2,
    order: 0,
    pane: "cellSectorDefaultPane",
    zIndex: 405,
    legendText: "Unknown",
  },
};

const SITE_PANE = "cellSiteTopPane";

export default function CellSectorLayer({
  market = "",
  technologyFilter = "all",
  visible = true,
  showSites = true,
  showSectors = true,
  showLegend = true,
  maxRecords = DEFAULT_MAX_RECORDS,
  sectorRadiusM = DEFAULT_SECTOR_RADIUS_M,
}) {
  const map = useMap();
  const [sectors, setSectors] = useState([]);

  const cleanMarket = useMemo(() => {
    const value = String(market || "").trim();

    if (!value) return "";
    if (value.toLowerCase() === "all") return "";
    if (value.toLowerCase() === "all markets") return "";
    if (value.toLowerCase() === "unknown market") return "";

    return value;
  }, [market]);

  const cleanTechnology = useMemo(() => {
    const value = String(technologyFilter || "").trim();

    if (!value) return "all";
    if (value.toLowerCase() === "all") return "all";
    if (value.toLowerCase() === "all technologies") return "all";

    return normalizeTechnology(value);
  }, [technologyFilter]);

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

      const rows = Array.isArray(data) ? data : [];

      const filteredRows = rows.filter((row) => {
        const tech = normalizeTechnology(row.technology || row.system);
        return cleanTechnology === "all" || tech === cleanTechnology;
      });

      setSectors(sortSectorsForStacking(filteredRows));
    }

    loadSectors();

    return () => {
      cancelled = true;
    };
  }, [visible, cleanMarket, cleanTechnology, maxRecords]);

  useEffect(() => {
    if (!visible || !map) return undefined;
    if (!showSites && !showSectors) return undefined;
    if (!sectors.length) return undefined;

    ensurePanes(map);

    const layerGroup = L.layerGroup().addTo(map);

    if (showSectors) {
      sectors.forEach((sector) => {
        const lat = Number(sector.lat);
        const lon = Number(sector.lon);

        if (!isValidLatLon(lat, lon)) return;

        const technology = normalizeTechnology(sector.technology || sector.system);
        const config = getTechnologyConfig(technology);

        const azimuth = toFiniteNumber(sector.azimuth);
        const antennaBw = toFiniteNumber(sector.antenna_bw) || 65;

        if (azimuth === null) {
          L.circleMarker([lat, lon], {
            pane: config.pane,
            radius: 6,
            color: config.sectorColor,
            weight: 2,
            fillColor: config.sectorColor,
            fillOpacity: 0.75,
            opacity: 0.95,
          })
            .bindPopup(buildSectorPopupHtml(sector, technology))
            .addTo(layerGroup);

          return;
        }

        const wedgeCoords = buildSectorWedge({
          lat,
          lon,
          azimuth,
          beamWidth: antennaBw,
          radiusM:
            config.radiusM ||
            Number(sectorRadiusM) ||
            DEFAULT_SECTOR_RADIUS_M,
        });

        L.polygon(wedgeCoords, {
          pane: config.pane,
          color: config.sectorColor,
          weight: config.weight,
          fillColor: config.sectorColor,
          fillOpacity: config.fillOpacity,
          opacity: 0.95,
        })
          .bindPopup(buildSectorPopupHtml(sector, technology))
          .addTo(layerGroup);
      });
    }

    if (showSites) {
      const siteRecords = groupSectorsToSites(sectors);

      siteRecords.forEach((site) => {
        const techList = site.technologies.join(", ");
        const primaryTech =
          site.technologies[site.technologies.length - 1] || "DEFAULT";
        const config = getTechnologyConfig(primaryTech);

        L.circleMarker([site.lat, site.lon], {
          pane: SITE_PANE,
          radius: 7,
          color: "#ffffff",
          weight: 2.5,
          fillColor: config.siteColor,
          fillOpacity: 1,
          opacity: 1,
        })
          .bindPopup(buildSitePopupHtml(site, techList))
          .addTo(layerGroup);
      });
    }

    return () => {
      map.removeLayer(layerGroup);
    };
  }, [map, visible, showSites, showSectors, sectors, sectorRadiusM]);

  useEffect(() => {
    if (!map || !visible || !showLegend) return undefined;

    const legend = L.control({ position: "bottomright" });

    legend.onAdd = () => {
      const div = L.DomUtil.create("div", "cell-sector-legend");

      div.innerHTML = `
        <div style="
          background: rgba(7, 17, 31, 0.92);
          color: #e5eefc;
          border: 1px solid rgba(148, 163, 184, 0.45);
          border-radius: 12px;
          padding: 10px 12px;
          min-width: 165px;
          box-shadow: 0 14px 30px rgba(0,0,0,0.35);
          font-family: Arial, sans-serif;
          font-size: 12px;
          line-height: 1.35;
        ">
          <div style="
            font-weight: 800;
            font-size: 13px;
            margin-bottom: 7px;
            color: #ffffff;
          ">
            Cell Layer
          </div>

          ${buildLegendRow(TECH_CONFIG["5G"].sectorColor, TECH_CONFIG["5G"].legendText)}
          ${buildLegendRow(TECH_CONFIG.LTE.sectorColor, TECH_CONFIG.LTE.legendText)}
          ${buildLegendRow(TECH_CONFIG["3G"].sectorColor, TECH_CONFIG["3G"].legendText)}
          ${buildLegendRow(TECH_CONFIG["2G"].sectorColor, TECH_CONFIG["2G"].legendText)}

          <div style="
            display: flex;
            align-items: center;
            gap: 7px;
            margin-top: 6px;
            padding-top: 6px;
            border-top: 1px solid rgba(148, 163, 184, 0.25);
          ">
            <span style="
              width: 11px;
              height: 11px;
              border-radius: 50%;
              background: #ffffff;
              border: 2px solid #0ea5e9;
              display: inline-block;
              box-sizing: border-box;
            "></span>
            <span>Cell site marker</span>
          </div>
        </div>
      `;

      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);

      return div;
    };

    legend.addTo(map);

    return () => {
      legend.remove();
    };
  }, [map, visible, showLegend]);

  return null;
}

function buildLegendRow(color, label) {
  return `
    <div style="
      display: flex;
      align-items: center;
      gap: 7px;
      margin-bottom: 5px;
      white-space: nowrap;
    ">
      <span style="
        width: 12px;
        height: 12px;
        border-radius: 3px;
        background: ${color};
        display: inline-block;
        box-shadow: 0 0 0 1px rgba(255,255,255,0.45) inset;
      "></span>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function ensurePanes(map) {
  Object.values(TECH_CONFIG).forEach((config) => {
    if (!map.getPane(config.pane)) {
      map.createPane(config.pane);
    }

    const pane = map.getPane(config.pane);

    if (pane) {
      pane.style.zIndex = String(config.zIndex);
      pane.style.pointerEvents = "auto";
    }
  });

  if (!map.getPane(SITE_PANE)) {
    map.createPane(SITE_PANE);
  }

  const sitePane = map.getPane(SITE_PANE);

  if (sitePane) {
    sitePane.style.zIndex = "470";
    sitePane.style.pointerEvents = "auto";
  }
}

function sortSectorsForStacking(rows) {
  return [...rows].sort((a, b) => {
    const techA = normalizeTechnology(a.technology || a.system);
    const techB = normalizeTechnology(b.technology || b.system);

    const orderA = getTechnologyConfig(techA).order;
    const orderB = getTechnologyConfig(techB).order;

    return orderA - orderB;
  });
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

    const tech = normalizeTechnology(sector.technology || sector.system);
    const existing = grouped.get(key);

    if (existing) {
      existing.sector_count += 1;

      if (!existing.technologies.includes(tech)) {
        existing.technologies.push(tech);
        existing.technologies.sort(
          (a, b) => getTechnologyConfig(a).order - getTechnologyConfig(b).order
        );
      }

      return;
    }

    grouped.set(key, {
      market: sector.market || "",
      site_name: sector.site_name || "Unknown Site",
      lat,
      lon,
      sector_count: 1,
      technologies: [tech],
    });
  });

  return Array.from(grouped.values());
}

function buildSectorWedge({ lat, lon, azimuth, beamWidth, radiusM }) {
  const safeBeamWidth = Math.max(5, Math.min(Number(beamWidth) || 65, 180));
  const startBearing = Number(azimuth) - safeBeamWidth / 2;
  const endBearing = Number(azimuth) + safeBeamWidth / 2;
  const steps = 18;

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

function buildSectorPopupHtml(sector, technology) {
  const config = getTechnologyConfig(technology);

  return `
    <div style="min-width:190px;font-family:Arial,sans-serif;">
      <strong>${escapeHtml(config.label)} Cell Sector</strong><br/>
      <b>Site:</b> ${escapeHtml(sector.site_name || "N/A")}<br/>
      <b>Cell:</b> ${escapeHtml(sector.cell_name || "N/A")}<br/>
      <b>Market:</b> ${escapeHtml(sector.market || "N/A")}<br/>
      <b>Tech:</b> ${escapeHtml(config.label)}<br/>
      <b>PCI:</b> ${escapeHtml(sector.pci || "N/A")}<br/>
      <b>EARFCN:</b> ${escapeHtml(sector.earfcn || "N/A")}<br/>
      <b>CID:</b> ${escapeHtml(sector.cid || "N/A")}<br/>
      <b>Azimuth:</b> ${escapeHtml(formatNumber(sector.azimuth))}<br/>
      <b>BW:</b> ${escapeHtml(formatNumber(sector.antenna_bw))}
    </div>
  `;
}

function buildSitePopupHtml(site, techList) {
  return `
    <div style="min-width:175px;font-family:Arial,sans-serif;">
      <strong>Cell Site</strong><br/>
      <b>Site:</b> ${escapeHtml(site.site_name || "N/A")}<br/>
      <b>Market:</b> ${escapeHtml(site.market || "N/A")}<br/>
      <b>Techs:</b> ${escapeHtml(techList || "N/A")}<br/>
      <b>Sectors:</b> ${escapeHtml(site.sector_count || 0)}<br/>
      <b>Lat/Lon:</b> ${escapeHtml(site.lat?.toFixed?.(6) || site.lat)}, ${escapeHtml(
        site.lon?.toFixed?.(6) || site.lon
      )}
    </div>
  `;
}

function getTechnologyConfig(technology) {
  return TECH_CONFIG[technology] || TECH_CONFIG.DEFAULT;
}

function normalizeTechnology(value) {
  const text = String(value || "").trim().toUpperCase();

  if (text.includes("NR") || text.includes("5G")) return "5G";
  if (text.includes("LTE") || text.includes("4G")) return "LTE";
  if (text.includes("UMTS") || text.includes("WCDMA") || text.includes("3G"))
    return "3G";
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