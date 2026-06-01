import { useRef, useState } from "react";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { supabase } from "../lib/supabaseClient";
import GridMap from "../components/GridMap";

export default function GridUpload({ filters }) {
  const fileInputRef = useRef(null);

  const [market, setMarket] = useState("");
  const [fileName, setFileName] = useState("");
  const [message, setMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [uploading, setUploading] = useState(false);

  const handleFileChange = (e) => {
    const file = e.target.files[0];

    if (!file) {
      setFileName("");
      return;
    }

    setFileName(file.name);
    setMessage("File selected. Ready to import.");
  };

  const readFileContent = async (file) => {
    const lowerName = file.name.toLowerCase();

    if (lowerName.endsWith(".kml")) {
      return await file.text();
    }

    if (lowerName.endsWith(".kmz")) {
      const zip = await JSZip.loadAsync(file);
      const kmlFileName = Object.keys(zip.files).find((name) =>
        name.toLowerCase().endsWith(".kml")
      );

      if (!kmlFileName) {
        throw new Error("No KML file found inside KMZ.");
      }

      return await zip.files[kmlFileName].async("text");
    }

    throw new Error("Only KML or KMZ files are supported.");
  };

  const collectPlacemarks = (node, result = []) => {
    if (!node || typeof node !== "object") return result;

    if (node.Placemark) {
      if (Array.isArray(node.Placemark)) {
        result.push(...node.Placemark);
      } else {
        result.push(node.Placemark);
      }
    }

    Object.values(node).forEach((value) => {
      if (Array.isArray(value)) {
        value.forEach((item) => collectPlacemarks(item, result));
      } else if (value && typeof value === "object") {
        collectPlacemarks(value, result);
      }
    });

    return result;
  };

  const extractCoordinates = (placemark) => {
    const coordinates =
      placemark?.Polygon?.outerBoundaryIs?.LinearRing?.coordinates ||
      placemark?.MultiGeometry?.Polygon?.outerBoundaryIs?.LinearRing
        ?.coordinates;

    if (!coordinates) return null;

    return String(coordinates)
      .trim()
      .split(/\s+/)
      .map((item) => {
        const [lng, lat] = item.split(",").map(Number);
        return [lng, lat];
      })
      .filter(([lng, lat]) => !Number.isNaN(lng) && !Number.isNaN(lat));
  };

  const handleUpload = async () => {
    try {
      const file = fileInputRef.current?.files?.[0];

      if (!market.trim()) {
        setMessage("Please enter market before importing grids.");
        return;
      }

      if (!file) {
        setMessage("Please select a KML or KMZ file first.");
        return;
      }

      setUploading(true);
      setMessage("Reading file...");

      const text = await readFileContent(file);

      const parser = new XMLParser({
        ignoreAttributes: false,
        trimValues: true,
      });

      const json = parser.parse(text);
      const placemarks = collectPlacemarks(json);

      if (!placemarks || placemarks.length === 0) {
        setMessage("No placemarks found in this file.");
        setUploading(false);
        return;
      }

      const rows = [];

      placemarks.forEach((pm, index) => {
        const name =
          typeof pm.name === "string"
            ? pm.name
            : pm.name?.["#text"] || `Grid ${index + 1}`;

        const coords = extractCoordinates(pm);

        if (!coords || coords.length < 3) return;

        rows.push({
          name,
          market: market.trim(),
          geometry: {
            type: "Polygon",
            coordinates: [coords],
          },
        });
      });

      if (rows.length === 0) {
        setMessage("No valid polygon grids found.");
        setUploading(false);
        return;
      }

      setMessage(`Saving ${rows.length} grids...`);

      const { error } = await supabase.from("grids").insert(rows);

      if (error) {
        console.error(error);
        setMessage(`Error saving grids: ${error.message}`);
        setUploading(false);
        return;
      }

      setMessage(`${rows.length} grids imported successfully.`);
      setMarket("");
      setFileName("");

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      setRefreshKey((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setMessage(`Import error: ${err.message}`);
    }

    setUploading(false);
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>Grid Management</h2>

      <p style={{ color: "#9fb2cf" }}>
        Import grid boundaries, save them by market, view them on map, and manage
        grid records.
      </p>

      <div className="panel-card">
        <div className="panel-header">
          <h2>Import Grids</h2>
        </div>

        <div className="form-grid" style={{ marginTop: "16px" }}>
          <div>
            <label>Market</label>
            <input
              type="text"
              placeholder="Example: Dallas"
              value={market}
              onChange={(e) => setMarket(e.target.value)}
            />
          </div>

          <div>
            <label>KML / KMZ File</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".kml,.kmz"
              onChange={handleFileChange}
            />
          </div>

          <button onClick={handleUpload} disabled={uploading}>
            {uploading ? "Importing..." : "Upload Grid"}
          </button>
        </div>

        {fileName && (
          <p style={{ marginTop: "12px" }}>
            Selected File: <strong>{fileName}</strong>
          </p>
        )}

        {message && (
          <p style={{ marginTop: "12px", color: "#43ff9a", fontWeight: 800 }}>
            {message}
          </p>
        )}
      </div>

      <GridMap refreshKey={refreshKey} dashboardFilters={filters} />
    </div>
  );
}