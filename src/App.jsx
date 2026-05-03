import { useState, useRef, useCallback, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── Supabase setup ───
const supabase = createClient(
  "https://dhywbdwveorpkurckflb.supabase.co",
  "sb_publishable_lFvJV3GM4cuzZ4GMTvUyVw_c-Am1bZU"
);

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

function degToNum(lat, lon, zoom) {
  const n = Math.pow(2, zoom);
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  return { x, y };
}

function numToDeg(x, y, zoom) {
  const n = Math.pow(2, zoom);
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lat, lon };
}

function parseExifGPS(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const view = new DataView(e.target.result);
      if (view.getUint16(0) !== 0xffd8) return resolve(null);

      let offset = 2;
      while (offset < view.byteLength - 1) {
        const marker = view.getUint16(offset);
        if (marker === 0xffe1) {
          const exifData = parseExif(view, offset + 4);
          resolve(exifData);
          return;
        }
        offset += 2 + view.getUint16(offset + 2);
      }
      resolve(null);
    };
    reader.readAsArrayBuffer(file);
  });
}

function parseExif(view, start) {
  const exifHeader = String.fromCharCode(
    view.getUint8(start), view.getUint8(start + 1),
    view.getUint8(start + 2), view.getUint8(start + 3)
  );
  if (exifHeader !== "Exif") return null;

  const tiffStart = start + 6;
  const byteOrder = view.getUint16(tiffStart);
  const le = byteOrder === 0x4949;

  const ifdOffset = view.getUint32(tiffStart + 4, le);
  const gpsOffset = findGPSIFD(view, tiffStart, tiffStart + ifdOffset, le);
  if (!gpsOffset) return null;

  return readGPSData(view, tiffStart, gpsOffset, le);
}

function findGPSIFD(view, tiffStart, ifdStart, le) {
  try {
    const entries = view.getUint16(ifdStart, le);
    for (let i = 0; i < entries; i++) {
      const entryOffset = ifdStart + 2 + i * 12;
      const tag = view.getUint16(entryOffset, le);
      if (tag === 0x8825) {
        return tiffStart + view.getUint32(entryOffset + 8, le);
      }
    }
  } catch (e) {}
  return null;
}

function readGPSData(view, tiffStart, gpsStart, le) {
  try {
    const entries = view.getUint16(gpsStart, le);
    let lat = null, lon = null, latRef = "N", lonRef = "E";
    let dateStamp = null;

    for (let i = 0; i < entries; i++) {
      const entryOffset = gpsStart + 2 + i * 12;
      const tag = view.getUint16(entryOffset, le);
      const valueOffset = tiffStart + view.getUint32(entryOffset + 8, le);

      if (tag === 1) latRef = String.fromCharCode(view.getUint8(entryOffset + 8));
      if (tag === 3) lonRef = String.fromCharCode(view.getUint8(entryOffset + 8));
      if (tag === 2) lat = readRational(view, valueOffset, le);
      if (tag === 4) lon = readRational(view, valueOffset, le);
      if (tag === 29) {
        let s = "";
        for (let j = 0; j < 10; j++) s += String.fromCharCode(view.getUint8(valueOffset + j));
        dateStamp = s;
      }
    }

    if (lat && lon) {
      const latitude = (lat[0] + lat[1] / 60 + lat[2] / 3600) * (latRef === "S" ? -1 : 1);
      const longitude = (lon[0] + lon[1] / 60 + lon[2] / 3600) * (lonRef === "W" ? -1 : 1);
      return { lat: latitude, lon: longitude, date: dateStamp };
    }
  } catch (e) {}
  return null;
}

function readRational(view, offset, le) {
  return [
    view.getUint32(offset, le) / view.getUint32(offset + 4, le),
    view.getUint32(offset + 8, le) / view.getUint32(offset + 12, le),
    view.getUint32(offset + 16, le) / view.getUint32(offset + 20, le),
  ];
}

