import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";

export function MapInvalidateSize({ extraKey = 0 }) {
  const map = useMap();

  useEffect(() => {
    if (!map?.invalidateSize) return undefined;

    const first = window.setTimeout(() => map.invalidateSize(true), 80);
    const second = window.setTimeout(() => map.invalidateSize(true), 420);

    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, [extraKey, map]);

  return null;
}

export function TileLoadGuard({ onStatus, timeoutMs = 8000 }) {
  const map = useMap();
  const statusRef = useRef(onStatus);

  useEffect(() => {
    statusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    if (!map?.on) return undefined;

    let loaded = 0;
    let errors = 0;
    let settled = false;

    const emit = (failed) => {
      statusRef.current?.({ loaded, errors, failed: Boolean(failed) });
    };

    const onLoad = () => {
      loaded += 1;
      if (!settled && loaded > 0) {
        settled = true;
        emit(false);
      }
    };

    const onError = () => {
      errors += 1;
      if (!settled && errors >= 4 && loaded === 0) {
        settled = true;
        emit(true);
      }
    };

    map.on("tileload", onLoad);
    map.on("tileerror", onError);

    const timer = window.setTimeout(() => {
      if (!settled && loaded === 0) {
        settled = true;
        emit(true);
      }
    }, timeoutMs);

    return () => {
      map.off("tileload", onLoad);
      map.off("tileerror", onError);
      window.clearTimeout(timer);
    };
  }, [map, timeoutMs]);

  return null;
}
