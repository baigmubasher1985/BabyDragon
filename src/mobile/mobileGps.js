import { MOBILE_GPS_CACHE_PREFIX } from "./mobileConstants";

export function getMobileGpsCacheKey(userId) {
  return `${MOBILE_GPS_CACHE_PREFIX}_${userId || "unknown"}`;
}

export function isValidGpsPoint(location) {
  if (!location) return false;

  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);

  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

export function readCachedMobileGps(userId) {
  try {
    const raw =
      localStorage.getItem(getMobileGpsCacheKey(userId)) ||
      localStorage.getItem(`${MOBILE_GPS_CACHE_PREFIX}_last`);

    if (!raw) return null;

    const cached = JSON.parse(raw);
    return isValidGpsPoint(cached) ? cached : null;
  } catch (error) {
    console.warn("BabyDragon mobile could not read cached GPS:", error);
    return null;
  }
}

export function saveCachedMobileGps(userId, location, source = "browser_gps") {
  if (!isValidGpsPoint(location)) return null;

  const gps = {
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    accuracy: location.accuracy ?? null,
    source,
    cached_at: new Date().toISOString(),
    from_cache: Boolean(location.from_cache),
  };

  try {
    localStorage.setItem(`${MOBILE_GPS_CACHE_PREFIX}_last`, JSON.stringify(gps));

    if (userId) {
      localStorage.setItem(getMobileGpsCacheKey(userId), JSON.stringify(gps));
    }
  } catch (error) {
    console.warn("BabyDragon mobile could not cache GPS:", error);
  }

  return gps;
}

export function getCurrentLocationSafe(userId = null, options = {}) {
  const {
    allowCachedFallback = false,
    source = "browser_gps",
    timeout = 10000,
    maximumAge = 60000,
  } = options;

  return new Promise((resolve) => {
    const cached = readCachedMobileGps(userId);

    if (!navigator?.geolocation) {
      resolve(allowCachedFallback && cached ? { ...cached, from_cache: true } : null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const freshLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy ?? null,
          from_cache: false,
        };

        const cachedGps = saveCachedMobileGps(userId, freshLocation, source);
        resolve(cachedGps || freshLocation);
      },
      () => {
        resolve(allowCachedFallback && cached ? { ...cached, from_cache: true } : null);
      },
      {
        enableHighAccuracy: true,
        timeout,
        maximumAge,
      }
    );
  });
}

export function formatGpsTime(value) {
  if (!value) return "Not saved yet";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatGpsPoint(location) {
  if (!isValidGpsPoint(location)) return "GPS not available";
  return `${Number(location.latitude).toFixed(5)}, ${Number(location.longitude).toFixed(5)}`;
}
