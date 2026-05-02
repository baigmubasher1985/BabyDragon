import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
} from "react-leaflet";
import L from "leaflet";

const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const focusIcon = new L.DivIcon({
  className: "timeline-focus-marker",
  html: `<div class="timeline-focus-dot">📍</div>`,
  iconSize: [38, 38],
  iconAnchor: [19, 38],
});

function freshText(dateValue) {
  const diff = Math.floor((Date.now() - new Date(dateValue)) / 1000);
  if (diff < 60) return `${diff} sec ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  return `${Math.floor(diff / 3600)} hr ago`;
}

function FitActiveLocations({ locations, focusedLocation }) {
  const map = useMap();

  useEffect(() => {
    if (focusedLocation) return;
    if (!locations.length) return;

    const bounds = L.latLngBounds(
      locations.map((loc) => [
        Number(loc.latitude),
        Number(loc.longitude),
      ])
    );

    map.fitBounds(bounds, {
      padding: [40, 40],
      maxZoom: 15,
    });
  }, [locations, focusedLocation, map]);

  return null;
}

function FocusTimelineLocation({ focusedLocation }) {
  const map = useMap();

  useEffect(() => {
    if (!focusedLocation?.lat || !focusedLocation?.lng) return;

    map.flyTo([Number(focusedLocation.lat), Number(focusedLocation.lng)], 17, {
      duration: 1.4,
    });
  }, [focusedLocation, map]);

  return null;
}

export default function AdminLiveMap({ filters, focusedLocation }) {
  const [locations, setLocations] = useState([]);
  const [trails, setTrails] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLocations();

    const interval = setInterval(() => {
      fetchLocations();
    }, 5000);

    return () => clearInterval(interval);
  }, [filters]);

  async function fetchLocations() {
    const { data, error } = await supabase
      .from("task_updates")
      .select(`
        *,
        tasks (
          id,
          project_id,
          assigned_to,
          market,
          target_name,
          target_type,
          test_type,
          status
        )
      `)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error loading locations:", error);
      setLoading(false);
      return;
    }

    const filteredUpdates = (data || []).filter((item) => {
      const matchProject =
        !filters?.projectId || item.tasks?.project_id === filters.projectId;

      const matchMarket =
        !filters?.market || item.tasks?.market === filters.market;

      const matchStatus =
        !filters?.status || item.tasks?.status === filters.status;

      const matchFe =
        !filters?.feId || item.tasks?.assigned_to === filters.feId;

      return matchProject && matchMarket && matchStatus && matchFe;
    });

    const activeUpdates = filteredUpdates.filter(
      (item) => item.tasks?.status === "in_progress"
    );

    const trailByTask = {};
    const latestByTask = {};

    activeUpdates.forEach((item) => {
      if (!trailByTask[item.task_id]) {
        trailByTask[item.task_id] = [];
      }

      trailByTask[item.task_id].push([
        Number(item.latitude),
        Number(item.longitude),
      ]);

      latestByTask[item.task_id] = item;
    });

    setTrails(trailByTask);
    setLocations(Object.values(latestByTask));
    setLoading(false);
  }

  const trailCount = useMemo(() => {
    return Object.values(trails).reduce((sum, points) => sum + points.length, 0);
  }, [trails]);

  return (
    <div className="panel-card">
      <div className="panel-header">
        <div>
          <h2>Live FE / UE Activity Map</h2>
          <p>
            Active locations: {locations.length} • Trail points: {trailCount}
          </p>
        </div>
      </div>

      {loading && <p className="muted">Loading FE locations...</p>}

      {!loading && locations.length === 0 && !focusedLocation && (
        <p className="muted">
          No active FE GPS locations. Start a task to begin tracking.
        </p>
      )}

      {focusedLocation && (
        <p className="timeline-map-note">
          Timeline location selected:{" "}
          {new Date(focusedLocation.time).toLocaleString()}
        </p>
      )}

      <div className="map-shell">
        <MapContainer center={[33.0, -96.8]} zoom={10} className="admin-map">
          <TileLayer
            attribution="&copy; OpenStreetMap"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <FitActiveLocations
            locations={locations}
            focusedLocation={focusedLocation}
          />

          <FocusTimelineLocation focusedLocation={focusedLocation} />

          {Object.entries(trails).map(([taskId, points]) =>
            points.length > 1 ? (
              <Polyline
                key={taskId}
                positions={points}
                pathOptions={{
                  weight: 5,
                  opacity: 0.8,
                }}
              />
            ) : null
          )}

          {locations.map((loc) => (
            <Marker
              key={loc.id}
              position={[Number(loc.latitude), Number(loc.longitude)]}
              icon={markerIcon}
            >
              <Popup>
                <b>FE:</b> {loc.user_email || "Unknown"}
                <br />
                <b>Status:</b> {loc.tasks?.status || "N/A"}
                <br />
                <b>Market:</b> {loc.tasks?.market || "N/A"}
                <br />
                <b>Target:</b> {loc.tasks?.target_name || "N/A"}
                <br />
                <b>Test:</b> {loc.tasks?.test_type || "N/A"}
                <br />
                <b>Last Activity:</b>{" "}
                {new Date(loc.created_at).toLocaleString()}
                <br />
                <b>Fresh:</b> {freshText(loc.created_at)}
                <br />
                <b>Trail Points:</b> {trails[loc.task_id]?.length || 0}
              </Popup>
            </Marker>
          ))}

          {focusedLocation?.lat && focusedLocation?.lng && (
            <Marker
              position={[Number(focusedLocation.lat), Number(focusedLocation.lng)]}
              icon={focusIcon}
            >
              <Popup>
                <b>Selected Timeline Event</b>
                <br />
                {new Date(focusedLocation.time).toLocaleString()}
                <br />
                Lat/Lng: {Number(focusedLocation.lat).toFixed(5)},{" "}
                {Number(focusedLocation.lng).toFixed(5)}
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </div>

      <div className="live-location-list">
        <h3>Latest Active FE Locations</h3>

        {locations.length === 0 ? (
          <p className="muted">No active locations available.</p>
        ) : (
          locations.map((loc) => (
            <div key={loc.id} className="live-location-row">
              <b>{loc.user_email || "Unknown FE"}</b>
              <span>{freshText(loc.created_at)}</span>
              <p>
                {loc.tasks?.market || "N/A"} •{" "}
                {loc.tasks?.target_name || "N/A"} •{" "}
                {loc.tasks?.test_type || "N/A"}
              </p>
              <p>
                Lat/Lng: {Number(loc.latitude).toFixed(5)},{" "}
                {Number(loc.longitude).toFixed(5)}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}