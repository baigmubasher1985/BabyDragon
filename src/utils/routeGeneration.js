// src/utils/routeGeneration.js

export const ROUTE_MODES = [
  {
    value: "dense",
    label: "Dense",
    description: "Use all driveable roads inside the selected grid.",
  },
  {
    value: "highway",
    label: "Highway",
    description: "Use highways and major roads only.",
  },
  {
    value: "main_streets",
    label: "Main Streets",
    description: "Use primary, secondary, tertiary, and unclassified streets.",
  },
  {
    value: "hybrid",
    label: "Hybrid",
    description: "Use main roads plus selected local roads.",
  },
  {
    value: "sector_coverage",
    label: "Sector Coverage",
    description:
      "Prioritize roads near imported cell sites/sectors inside or near the selected grid.",
  },
];

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

const MODE_ALLOWED_HIGHWAYS = {
  dense: new Set([
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "residential",
    "service",
    "living_street",
  ]),

  highway: new Set(["motorway", "trunk", "primary", "secondary"]),

  main_streets: new Set([
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
  ]),

  hybrid: new Set([
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "residential",
  ]),

  sector_coverage: new Set([
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "residential",
    "service",
    "living_street",
  ]),
};

const DENY_HIGHWAYS = new Set([
  "footway",
  "path",
  "cycleway",
  "pedestrian",
  "steps",
  "bridleway",
  "corridor",
  "construction",
  "proposed",
  "platform",
]);

const SECTOR_TECH_RADIUS_M = {
  "5G": 430,
  NR: 430,
  LTE: 620,
  "4G": 620,
  "3G": 760,
  UMTS: 760,
  WCDMA: 760,
  "2G": 900,
  GSM: 900,
  DEFAULT: 620,
};

const SECTOR_NEAR_GRID_PADDING_DEG = 0.006;
const SECTOR_ROAD_KEEP_DISTANCE_M = 850;
const SECTOR_MIN_KEEP_RATIO = 0.62;
const SECTOR_MAX_KEEP_RATIO = 0.82;

export function formatMeters(meters) {
  if (!Number.isFinite(meters)) return "0 mi";
  const miles = meters / 1609.344;
  if (miles < 1) return `${Math.round(meters)} m`;
  return `${miles.toFixed(2)} mi`;
}

export async function generateRouteForGrid({
  grid,
  mode = "dense",
  sectors = [],
  cellSectors = [],
} = {}) {
  if (!grid) {
    throw new Error("No grid selected.");
  }

  const gridGeometry = getGridGeometry(grid);
  const bbox = getBbox(gridGeometry);
  const center = getGeometryCenter(gridGeometry);

  const inputSectors = Array.isArray(sectors) && sectors.length ? sectors : cellSectors;
  const sectorTargets = getRelevantSectorTargets({
    sectors: inputSectors,
    gridGeometry,
    bbox,
  });

  const overpassWays = await fetchRoadWays(bbox);

  const features = [];

  for (const way of overpassWays) {
    const highway = getHighwayType(way);
    if (!isAllowedHighway(highway, mode)) continue;

    const coords = getWayCoords(way);
    if (coords.length < 2) continue;

    const segmentFeatures = createInsideRoadSegments({
      coords,
      way,
      highway,
      gridGeometry,
    });

    features.push(...segmentFeatures);
  }

  let finalFeatures = dedupeFeatures(features);
  let sectorCoverageInfo = {
    sectorAware: false,
    sectorCount: sectorTargets.length,
    targetPointCount: 0,
  };

  if (mode === "sector_coverage") {
    const result = applySectorCoverageV1({
      features: finalFeatures,
      center,
      sectorTargets,
    });

    finalFeatures = result.features;
    sectorCoverageInfo = result.info;
  }

  if (!finalFeatures.length) {
    throw new Error(
      "No driveable road lines were found inside this grid. Try Dense mode or check if this grid has mapped roads."
    );
  }

  const routeGeojson = {
    type: "FeatureCollection",
    properties: {
      mode,
      source: "overpass_v1",
      generated_at: new Date().toISOString(),
      sector_aware: sectorCoverageInfo.sectorAware,
      sector_count: sectorCoverageInfo.sectorCount,
      target_point_count: sectorCoverageInfo.targetPointCount,
    },
    features: finalFeatures,
  };

  const routeLengthM = getFeatureCollectionLength(routeGeojson);

  return {
    mode,
    geojson: routeGeojson,
    lengthM: routeLengthM,
    source: "overpass_v1",
    generatedAt: new Date().toISOString(),
    sectorAware: sectorCoverageInfo.sectorAware,
    sectorCount: sectorCoverageInfo.sectorCount,
    targetPointCount: sectorCoverageInfo.targetPointCount,
  };
}

