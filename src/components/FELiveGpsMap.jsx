import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle } from "react-leaflet";
import L from "leaflet";

const gpsIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

export default function FELiveGpsMap({ onLocationChange }) {
  const [position, setPosition] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!navigator.geolocation) {
      setError("GPS is not supported on this device/browser.");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const livePosition = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };

        setPosition(livePosition);
        setAccuracy(pos.coords.accuracy);

        if (onLocationChange) {
          onLocationChange({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          });
        }
      },
      () => {
        setError("Unable to get GPS location. Please allow location permission.");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [onLocationChange]);

  if (error) {
    return (
      <div style={styles.errorBox}>
        {error}
      </div>
    );
  }

  if (!position) {
    return (
      <div style={styles.loadingBox}>
        Getting live GPS location...
      </div>
    );
  }

  return (
    <div style={styles.mapWrapper}>
      <MapContainer
        center={[position.lat, position.lng]}
        zoom={17}
        style={{ height: "320px", width: "100%", borderRadius: "14px" }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <Marker position={[position.lat, position.lng]} icon={gpsIcon}>
          <Popup>
            <b>Live FE Location</b>
            <br />
            Lat: {position.lat.toFixed(6)}
            <br />
            Lng: {position.lng.toFixed(6)}
            <br />
            Accuracy: {accuracy ? Math.round(accuracy) : "N/A"} meters
          </Popup>
        </Marker>

        {accuracy && (
          <Circle
            center={[position.lat, position.lng]}
            radius={accuracy}
          />
        )}
      </MapContainer>

      <div style={styles.gpsInfo}>
        <div><b>Latitude:</b> {position.lat.toFixed(6)}</div>
        <div><b>Longitude:</b> {position.lng.toFixed(6)}</div>
        <div><b>Accuracy:</b> {accuracy ? Math.round(accuracy) : "N/A"} meters</div>
      </div>
    </div>
  );
}

const styles = {
  mapWrapper: {
    marginTop: "12px",
    background: "#0f172a",
    padding: "12px",
    borderRadius: "16px",
    border: "1px solid #1e293b",
  },
  gpsInfo: {
    marginTop: "10px",
    color: "#e5e7eb",
    fontSize: "14px",
    lineHeight: "1.6",
  },
  loadingBox: {
    padding: "16px",
    background: "#111827",
    color: "#e5e7eb",
    borderRadius: "12px",
    marginTop: "12px",
  },
  errorBox: {
    padding: "16px",
    background: "#7f1d1d",
    color: "#fff",
    borderRadius: "12px",
    marginTop: "12px",
  },
};