async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&accept-language=en`
    );
    const data = await res.json();
    const a = data.address || {};
    const city = a.city || a.town || a.village || a.county || "";
    const country = a.country || "";
    return { city, country, display: city ? `${city}, ${country}` : country };
  } catch {
    return { city: "", country: "", display: `${lat.toFixed(2)}, ${lon.toFixed(2)}` };
  }
}

function fileToBase64(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function SlippyMap({ pins, center, zoom }) {
  const containerRef = useRef(null);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const [mapState, setMapState] = useState({ center, zoom });
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [hoveredPin, setHoveredPin] = useState(null);

  useEffect(() => {
    setMapState({ center, zoom });
  }, [center, zoom]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const z = mapState.zoom;
  const cp = degToNum(mapState.center.lat, mapState.center.lon, z);
  const tileSize = 256;
  const tilesX = Math.ceil(size.w / tileSize) + 2;
  const tilesY = Math.ceil(size.h / tileSize) + 2;

  const centerPixelX = cp.x * tileSize;
  const centerPixelY = cp.y * tileSize;
  const topLeftPixelX = centerPixelX - size.w / 2;
  const topLeftPixelY = centerPixelY - size.h / 2;

  const startTileX = Math.floor(topLeftPixelX / tileSize);
  const startTileY = Math.floor(topLeftPixelY / tileSize);
  const offsetX = -(topLeftPixelX % tileSize);
  const offsetY = -(topLeftPixelY % tileSize);

  const n = Math.pow(2, z);
  const tiles = [];
  for (let dy = 0; dy < tilesY; dy++) {
    for (let dx = 0; dx < tilesX; dx++) {
      const tx = ((startTileX + dx) % n + n) % n;
      const ty = startTileY + dy;
      if (ty < 0 || ty >= n) continue;
      tiles.push({
        key: `${z}-${tx}-${ty}-${dx}-${dy}`,
        url: TILE_URL.replace("{z}", z).replace("{x}", tx).replace("{y}", ty),
        left: offsetX + dx * tileSize,
        top: offsetY + dy * tileSize,
      });
    }
  }

  const pinPositions = pins.map((p) => {
    const pp = degToNum(p.lat, p.lon, z);
    return {
      ...p,
      x: pp.x * tileSize - topLeftPixelX,
      y: pp.y * tileSize - topLeftPixelY,
    };
  });

  const handlePointerDown = (e) => {
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };

    setMapState((prev) => {
      const cp2 = degToNum(prev.center.lat, prev.center.lon, prev.zoom);
      const newX = cp2.x - dx / tileSize;
      const newY = cp2.y - dy / tileSize;
      const newCenter = numToDeg(newX, newY, prev.zoom);
      return { ...prev, center: { lat: newCenter.lat, lon: newCenter.lon } };
    });
  };

  const handlePointerUp = () => { dragging.current = false; };

  const handleWheel = (e) => {
    e.preventDefault();
    setMapState((prev) => {
      const newZoom = Math.max(1, Math.min(18, prev.zoom + (e.deltaY > 0 ? -1 : 1)));
      return { ...prev, zoom: newZoom };
    });
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%", height: "100%", position: "relative", overflow: "hidden",
        cursor: dragging.current ? "grabbing" : "grab", touchAction: "none",
        borderRadius: "16px",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
    >
      {tiles.map((t) => (
        <img
          key={t.key} src={t.url} alt=""
          style={{
            position: "absolute", left: t.left, top: t.top,
            width: tileSize, height: tileSize, pointerEvents: "none",
            imageRendering: "auto",
          }}
          draggable={false}
        />
      ))}

      {pinPositions.map((p, i) => (
        <div key={p.id || i} style={{ position: "absolute", left: p.x, top: p.y, transform: "translate(-50%, -100%)", zIndex: hoveredPin === i ? 20 : 10 }}
          onPointerEnter={() => setHoveredPin(i)}
          onPointerLeave={() => setHoveredPin(null)}
        >
          <svg width="32" height="42" viewBox="0 0 32 42" fill="none">
            <path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 26 16 26s16-14 16-26C32 7.16 24.84 0 16 0z" fill="#E63946"/>
            <circle cx="16" cy="15" r="7" fill="white"/>
          </svg>
          {hoveredPin === i && (
            <div style={{
              position: "absolute", bottom: 48, left: "50%", transform: "translateX(-50%)",
              background: "rgba(15,15,15,0.92)", color: "#fff", padding: "8px 14px",
              borderRadius: 10, fontSize: 13, whiteSpace: "nowrap", pointerEvents: "none",
              boxShadow: "0 4px 20px rgba(0,0,0,0.3)", fontFamily: "'DM Sans', sans-serif",
              backdropFilter: "blur(8px)",
            }}>
              <div style={{ fontWeight: 700 }}>{p.place}</div>
              {p.date && <div style={{ opacity: 0.7, fontSize: 11, marginTop: 2 }}>{p.date}</div>}
            </div>
          )}
          {p.thumb && (
            <div style={{
              position: "absolute", bottom: 46, left: "50%", transform: "translateX(-50%)",
              width: 44, height: 44, borderRadius: "50%", overflow: "hidden",
              border: "3px solid white", boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
              display: hoveredPin === i ? "none" : "block",
            }}>
              <img src={p.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} draggable={false} />
            </div>
          )}
        </div>
      ))}

      <div style={{
        position: "absolute", bottom: 8, right: 8, display: "flex", flexDirection: "column", gap: 4, zIndex: 30,
      }}>
        <button onClick={() => setMapState(p => ({ ...p, zoom: Math.min(18, p.zoom + 1) }))}
          style={zoomBtnStyle}>+</button>
        <button onClick={() => setMapState(p => ({ ...p, zoom: Math.max(1, p.zoom - 1) }))}
          style={zoomBtnStyle}>−</button>
      </div>

      <div style={{
        position: "absolute", bottom: 4, left: 8, fontSize: 10, opacity: 0.6,
        color: "#333", fontFamily: "sans-serif", zIndex: 30,
      }}>
        © OpenStreetMap
      </div>
    </div>
  );
}

const zoomBtnStyle = {
  width: 36, height: 36, border: "none", borderRadius: 10,
  background: "rgba(255,255,255,0.92)", cursor: "pointer",
  fontSize: 20, fontWeight: 700, color: "#333",
  boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
  backdropFilter: "blur(4px)", display: "flex",
  alignItems: "center", justifyContent: "center",
};

export default function TravelMap() {
  const [pins, setPins] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [center, setCenter] = useState({ lat: 1.35, lon: 103.82 });
  const [zoom, setZoom] = useState(3);
  const [selectedPin, setSelectedPin] = useState(null);
  const [stats, setStats] = useState({ countries: 0, cities: 0 });
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef(null);

  // ─── Load saved pins from Supabase on startup ───
  useEffect(() => {
    async function loadPins() {
      try {
        const { data, error } = await supabase
          .from("locations")
          .select("*")
          .order("created_at", { ascending: true });

        if (error) {
          console.error("Error loading pins:", error);
          setLoading(false);
          return;
        }

        if (data && data.length > 0) {
          const loaded = data.map((row) => ({
            id: row.id,
            lat: row.lat,
            lon: row.lon,
            place: row.place || "Unknown",
            city: row.city || "",
            country: row.country || "",
            date: row.date || null,
            thumb: row.photo_url || null,
            fileName: row.file_name || "",
          }));
          setPins(loaded);

          // Fit map to loaded pins
          const lats = loaded.map(p => p.lat);
          const lons = loaded.map(p => p.lon);
          if (loaded.length === 1) {
            setCenter({ lat: loaded[0].lat, lon: loaded[0].lon });
            setZoom(10);
          } else {
            setCenter({
              lat: (Math.min(...lats) + Math.max(...lats)) / 2,
              lon: (Math.min(...lons) + Math.max(...lons)) / 2,
            });
            const diff = Math.max(
              Math.max(...lats) - Math.min(...lats),
              Math.max(...lons) - Math.min(...lons)
            );
            setZoom(diff > 100 ? 2 : diff > 50 ? 3 : diff > 20 ? 4 : diff > 5 ? 6 : diff > 1 ? 8 : 11);
          }
        }
      } catch (err) {
        console.error("Failed to load pins:", err);
      }
      setLoading(false);
    }
    loadPins();
  }, []);

  useEffect(() => {
    const countries = new Set(pins.map(p => p.country).filter(Boolean));
    const cities = new Set(pins.map(p => p.city).filter(Boolean));
    setStats({ countries: countries.size, cities: cities.size });
  }, [pins]);

  const processFiles = useCallback(async (files) => {
    setProcessing(true);
    const imageFiles = Array.from(files).filter(f => f.type.startsWith("image/"));
    const newPins = [];

    for (const file of imageFiles) {
      const gps = await parseExifGPS(file);
      if (gps && gps.lat && gps.lon) {
        const geo = await reverseGeocode(gps.lat, gps.lon);

        // Convert image to base64 for thumbnail & storage
        const base64 = await fileToBase64(file);

        // Save to Supabase
        const { data, error } = await supabase
          .from("locations")
          .insert({
            lat: gps.lat,
            lon: gps.lon,
            place: geo.display || "Unknown",
            city: geo.city || "",
            country: geo.country || "",
            date: gps.date || null,
            photo_url: base64,
            file_name: file.name,
          })
          .select()
          .single();

        if (error) {
          console.error("Error saving to Supabase:", error);
          continue;
        }

        newPins.push({
          id: data.id,
          lat: gps.lat,
          lon: gps.lon,
          place: geo.display || "Unknown",
          city: geo.city,
          country: geo.country,
          date: gps.date || null,
          thumb: base64,
          fileName: file.name,
        });
      }
    }

    if (newPins.length > 0) {
      setPins(prev => {
        const all = [...prev, ...newPins];
        if (all.length === 1) {
          setCenter({ lat: all[0].lat, lon: all[0].lon });
          setZoom(10);
        } else {
          const lats = all.map(p => p.lat);
          const lons = all.map(p => p.lon);
          setCenter({
            lat: (Math.min(...lats) + Math.max(...lats)) / 2,
            lon: (Math.min(...lons) + Math.max(...lons)) / 2,
          });
          const latDiff = Math.max(...lats) - Math.min(...lats);
          const lonDiff = Math.max(...lons) - Math.min(...lons);
          const diff = Math.max(latDiff, lonDiff);
          setZoom(diff > 100 ? 2 : diff > 50 ? 3 : diff > 20 ? 4 : diff > 5 ? 6 : diff > 1 ? 8 : 11);
        }
        return all;
      });
    }

    if (newPins.length === 0 && imageFiles.length > 0) {
      alert(`No GPS data found in ${imageFiles.length} image(s). Make sure your photos were taken with location services enabled.`);
    }

    setProcessing(false);
  }, []);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    processFiles(e.dataTransfer.files);
  };

  const clearAll = async () => {
    // Delete all from Supabase
    const ids = pins.map(p => p.id);
    if (ids.length > 0) {
      const { error } = await supabase
        .from("locations")
        .delete()
        .in("id", ids);
      if (error) console.error("Error deleting:", error);
    }
    setPins([]);
    setSelectedPin(null);
    setCenter({ lat: 1.35, lon: 103.82 });
    setZoom(3);
  };

  const sortedPins = [...pins].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });

  return (
    <div style={{
      width: "100%", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif",
      background: "linear-gradient(160deg, #0a0a0f 0%, #12121f 40%, #0f1923 100%)",
      color: "#e8e6e1", position: "relative", overflow: "hidden",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet" />

      {/* Ambient glow */}
      <div style={{
        position: "fixed", top: "-20%", right: "-10%", width: "50vw", height: "50vw",
        background: "radial-gradient(circle, rgba(230,57,70,0.06) 0%, transparent 70%)",
        pointerEvents: "none", zIndex: 0,
      }} />

      {/* Header */}
      <header style={{
        padding: "28px 32px 20px", display: "flex", alignItems: "center",
        justifyContent: "space-between", position: "relative", zIndex: 10,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div>
          <h1 style={{
            fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 800,
            margin: 0, letterSpacing: "-0.5px",
            background: "linear-gradient(135deg, #e8e6e1 0%, #a8a29e 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            Footprint
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.4, letterSpacing: "0.5px" }}>
            YOUR TRAVEL STORY, MAPPED
          </p>
        </div>

        {pins.length > 0 && (
          <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#E63946" }}>{stats.countries}</div>
              <div style={{ fontSize: 10, opacity: 0.4, letterSpacing: "1px" }}>COUNTRIES</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#E63946" }}>{stats.cities}</div>
              <div style={{ fontSize: 10, opacity: 0.4, letterSpacing: "1px" }}>CITIES</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#E63946" }}>{pins.length}</div>
              <div style={{ fontSize: 10, opacity: 0.4, letterSpacing: "1px" }}>PHOTOS</div>
            </div>
            <button onClick={clearAll} style={{
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
              color: "#e8e6e1", padding: "8px 16px", borderRadius: 10, cursor: "pointer",
              fontSize: 12, fontFamily: "'DM Sans', sans-serif", marginLeft: 8,
            }}>Clear All</button>
          </div>
        )}
      </header>

      {/* Main content */}
      <div style={{
        display: "flex", height: "calc(100vh - 90px)", position: "relative", zIndex: 5,
      }}>
        {/* Sidebar */}
        <div style={{
          width: pins.length > 0 ? 320 : 0, minWidth: pins.length > 0 ? 320 : 0,
          overflow: "hidden", transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
          borderRight: pins.length > 0 ? "1px solid rgba(255,255,255,0.06)" : "none",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{
            padding: "20px 20px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}>
            <h2 style={{ margin: 0, fontSize: 14, letterSpacing: "1px", opacity: 0.5, fontWeight: 600 }}>
              TIMELINE
            </h2>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
            {sortedPins.map((pin, i) => (
              <div key={pin.id}
                onClick={() => {
                  setSelectedPin(pin.id);
                  setCenter({ lat: pin.lat, lon: pin.lon });
                  setZoom(12);
                }}
                style={{
                  display: "flex", gap: 12, padding: "12px 20px", cursor: "pointer",
                  background: selectedPin === pin.id ? "rgba(230,57,70,0.1)" : "transparent",
                  borderLeft: selectedPin === pin.id ? "3px solid #E63946" : "3px solid transparent",
                  transition: "all 0.2s ease",
                }}
              >
                <div style={{
                  width: 48, height: 48, borderRadius: 10, overflow: "hidden", flexShrink: 0,
                  border: "2px solid rgba(255,255,255,0.1)",
                }}>
                  {pin.thumb && <img src={pin.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{pin.place}</div>
                  {pin.date && (
                    <div style={{ fontSize: 11, opacity: 0.4 }}>{pin.date}</div>
                  )}
                  <div style={{ fontSize: 11, opacity: 0.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {pin.fileName}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Map area */}
        <div style={{ flex: 1, position: "relative" }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <SlippyMap pins={pins} center={center} zoom={zoom} />

          {/* Loading state */}
          {loading && (
            <div style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center",
              justifyContent: "center", zIndex: 25,
              background: "rgba(10,10,15,0.8)", backdropFilter: "blur(4px)",
            }}>
              <div style={{ textAlign: "center" }}>
                <div style={{
                  width: 32, height: 32, border: "3px solid rgba(230,57,70,0.3)",
                  borderTop: "3px solid #E63946", borderRadius: "50%",
                  animation: "spin 0.8s linear infinite", margin: "0 auto 16px",
                }} />
                <div style={{ fontSize: 16, opacity: 0.7 }}>Loading your travels...</div>
              </div>
            </div>
          )}

          {/* Upload overlay / button */}
          {!loading && pins.length === 0 && !processing && (
            <div style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center",
              justifyContent: "center", zIndex: 20,
              background: "rgba(10,10,15,0.7)", backdropFilter: "blur(4px)",
            }}>
              <div style={{
                textAlign: "center", padding: 48,
                border: "2px dashed rgba(255,255,255,0.15)", borderRadius: 24,
                background: "rgba(255,255,255,0.03)", maxWidth: 420,
              }}>
                <div style={{ fontSize: 56, marginBottom: 16 }}>🌍</div>
                <h2 style={{
                  fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 800,
                  margin: "0 0 8px",
                }}>
                  Drop your photos here
                </h2>
                <p style={{ fontSize: 14, opacity: 0.5, margin: "0 0 24px", lineHeight: 1.6 }}>
                  Upload photos with GPS data and watch<br />your travels appear on the map
                </p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    background: "#E63946", color: "white", border: "none",
                    padding: "14px 36px", borderRadius: 12, fontSize: 15, fontWeight: 600,
                    cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                    boxShadow: "0 4px 20px rgba(230,57,70,0.3)",
                    transition: "transform 0.2s ease",
                  }}
                  onMouseEnter={e => e.target.style.transform = "scale(1.05)"}
                  onMouseLeave={e => e.target.style.transform = "scale(1)"}
                >
                  Choose Photos
                </button>
              </div>
            </div>
          )}

          {/* Floating upload button when pins exist */}
          {pins.length > 0 && (
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                position: "absolute", top: 16, left: 16, zIndex: 30,
                background: "rgba(230,57,70,0.92)", color: "white", border: "none",
                padding: "10px 20px", borderRadius: 12, fontSize: 13, fontWeight: 600,
                cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                boxShadow: "0 4px 16px rgba(230,57,70,0.3)",
                backdropFilter: "blur(8px)",
                display: "flex", alignItems: "center", gap: 8,
              }}
            >
              <span style={{ fontSize: 18 }}>+</span> Add Photos
            </button>
          )}

          {/* Drag overlay */}
          {dragOver && (
            <div style={{
              position: "absolute", inset: 0, zIndex: 40,
              background: "rgba(230,57,70,0.15)", backdropFilter: "blur(8px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              border: "3px dashed #E63946", borderRadius: 16, margin: 8,
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#E63946" }}>
                Drop photos here
              </div>
            </div>
          )}

          {/* Processing indicator */}
          {processing && (
            <div style={{
              position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)",
              zIndex: 50, background: "rgba(15,15,15,0.92)", color: "#e8e6e1",
              padding: "12px 24px", borderRadius: 12, fontSize: 14,
              boxShadow: "0 4px 20px rgba(0,0,0,0.4)", backdropFilter: "blur(8px)",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{
                width: 16, height: 16, border: "2px solid rgba(230,57,70,0.3)",
                borderTop: "2px solid #E63946", borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }} />
              Reading GPS data from your photos...
            </div>
          )}

          <input
            ref={fileInputRef} type="file" multiple accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => processFiles(e.target.files)}
          />
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
      `}</style>
    </div>
  );
}
