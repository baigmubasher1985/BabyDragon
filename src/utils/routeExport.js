import JSZip from "jszip";

export function exportRouteKml({ route, grid, fileName }) {
  const kml = buildRouteKml({ route, grid });
  downloadTextFile(`${safeFileName(fileName || getRouteFileName(route, grid))}.kml`, kml);
}

export function exportRouteHtml({ route, grid, fileName }) {
  const html = buildRouteHtml({ route, grid });
  downloadTextFile(`${safeFileName(fileName || getRouteFileName(route, grid))}.html`, html);
}

export async function exportRouteZip({ route, grid, fileName }) {
  const baseName = safeFileName(fileName || getRouteFileName(route, grid));

  const zip = new JSZip();

  zip.file(`${baseName}.kml`, buildRouteKml({ route, grid }));
  zip.file(`${baseName}.html`, buildRouteHtml({ route, grid }));
  zip.file(`${baseName}_route.geojson`, JSON.stringify(parseRouteGeojson(route?.route_geojson), null, 2));
  zip.file(`${baseName}_grid.geojson`, JSON.stringify(buildGridFeature(grid), null, 2));

  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(`${baseName}.zip`, blob);
}

export function getRouteFileName(route, grid) {
  const gridName = getGridLabel(grid);
  const routeMode = formatRouteMode(route?.route_mode || "route");
  return `${gridName}_${routeMode}_Export`;
}

function buildRouteKml({ route, grid }) {
  const routeGeojson = parseRouteGeojson(route?.route_geojson);
  const gridFeature = buildGridFeature(grid);

  const routeName = escapeXml(route?.route_name || "Saved Route");
  const gridName = escapeXml(getGridLabel(grid));
  const routeMode = escapeXml(formatRouteMode(route?.route_mode));
  const routeLength = escapeXml(formatRouteLength(route));
  const generated = escapeXml(formatGeneratedDate(route));

  const gridPolygonKml = gridFeature ? gridFeatureToKml(gridFeature) : "";
  const routeLineKml = routeGeojson ? routeGeojsonToKml(routeGeojson) : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${routeName}</name>

    <Style id="gridStyle">
      <LineStyle>
        <color>ff00ffff</color>
        <width>4</width>
      </LineStyle>
      <PolyStyle>
        <color>5533ccff</color>
      </PolyStyle>
    </Style>

    <Style id="routeStyle">
      <LineStyle>
        <color>ff00ff00</color>
        <width>5</width>
      </LineStyle>
    </Style>

    <Folder>
      <name>Route Info</name>
      <Placemark>
        <name>${routeName}</name>
        <description>
          <![CDATA[
            <b>Grid:</b> ${gridName}<br/>
            <b>Mode:</b> ${routeMode}<br/>
            <b>Length:</b> ${routeLength}<br/>
            <b>Generated:</b> ${generated}
          ]]>
        </description>
      </Placemark>
    </Folder>

    <Folder>
      <name>Grid Boundary</name>
      ${gridPolygonKml}
    </Folder>

    <Folder>
      <name>Route Lines</name>
      ${routeLineKml}
    </Folder>
  </Document>
</kml>`;
}

function buildRouteHtml({ route, grid }) {
  const routeGeojson = parseRouteGeojson(route?.route_geojson);
  const gridFeature = buildGridFeature(grid);

  const routeName = route?.route_name || "Saved Route";
  const gridName = getGridLabel(grid);
  const routeMode = formatRouteMode(route?.route_mode);
  const routeLength = formatRouteLength(route);
  const generated = formatGeneratedDate(route);

  const center = getBestCenter({ routeGeojson, gridFeature }) || [32.7767, -96.797];

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(routeName)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <link
    rel="stylesheet"
    href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  />

  <style>
    html, body, #map {
      height: 100%;
      margin: 0;
      font-family: Arial, sans-serif;
      background: #07111f;
    }

    .info-card {
      position: absolute;
      top: 16px;
      left: 16px;
      z-index: 999;
      background: #101828;
      color: white;
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 14px;
      padding: 14px 16px;
      min-width: 260px;
      box-shadow: 0 18px 40px rgba(0,0,0,0.35);
    }

    .info-card h2 {
      margin: 0 0 8px;
      font-size: 18px;
    }

    .info-card p {
      margin: 5px 0;
      color: #d1d5db;
      font-size: 13px;
    }

    .badge {
      display: inline-block;
      margin-top: 8px;
      background: rgba(34,197,94,0.14);
      color: #86efac;
      border: 1px solid rgba(34,197,94,0.45);
      border-radius: 999px;
      padding: 5px 9px;
      font-weight: bold;
      font-size: 12px;
    }
  </style>
</head>

<body>
  <div class="info-card">
    <h2>${escapeHtml(routeName)}</h2>
    <p><b>Grid:</b> ${escapeHtml(gridName)}</p>
    <p><b>Mode:</b> ${escapeHtml(routeMode)}</p>
    <p><b>Length:</b> ${escapeHtml(routeLength)}</p>
    <p><b>Generated:</b> ${escapeHtml(generated)}</p>
    <span class="badge">Route Ready</span>
  </div>

  <div id="map"></div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

  <script>
    const gridFeature = ${JSON.stringify(gridFeature || null)};
    const routeGeojson = ${JSON.stringify(routeGeojson || null)};

    const map = L.map("map").setView([${center[0]}, ${center[1]}], 14);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    const layers = [];

    if (gridFeature) {
      const gridLayer = L.geoJSON(gridFeature, {
        style: {
          color: "#FACC15",
          weight: 4,
          fillColor: "#60A5FA",
          fillOpacity: 0.22
        }
      }).addTo(map);

      layers.push(gridLayer);
    }

    if (routeGeojson) {
      const routeLayer = L.geoJSON(routeGeojson, {
        style: {
          color: "#00FF66",
          weight: 7,
          opacity: 1,
          lineCap: "round",
          lineJoin: "round"
        }
      }).addTo(map);

      layers.push(routeLayer);
    }

    if (layers.length) {
      const group = L.featureGroup(layers);
      map.fitBounds(group.getBounds(), {
        padding: [28, 28],
        maxZoom: 17
      });
    }
  </script>
</body>
</html>`;
}