function getGridGeometry(grid) {
  const candidates = [
    grid.route_boundary_geojson,
    grid.boundary_geojson,
    grid.boundary,
    grid.geometry,
    grid.geom,
    grid.geojson,
    grid.polygon,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;

    let parsed = candidate;

    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        continue;
      }
    }

    if (parsed.type === "Feature") {
      parsed = parsed.geometry;
    }

    if (parsed.type === "FeatureCollection") {
      const polygonFeature = parsed.features?.find((f) =>
        ["Polygon", "MultiPolygon"].includes(f?.geometry?.type)
      );

      if (polygonFeature?.geometry) {
        parsed = polygonFeature.geometry;
      }
    }

    if (parsed?.type === "Polygon" || parsed?.type === "MultiPolygon") {
      return parsed;
    }
  }

  throw new Error(
    "Grid polygon was not found. Expected geometry, geojson, boundary_geojson, or polygon field."
  );
}

function getBbox(geometry) {
  const points = getAllPoints(geometry);

  if (!points.length) {
    throw new Error("Selected grid has invalid polygon coordinates.");
  }

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of points) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  const padding = 0.001;

  return {
    south: minLat - padding,
    west: minLng - padding,
    north: maxLat + padding,
    east: maxLng + padding,
  };
}

function getAllPoints(geometry) {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.flat();
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flat(2);
  }

  return [];
}

function getGeometryCenter(geometry) {
  const points = getAllPoints(geometry);

  let lngSum = 0;
  let latSum = 0;

  for (const [lng, lat] of points) {
    lngSum += lng;
    latSum += lat;
  }

  return [lngSum / points.length, latSum / points.length];
}

