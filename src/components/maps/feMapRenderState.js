export const FE_MAP_NO_ROUTE_COPY = "No route has been created for this assigned grid.";
export const FE_MAP_NO_GEOMETRY_COPY = "This assigned grid does not have enough valid map geometry to display.";
export const FE_MAP_TILES_UNAVAILABLE = "Map tiles unavailable";
export const FE_MAP_IDLE_COPY = "Select an assigned grid to preview its saved route.";

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

export function isValidLngLat(point) {
  return (
    Array.isArray(point) &&
    point.length >= 2 &&
    isFiniteNumber(point[0]) &&
    isFiniteNumber(point[1])
  );
}

export function isValidLatLng(point) {
  if (!point) return false;
  if (Array.isArray(point)) return isValidLngLat(point);
  return isFiniteNumber(point.lat) && isFiniteNumber(point.lng || point.lon);
}

function collectGeometryPoints(geometry, into = []) {
  if (!geometry) return into;

  if (geometry.type === "Point" && isValidLngLat(geometry.coordinates)) {
    into.push(geometry.coordinates);
    return into;
  }

  if (
    geometry.type === "LineString" ||
    geometry.type === "MultiPoint"
  ) {
    (geometry.coordinates || []).forEach((point) => {
      if (isValidLngLat(point)) into.push(point);
    });
    return into;
  }

  if (geometry.type === "Polygon" || geometry.type === "MultiLineString") {
    (geometry.coordinates || []).forEach((ring) => {
      (ring || []).forEach((point) => {
        if (isValidLngLat(point)) into.push(point);
      });
    });
    return into;
  }

  if (geometry.type === "MultiPolygon") {
    (geometry.coordinates || []).forEach((polygon) => {
      (polygon || []).forEach((ring) => {
        (ring || []).forEach((point) => {
          if (isValidLngLat(point)) into.push(point);
        });
      });
    });
  }

  return into;
}

export function hasValidGridGeometry(geometry) {
  if (!geometry) return false;
  const geom = geometry.type === "Feature" ? geometry.geometry : geometry;
  if (!geom || !["Polygon", "MultiPolygon"].includes(geom.type)) return false;
  return collectGeometryPoints(geom).length >= 3;
}

export function hasValidRouteGeometry(geojson) {
  if (!geojson) return false;

  const features =
    geojson.type === "FeatureCollection"
      ? geojson.features || []
      : geojson.type === "Feature"
        ? [geojson]
        : geojson.type === "LineString" || geojson.type === "MultiLineString"
          ? [{ type: "Feature", geometry: geojson, properties: {} }]
          : [];

  let pointCount = 0;
  for (const feature of features) {
    const geometry = feature?.geometry;
    if (!geometry) continue;
    if (!["LineString", "MultiLineString"].includes(geometry.type)) continue;
    const points = collectGeometryPoints(geometry);
    pointCount += points.length;
    if (pointCount > 1) return true;
  }

  return false;
}

export function countRouteLineFeatures(geojson) {
  if (!geojson) return 0;

  const features =
    geojson.type === "FeatureCollection"
      ? geojson.features || []
      : geojson.type === "Feature"
        ? [geojson]
        : [];

  return features.filter((feature) => {
    const geometry = feature?.geometry;
    if (!geometry) return false;
    if (!["LineString", "MultiLineString"].includes(geometry.type)) return false;
    return collectGeometryPoints(geometry).length > 1;
  }).length;
}

export function canFitValidBounds(layers) {
  const list = Array.isArray(layers) ? layers.filter(Boolean) : [];
  return list.length > 0;
}

export function resolveFeMapRenderState(input = {}) {
  const hasRouteGeometry = Boolean(input.hasRouteGeometry);
  const hasGridGeometry = Boolean(input.hasGridGeometry);
  const hasNavigationDestination = Boolean(input.hasNavigationDestination);
  const tilesFailed = Boolean(input.tilesFailed);
  const viewGridBoundary = Boolean(input.viewGridBoundary);
  const selected = input.selected !== false;
  const gridLabel = String(input.gridLabel || "").trim();
  const gridId = String(input.gridId || "").trim();

  const base = {
    gridLabel,
    gridId,
    emptyMessage: "",
    showMap: false,
    drawRoute: false,
    drawGrid: false,
    showNavigate: false,
    showViewGridBoundary: false,
    showRetry: false,
    routeCount: hasRouteGeometry ? 1 : 0,
    fitBounds: false,
  };

  if (!selected) {
    return {
      ...base,
      mode: "idle",
      emptyMessage: FE_MAP_IDLE_COPY,
    };
  }

  if (tilesFailed && (hasRouteGeometry || (hasGridGeometry && viewGridBoundary))) {
    return {
      ...base,
      mode: "tile_failure",
      emptyMessage: FE_MAP_TILES_UNAVAILABLE,
      showRetry: true,
      drawRoute: false,
      drawGrid: false,
      showNavigate: hasNavigationDestination,
      routeCount: hasRouteGeometry ? 1 : 0,
    };
  }

  if (hasRouteGeometry) {
    return {
      ...base,
      mode: "route_map",
      showMap: true,
      drawRoute: true,
      drawGrid: hasGridGeometry,
      showNavigate: hasNavigationDestination,
      fitBounds: true,
      routeCount: 1,
    };
  }

  if (hasGridGeometry && viewGridBoundary) {
    return {
      ...base,
      mode: "grid_boundary_map",
      showMap: true,
      drawRoute: false,
      drawGrid: true,
      showNavigate: hasNavigationDestination,
      showViewGridBoundary: true,
      fitBounds: true,
      emptyMessage: FE_MAP_NO_ROUTE_COPY,
      routeCount: 0,
    };
  }

  if (hasGridGeometry) {
    return {
      ...base,
      mode: "grid_only_empty",
      emptyMessage: FE_MAP_NO_ROUTE_COPY,
      showNavigate: hasNavigationDestination,
      showViewGridBoundary: true,
      routeCount: 0,
    };
  }

  return {
    ...base,
    mode: "no_geometry",
    emptyMessage: FE_MAP_NO_GEOMETRY_COPY,
    showNavigate: hasNavigationDestination,
    routeCount: 0,
  };
}