function gridFeatureToKml(feature) {
  const geometry = feature.geometry;

  if (!geometry) return "";

  if (geometry.type === "Polygon") {
    return polygonToPlacemark({
      name: "Grid Boundary",
      coordinates: geometry.coordinates,
    });
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .map((polygonCoords, index) =>
        polygonToPlacemark({
          name: `Grid Boundary ${index + 1}`,
          coordinates: polygonCoords,
        })
      )
      .join("\n");
  }

  return "";
}

function polygonToPlacemark({ name, coordinates }) {
  const outerRing = coordinates?.[0] || [];

  const coordText = outerRing
    .map(([lng, lat]) => `${lng},${lat},0`)
    .join(" ");

  return `
      <Placemark>
        <name>${escapeXml(name)}</name>
        <styleUrl>#gridStyle</styleUrl>
        <Polygon>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>${coordText}</coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
      </Placemark>`;
}

function routeGeojsonToKml(routeGeojson) {
  if (!routeGeojson?.features?.length) return "";

  return routeGeojson.features
    .map((feature, index) => {
      const geometry = feature.geometry;

      if (!geometry) return "";

      if (geometry.type === "LineString") {
        return lineStringToPlacemark({
          name: feature.properties?.name || `Route Segment ${index + 1}`,
          coordinates: geometry.coordinates,
        });
      }

      if (geometry.type === "MultiLineString") {
        return geometry.coordinates
          .map((lineCoords, lineIndex) =>
            lineStringToPlacemark({
              name: `Route Segment ${index + 1}.${lineIndex + 1}`,
              coordinates: lineCoords,
            })
          )
          .join("\n");
      }

      return "";
    })
    .join("\n");
}

function lineStringToPlacemark({ name, coordinates }) {
  const coordText = coordinates
    .map(([lng, lat]) => `${lng},${lat},0`)
    .join(" ");

  return `
      <Placemark>
        <name>${escapeXml(name)}</name>
        <styleUrl>#routeStyle</styleUrl>
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>${coordText}</coordinates>
        </LineString>
      </Placemark>`;
}

function buildGridFeature(grid) {
  if (!grid) return null;

  const geometry = normalizeGeometry(
    grid.geometry ||
      grid.geojson ||
      grid.boundary_geojson ||
      grid.boundary ||
      grid.polygon ||
      grid.geom
  );

  if (!geometry) return null;

  return {
    type: "Feature",
    properties: {
      id: grid.id,
      grid_id: grid.grid_id,
      name: getGridLabel(grid),
      market: getGridMarket(grid),
    },
    geometry,
  };
}