async function fetchRoadWays(bbox) {
  const query = `
[out:json][timeout:35];
(
  way["highway"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
out tags geom;
`;

  let lastError = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: `data=${encodeURIComponent(query)}`,
      });

      if (!response.ok) {
        throw new Error(`Overpass request failed: ${response.status}`);
      }

      const data = await response.json();
      return Array.isArray(data.elements) ? data.elements : [];
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Unable to fetch road data from Overpass. ${lastError?.message || ""}`
  );
}

function getHighwayType(way) {
  const highway = way?.tags?.highway;

  if (Array.isArray(highway)) {
    return highway[0];
  }

  return highway;
}

function isAllowedHighway(highway, mode) {
  if (!highway) return false;
  if (DENY_HIGHWAYS.has(highway)) return false;

  const allowed = MODE_ALLOWED_HIGHWAYS[mode] || MODE_ALLOWED_HIGHWAYS.dense;
  return allowed.has(highway);
}

function getWayCoords(way) {
  if (!Array.isArray(way.geometry)) return [];

  return way.geometry
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map((p) => [p.lon, p.lat]);
}

function createInsideRoadSegments({ coords, way, highway, gridGeometry }) {
  const features = [];

  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1];
    const b = coords[i];

    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

    const includeSegment =
      isPointInsideGeometry(a, gridGeometry) ||
      isPointInsideGeometry(b, gridGeometry) ||
      isPointInsideGeometry(mid, gridGeometry);

    if (!includeSegment) continue;

    features.push({
      type: "Feature",
      properties: {
        way_id: way.id,
        name: way.tags?.name || "",
        highway,
      },
      geometry: {
        type: "LineString",
        coordinates: [a, b],
      },
    });
  }

  return features;
}

function getRelevantSectorTargets({ sectors, gridGeometry, bbox }) {
  if (!Array.isArray(sectors) || !sectors.length) return [];

  return sectors
    .map(normalizeSectorRecord)
    .filter(Boolean)
    .filter((sector) => {
      const point = [sector.lon, sector.lat];

      return (
        isPointInsideGeometry(point, gridGeometry) ||
        isPointInsideExpandedBbox(point, bbox, SECTOR_NEAR_GRID_PADDING_DEG)
      );
    });
}

function normalizeSectorRecord(sector) {
  const lat = toFiniteNumber(
    sector?.lat ?? sector?.latitude ?? sector?.LAT ?? sector?.Latitude
  );

  const lon = toFiniteNumber(
    sector?.lon ??
      sector?.lng ??
      sector?.long ??
      sector?.longitude ??
      sector?.LON ??
      sector?.LONG ??
      sector?.Longitude
  );

  if (!isValidLatLon(lat, lon)) return null;

  const technology = normalizeTechnology(sector?.technology || sector?.system || sector?.SYSTEM);
  const radiusM = getSectorRadiusM(technology);

  const azimuth = toFiniteNumber(
    sector?.azimuth ?? sector?.dir ?? sector?.DIR ?? sector?.AZIMUTH
  );

  const antennaBw =
    toFiniteNumber(
      sector?.antenna_bw ??
        sector?.ant_bw ??
        sector?.ANT_BW ??
        sector?.beamwidth ??
        sector?.BW
    ) || 65;

  return {
    id: sector?.id || sector?.cell_name || sector?.CELL_NAME || null,
    siteName: sector?.site_name || sector?.SITE || sector?.site || "",
    cellName: sector?.cell_name || sector?.CELL_NAME || sector?.cell || "",
    technology,
    lat,
    lon,
    point: [lon, lat],
    azimuth,
    antennaBw,
    radiusM,
  };
}

function applySectorCoverageV1({ features, center, sectorTargets }) {
  if (!features.length) {
    return {
      features: [],
      info: {
        sectorAware: false,
        sectorCount: sectorTargets.length,
        targetPointCount: 0,
      },
    };
  }

  if (!sectorTargets.length) {
    return {
      features: applyCenterCoverageFallback(features, center),
      info: {
        sectorAware: false,
        sectorCount: 0,
        targetPointCount: 0,
      },
    };
  }

  const targetPoints = buildSectorTargetPoints(sectorTargets);

  const scored = features.map((feature) => {
    const midpoint = getSegmentMidpoint(feature.geometry.coordinates);
    const nearestTarget = getNearestTargetDistance(midpoint, targetPoints);
    const nearestSector = getNearestSectorDistance(midpoint, sectorTargets);
    const beamBonus = getBeamBonus(midpoint, sectorTargets);
    const roadBonus = getRoadPriorityBonus(feature.properties?.highway);

    const score = nearestTarget.distance - beamBonus - roadBonus;

    return {
      feature: {
        ...feature,
        properties: {
          ...feature.properties,
          sector_score_m: Math.round(score),
          nearest_sector_m: Math.round(nearestSector.distance),
          nearest_sector_site: nearestSector.sector?.siteName || "",
          nearest_sector_cell: nearestSector.sector?.cellName || "",
          sector_coverage: true,
        },
      },
      score,
      nearestDistance: nearestTarget.distance,
      nearestSectorDistance: nearestSector.distance,
    };
  });

  const nearFeatures = scored.filter(
    (item) => item.nearestSectorDistance <= SECTOR_ROAD_KEEP_DISTANCE_M
  );

  const ratio = nearFeatures.length >= 20 ? SECTOR_MAX_KEEP_RATIO : SECTOR_MIN_KEEP_RATIO;
  const keepCount = Math.max(20, Math.ceil(scored.length * ratio));

  const ranked = [...scored].sort((a, b) => a.score - b.score);
  const selectedMap = new Map();

  nearFeatures.forEach((item) => {
    selectedMap.set(getFeatureKey(item.feature), item.feature);
  });

  ranked.slice(0, keepCount).forEach((item) => {
    selectedMap.set(getFeatureKey(item.feature), item.feature);
  });

  const selectedFeatures = Array.from(selectedMap.values());

  return {
    features: selectedFeatures,
    info: {
      sectorAware: true,
      sectorCount: sectorTargets.length,
      targetPointCount: targetPoints.length,
    },
  };
}

function applyCenterCoverageFallback(features, center) {
  if (features.length <= 20) return features;

  const ranked = [...features].sort((a, b) => {
    const aMid = getSegmentMidpoint(a.geometry.coordinates);
    const bMid = getSegmentMidpoint(b.geometry.coordinates);

    return distanceMeters(aMid, center) - distanceMeters(bMid, center);
  });

  const keepCount = Math.max(20, Math.ceil(ranked.length * 0.6));

  return ranked.slice(0, keepCount).map((feature) => ({
    ...feature,
    properties: {
      ...feature.properties,
      sector_coverage: false,
      coverage_fallback: "center_biased_no_sectors_found",
    },
  }));
}

function buildSectorTargetPoints(sectorTargets) {
  const points = [];

  sectorTargets.forEach((sector) => {
    points.push({
      point: sector.point,
      sector,
      kind: "site",
      weight: 1,
    });

    if (Number.isFinite(sector.azimuth)) {
      const beamWidth = Math.max(10, Math.min(sector.antennaBw || 65, 180));
      const distances = [
        Math.round(sector.radiusM * 0.45),
        Math.round(sector.radiusM * 0.85),
        Math.round(sector.radiusM * 1.2),
      ];

      distances.forEach((distanceM) => {
        points.push({
          point: destinationPointLngLat({
            lat: sector.lat,
            lon: sector.lon,
            bearingDeg: sector.azimuth,
            distanceM,
          }),
          sector,
          kind: "beam_center",
          weight: 1.25,
        });
      });

      [sector.azimuth - beamWidth / 2, sector.azimuth + beamWidth / 2].forEach(
        (bearingDeg) => {
          points.push({
            point: destinationPointLngLat({
              lat: sector.lat,
              lon: sector.lon,
              bearingDeg,
              distanceM: Math.round(sector.radiusM * 0.85),
            }),
            sector,
            kind: "beam_edge",
            weight: 1,
          });
        }
      );
    }
  });

  return points;
}

function getNearestTargetDistance(point, targetPoints) {
  let best = {
    distance: Infinity,
    target: null,
  };

  targetPoints.forEach((target) => {
    const distance = distanceMeters(point, target.point) / (target.weight || 1);

    if (distance < best.distance) {
      best = {
        distance,
        target,
      };
    }
  });

  return best;
}

function getNearestSectorDistance(point, sectorTargets) {
  let best = {
    distance: Infinity,
    sector: null,
  };

  sectorTargets.forEach((sector) => {
    const distance = distanceMeters(point, sector.point);

    if (distance < best.distance) {
      best = {
        distance,
        sector,
      };
    }
  });

  return best;
}

function getBeamBonus(point, sectorTargets) {
  let bonus = 0;

  sectorTargets.forEach((sector) => {
    if (!Number.isFinite(sector.azimuth)) return;

    const distance = distanceMeters(point, sector.point);
    if (distance > sector.radiusM * 1.35) return;

    const bearing = bearingDegrees(sector.point, point);
    const delta = angleDifferenceDegrees(bearing, sector.azimuth);
    const beamHalf = Math.max(10, Math.min(sector.antennaBw || 65, 180)) / 2;

    if (delta <= beamHalf) {
      bonus = Math.max(bonus, 175);
    } else if (delta <= beamHalf + 25) {
      bonus = Math.max(bonus, 80);
    }
  });

  return bonus;
}

function getRoadPriorityBonus(highway) {
  switch (highway) {
    case "primary":
      return 60;
    case "secondary":
      return 50;
    case "tertiary":
      return 40;
    case "unclassified":
      return 25;
    case "residential":
      return 15;
    case "service":
      return 8;
    default:
      return 0;
  }
}

function isPointInsideExpandedBbox(point, bbox, paddingDeg) {
  const [lng, lat] = point;

  return (
    lat >= bbox.south - paddingDeg &&
    lat <= bbox.north + paddingDeg &&
    lng >= bbox.west - paddingDeg &&
    lng <= bbox.east + paddingDeg
  );
}

function isPointInsideGeometry(point, geometry) {
  if (geometry.type === "Polygon") {
    return isPointInsidePolygon(point, geometry.coordinates);
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygonCoords) =>
      isPointInsidePolygon(point, polygonCoords)
    );
  }

  return false;
}

function isPointInsidePolygon(point, polygonCoords) {
  if (!polygonCoords?.length) return false;

  const outerRing = polygonCoords[0];
  const holes = polygonCoords.slice(1);

  if (!isPointInsideRing(point, outerRing)) return false;

  for (const hole of holes) {
    if (isPointInsideRing(point, hole)) return false;
  }

  return true;
}

function isPointInsideRing(point, ring) {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];

    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / ((yj - yi) || 0.0000001) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

function dedupeFeatures(features) {
  const seen = new Set();
  const clean = [];

  for (const feature of features) {
    const key = getFeatureKey(feature);

    if (seen.has(key)) continue;

    seen.add(key);
    clean.push(feature);
  }

  return clean;
}

function getFeatureKey(feature) {
  const coords = feature.geometry.coordinates;
  return `${feature.properties.way_id}:${coords[0][0]},${coords[0][1]}:${coords[1][0]},${coords[1][1]}`;
}

function getSegmentMidpoint(coords) {
  const a = coords[0];
  const b = coords[1];

  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function getFeatureCollectionLength(featureCollection) {
  return featureCollection.features.reduce((sum, feature) => {
    const coords = feature.geometry?.coordinates || [];

    if (feature.geometry?.type !== "LineString" || coords.length < 2) {
      return sum;
    }

    let length = 0;

    for (let i = 1; i < coords.length; i += 1) {
      length += distanceMeters(coords[i - 1], coords[i]);
    }

    return sum + length;
  }, 0);
}

function distanceMeters(a, b) {
  const earthRadiusM = 6371000;

  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));

  return earthRadiusM * c;
}

function destinationPointLngLat({ lat, lon, bearingDeg, distanceM }) {
  const earthRadiusM = 6371000;
  const angularDistance = Number(distanceM) / earthRadiusM;
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

  return [normalizeLongitude(toDeg(lon2)), toDeg(lat2)];
}

function bearingDegrees(from, to) {
  const lon1 = toRad(from[0]);
  const lat1 = toRad(from[1]);
  const lon2 = toRad(to[0]);
  const lat2 = toRad(to[1]);

  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);

  return normalizeBearing(toDeg(Math.atan2(y, x)));
}

function angleDifferenceDegrees(a, b) {
  const diff = Math.abs(normalizeBearing(a) - normalizeBearing(b));
  return Math.min(diff, 360 - diff);
}

function normalizeTechnology(value) {
  const text = String(value || "").trim().toUpperCase();

  if (text.includes("NR") || text.includes("5G")) return "5G";
  if (text.includes("LTE") || text.includes("4G")) return "LTE";
  if (text.includes("UMTS") || text.includes("WCDMA") || text.includes("3G")) {
    return "3G";
  }
  if (text.includes("GSM") || text.includes("2G")) return "2G";

  return text || "DEFAULT";
}

function getSectorRadiusM(technology) {
  return SECTOR_TECH_RADIUS_M[technology] || SECTOR_TECH_RADIUS_M.DEFAULT;
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