function parseRouteGeojson(routeGeojson) {
  if (!routeGeojson) return null;

  let parsed = routeGeojson;

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }

  if (parsed.type === "FeatureCollection") return parsed;

  if (parsed.type === "Feature") {
    return {
      type: "FeatureCollection",
      features: [parsed],
    };
  }

  if (parsed.type === "LineString" || parsed.type === "MultiLineString") {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: parsed,
        },
      ],
    };
  }

  return null;
}

function normalizeGeometry(geometry) {
  if (!geometry) return null;

  if (typeof geometry === "object") {
    if (geometry.type === "Feature") return geometry.geometry;

    if (geometry.type === "FeatureCollection") {
      const polygonFeature = geometry.features?.find((feature) =>
        ["Polygon", "MultiPolygon"].includes(feature?.geometry?.type)
      );

      return polygonFeature?.geometry || null;
    }

    return geometry;
  }

  if (typeof geometry === "string") {
    try {
      const parsed = JSON.parse(geometry);

      if (parsed.type === "Feature") return parsed.geometry;

      if (parsed.type === "FeatureCollection") {
        const polygonFeature = parsed.features?.find((feature) =>
          ["Polygon", "MultiPolygon"].includes(feature?.geometry?.type)
        );

        return polygonFeature?.geometry || null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  return null;
}

function getBestCenter({ routeGeojson, gridFeature }) {
  const routePoint = getFirstRoutePoint(routeGeojson);

  if (routePoint) return [routePoint.lat, routePoint.lng];

  const gridCenter = getGeometryCenter(gridFeature?.geometry);

  if (gridCenter) return [gridCenter.lat, gridCenter.lng];

  return null;
}

function getFirstRoutePoint(routeGeojson) {
  if (!routeGeojson?.features?.length) return null;

  for (const feature of routeGeojson.features) {
    const geometry = feature.geometry;

    if (!geometry) continue;

    if (geometry.type === "LineString") {
      const first = geometry.coordinates?.[0];

      if (isValidLngLat(first)) {
        return {
          lng: Number(first[0]),
          lat: Number(first[1]),
        };
      }
    }

    if (geometry.type === "MultiLineString") {
      const first = geometry.coordinates?.[0]?.[0];

      if (isValidLngLat(first)) {
        return {
          lng: Number(first[0]),
          lat: Number(first[1]),
        };
      }
    }
  }

  return null;
}

function getGeometryCenter(geometry) {
  const points = getGeometryPoints(geometry);

  if (!points.length) return null;

  let lngSum = 0;
  let latSum = 0;

  points.forEach(([lng, lat]) => {
    lngSum += Number(lng);
    latSum += Number(lat);
  });

  return {
    lng: lngSum / points.length,
    lat: latSum / points.length,
  };
}

function getGeometryPoints(geometry) {
  if (!geometry) return [];

  if (geometry.type === "Polygon") {
    return geometry.coordinates.flat().filter(isValidLngLat);
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flat(2).filter(isValidLngLat);
  }

  return [];
}

function isValidLngLat(point) {
  return (
    Array.isArray(point) &&
    point.length >= 2 &&
    Number.isFinite(Number(point[0])) &&
    Number.isFinite(Number(point[1]))
  );
}

function getGridLabel(grid) {
  if (!grid) return "Unknown_Grid";

  return (
    grid.grid_id ||
    grid.grid_name ||
    grid.name ||
    grid.GridName ||
    grid.Real_GridCode ||
    grid.real_grid_code ||
    grid.GRID_ID ||
    grid.id ||
    "Grid"
  );
}

function getGridMarket(grid) {
  if (!grid) return "";

  return grid.market || grid.Market || grid.market_name || "";
}

function formatRouteMode(mode) {
  if (!mode) return "Route";

  return String(mode)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatRouteLength(route) {
  const meters = Number(route?.route_length_m);

  if (!Number.isFinite(meters) || meters <= 0) return "N/A";

  const miles = meters / 1609.344;

  if (miles < 0.1) {
    return `${Math.round(meters)} m`;
  }

  return `${miles.toFixed(2)} mi`;
}

function formatGeneratedDate(route) {
  const value = route?.generated_at || route?.updated_at || route?.created_at;

  if (!value) return "N/A";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "N/A";

  return date.toLocaleString();
}

function downloadTextFile(fileName, content) {
  const blob = new Blob([content], {
    type: "text/plain;charset=utf-8",
  });

  downloadBlob(fileName, blob);
}

function downloadBlob(fileName, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

function safeFileName(value) {
  return String(value || "route_export")
    .replace(/[<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}