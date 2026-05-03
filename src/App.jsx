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
          resolve(parseExif(view, offset + 4));
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
  const h = String.fromCharCode(view.getUint8(start), view.getUint8(start+1), view.getUint8(start+2), view.getUint8(start+3));
  if (h !== "Exif") return null;
  const tiffStart = start + 6;
  const le = view.getUint16(tiffStart) === 0x4949;
  const ifdOffset = view.getUint32(tiffStart + 4, le);
  const gpsOffset = findGPSIFD(view, tiffStart, tiffStart + ifdOffset, le);
  if (!gpsOffset) return null;
  return readGPSData(view, tiffStart, gpsOffset, le);
}

function findGPSIFD(view, tiffStart, ifdStart, le) {
  try {
    const entries = view.getUint16(ifdStart, le);
    for (let i = 0; i < entries; i++) {
      const off = ifdStart + 2 + i * 12;
      if (view.getUint16(off, le) === 0x8825) return tiffStart + view.getUint32(off + 8, le);
    }
  } catch (e) {}
  return null;
}

function readGPSData(view, tiffStart, gpsStart, le) {
  try {
    const entries = view.getUint16(gpsStart, le);
    let lat = null, lon = null, latRef = "N", lonRef = "E", dateStamp = null;
    for (let i = 0; i < entries; i++) {
      const off = gpsStart + 2 + i * 12;
      const tag = view.getUint16(off, le);
      const valOff = tiffStart + view.getUint32(off + 8, le);
      if (tag === 1) latRef = String.fromCharCode(view.getUint8(off + 8));
      if (tag === 3) lonRef = String.fromCharCode(view.getUint8(off + 8));
      if (tag === 2) lat = readRational(view, valOff, le);
      if (tag === 4) lon = readRational(view, valOff, le);
      if (tag === 29) { let s = ""; for (let j = 0; j < 10; j++) s += String.fromCharCode(view.getUint8(valOff + j)); dateStamp = s; }
    }
    if (lat && lon) {
      return {
        lat: (lat[0] + lat[1]/60 + lat[2]/3600) * (latRef === "S" ? -1 : 1),
        lon: (lon[0] + lon[1]/60 + lon[2]/3600) * (lonRef === "W" ? -1 : 1),
        date: dateStamp
      };
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
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&accept-language=en`);
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

// ─── Auth Screen ───
function AuthScreen({ onAuth }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);

  const handleSubmit = async () => {
    setError("");
    setLoading(true);

    if (!email || !password) {
      setError("Please fill in both fields");
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      setLoading(false);
      return;
    }

    try {
      if (isLogin) {
        const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) {
          setError(authError.message);
        } else {
          onAuth(data.user);
        }
      } else {
        const { data, error: authError } = await supabase.auth.signUp({ email, password });
        if (authError) {
          setError(authError.message);
        } else if (data.user && !data.user.confirmed_at && !data.session) {
          setConfirmSent(true);
        } else {
          onAuth(data.user);
        }
      }
    } catch (err) {
      setError("Something went wrong. Please try again.");
    }
    setLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSubmit();
  };

  if (confirmSent) {
    return (
      <div style={authContainerStyle}>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet" />
        <div style={authCardStyle}>
          <div style={{ fontSize: 48, marginBottom: 16, textAlign: "center" }}>📧</div>
          <h2 style={{ ...authTitleStyle, fontSize: 22 }}>Check your email</h2>
          <p style={{ opacity: 0.5, fontSize: 14, textAlign: "center", lineHeight: 1.6 }}>
            We sent a confirmation link to <strong>{email}</strong>. Click the link to activate your account, then come back and log in.
          </p>
          <button onClick={() => { setConfirmSent(false); setIsLogin(true); }} style={authBtnStyle}>
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={authContainerStyle}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet" />
      <div style={{
        position: "fixed", top: "-20%", right: "-10%", width: "50vw", height: "50vw",
        background: "radial-gradient(circle, rgba(230,57,70,0.08) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />
      <div style={{
        position: "fixed", bottom: "-20%", left: "-10%", width: "40vw", height: "40vw",
        background: "radial-gradient(circle, rgba(230,57,70,0.05) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      <div style={authCardStyle}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🌍</div>
          <h1 style={{
            fontFamily: "'Playfair Display', serif", fontSize: 32, fontWeight: 800,
            margin: 0, background: "linear-gradient(135deg, #e8e6e1 0%, #a8a29e 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            Footprint
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: 12, opacity: 0.4, letterSpacing: "1px" }}>
            YOUR TRAVEL STORY, MAPPED
          </p>
        </div>

        <h2 style={authTitleStyle}>{isLogin ? "Welcome back" : "Create account"}</h2>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            style={inputStyle}
          />
        </div>

        {error && (
          <div style={{
            background: "rgba(230,57,70,0.1)", border: "1px solid rgba(230,57,70,0.3)",
            color: "#E63946", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginTop: 12,
          }}>
            {error}
          </div>
        )}

        <button onClick={handleSubmit} disabled={loading} style={{
          ...authBtnStyle,
          marginTop: 16,
          opacity: loading ? 0.6 : 1,
          cursor: loading ? "not-allowed" : "pointer",
        }}>
          {loading ? "Please wait..." : isLogin ? "Log In" : "Sign Up"}
        </button>

        <div style={{ textAlign: "center", marginTop: 20 }}>
          <span style={{ opacity: 0.4, fontSize: 13 }}>
            {isLogin ? "Don't have an account? " : "Already have an account? "}
          </span>
          <button
            onClick={() => { setIsLogin(!isLogin); setError(""); }}
            style={{
              background: "none", border: "none", color: "#E63946",
              cursor: "pointer", fontSize: 13, fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif", padding: 0,
            }}
          >
            {isLogin ? "Sign Up" : "Log In"}
          </button>
        </div>
      </div>
    </div>
  );
}

const authContainerStyle = {
  width: "100%", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif",
  background: "linear-gradient(160deg, #0a0a0f 0%, #12121f 40%, #0f1923 100%)",
  color: "#e8e6e1", display: "flex", alignItems: "center", justifyContent: "center",
  position: "relative", overflow: "hidden",
};

const authCardStyle = {
  width: "100%", maxWidth: 400, padding: "40px 36px",
  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 20, backdropFilter: "blur(12px)", position: "relative", zIndex: 10,
};

const authTitleStyle = {
  fontFamily: "'DM Sans', sans-serif", fontSize: 18, fontWeight: 600,
  margin: "0 0 20px", textAlign: "center", opacity: 0.8,
};

const inputStyle = {
  width: "100%", padding: "14px 16px", background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12,
  color: "#e8e6e1", fontSize: 14, fontFamily: "'DM Sans', sans-serif",
  outline: "none", boxSizing: "border-box",
  transition: "border-color 0.2s ease",
};

const authBtnStyle = {
  width: "100%", padding: "14px", background: "#E63946", color: "white",
  border: "none", borderRadius: 12, fontSize: 15, fontWeight: 600,
  cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
  boxShadow: "0 4px 20px rgba(230,57,70,0.3)",
};

// ─── Map Component ───
function SlippyMap({ pins, center, zoom }) {
  const containerRef = useRef(null);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const [mapState, setMapState] = useState({ center, zoom });
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [hoveredPin, setHoveredPin] = useState(null);

  useEffect(() => { setMapState({ center, zoom }); }, [center, zoom]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
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
        left: offsetX + dx * tileSize, top: offsetY + dy * tileSize,
      });
    }
  }

  const pinPositions = pins.map((p) => {
    const pp = degToNum(p.lat, p.lon, z);
    return { ...p, x: pp.x * tileSize - topLeftPixelX, y: pp.y * tileSize - topLeftPixelY };
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
      const nc = numToDeg(cp2.x - dx / tileSize, cp2.y - dy / tileSize, prev.zoom);
      return { ...prev, center: { lat: nc.lat, lon: nc.lon } };
    });
  };

  const handlePointerUp = () => { dragging.current = false; };
  const handleWheel = (e) => {
    e.preventDefault();
    setMapState((prev) => ({ ...prev, zoom: Math.max(1, Math.min(18, prev.zoom + (e.deltaY > 0 ? -1 : 1))) }));
  };

  return (
    <div ref={containerRef} style={{
      width: "100%", height: "100%", position: "relative", overflow: "hidden",
      cursor: dragging.current ? "grabbing" : "grab", touchAction: "none", borderRadius: "16px",
    }}
      onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp} onWheel={handleWheel}
    >
      {tiles.map((t) => (
        <img key={t.key} src={t.url} alt="" style={{
          position: "absolute", left: t.left, top: t.top, width: tileSize, height: tileSize,
          pointerEvents: "none",
        }} draggable={false} />
      ))}

      {pinPositions.map((p, i) => (
        <div key={p.id || i} style={{
          position: "absolute", left: p.x, top: p.y, transform: "translate(-50%, -100%)",
          zIndex: hoveredPin === i ? 20 : 10,
        }}
          onPointerEnter={() => setHoveredPin(i)} onPointerLeave={() => setHoveredPin(null)}
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

      <div style={{ position: "absolute", bottom: 8, right: 8, display: "flex", flexDirection: "column", gap: 4, zIndex: 30 }}>
        <button onClick={() => setMapState(p => ({ ...p, zoom: Math.min(18, p.zoom + 1) }))} style={zoomBtnStyle}>+</button>
        <button onClick={() => setMapState(p => ({ ...p, zoom: Math.max(1, p.zoom - 1) }))} style={zoomBtnStyle}>−</button>
      </div>
      <div style={{ position: "absolute", bottom: 4, left: 8, fontSize: 10, opacity: 0.6, color: "#333", zIndex: 30 }}>© OpenStreetMap</div>
    </div>
  );
}

const zoomBtnStyle = {
  width: 36, height: 36, border: "none", borderRadius: 10,
  background: "rgba(255,255,255,0.92)", cursor: "pointer",
  fontSize: 20, fontWeight: 700, color: "#333",
  boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
  display: "flex", alignItems: "center", justifyContent: "center",
};

// ─── Main App ───
export default function App() {
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [pins, setPins] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [center, setCenter] = useState({ lat: 1.35, lon: 103.82 });
  const [zoom, setZoom] = useState(3);
  const [selectedPin, setSelectedPin] = useState(null);
  const [stats, setStats] = useState({ countries: 0, cities: 0 });
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);

  // Check if user is already logged in
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setCheckingAuth(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load pins when user logs in
  useEffect(() => {
    if (!user) { setPins([]); return; }

    async function loadPins() {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("locations")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true });

        if (error) { console.error("Error loading:", error); setLoading(false); return; }

        if (data && data.length > 0) {
          const loaded = data.map((row) => ({
            id: row.id, lat: row.lat, lon: row.lon,
            place: row.place || "Unknown", city: row.city || "",
            country: row.country || "", date: row.date || null,
            thumb: row.photo_url || null, fileName: row.file_name || "",
          }));
          setPins(loaded);
          fitMapToPins(loaded);
        }
      } catch (err) { console.error("Failed to load:", err); }
      setLoading(false);
    }
    loadPins();
  }, [user]);

  useEffect(() => {
    const countries = new Set(pins.map(p => p.country).filter(Boolean));
    const cities = new Set(pins.map(p => p.city).filter(Boolean));
    setStats({ countries: countries.size, cities: cities.size });
  }, [pins]);

  const fitMapToPins = (allPins) => {
    if (allPins.length === 1) {
      setCenter({ lat: allPins[0].lat, lon: allPins[0].lon });
      setZoom(10);
    } else if (allPins.length > 1) {
      const lats = allPins.map(p => p.lat);
      const lons = allPins.map(p => p.lon);
      setCenter({
        lat: (Math.min(...lats) + Math.max(...lats)) / 2,
        lon: (Math.min(...lons) + Math.max(...lons)) / 2,
      });
      const diff = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons));
      setZoom(diff > 100 ? 2 : diff > 50 ? 3 : diff > 20 ? 4 : diff > 5 ? 6 : diff > 1 ? 8 : 11);
    }
  };

  const processFiles = useCallback(async (files) => {
    if (!user) return;
    setProcessing(true);
    const imageFiles = Array.from(files).filter(f => f.type.startsWith("image/"));
    const newPins = [];

    for (const file of imageFiles) {
      const gps = await parseExifGPS(file);
      if (gps && gps.lat && gps.lon) {
        const geo = await reverseGeocode(gps.lat, gps.lon);
        const base64 = await fileToBase64(file);

        const { data, error } = await supabase
          .from("locations")
          .insert({
            lat: gps.lat, lon: gps.lon,
            place: geo.display || "Unknown",
            city: geo.city || "", country: geo.country || "",
            date: gps.date || null, photo_url: base64,
            file_name: file.name, user_id: user.id,
          })
          .select().single();

        if (error) { console.error("Error saving:", error); continue; }

        newPins.push({
          id: data.id, lat: gps.lat, lon: gps.lon,
          place: geo.display || "Unknown", city: geo.city,
          country: geo.country, date: gps.date || null,
          thumb: base64, fileName: file.name,
        });
      }
    }

    if (newPins.length > 0) {
      setPins(prev => {
        const all = [...prev, ...newPins];
        fitMapToPins(all);
        return all;
      });
    }

    if (newPins.length === 0 && imageFiles.length > 0) {
      alert(`No GPS data found in ${imageFiles.length} image(s). Make sure your photos were taken with location services enabled.`);
    }
    setProcessing(false);
  }, [user]);

  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); processFiles(e.dataTransfer.files); };

  const clearAll = async () => {
    const ids = pins.map(p => p.id);
    if (ids.length > 0) {
      await supabase.from("locations").delete().in("id", ids);
    }
    setPins([]);
    setSelectedPin(null);
    setCenter({ lat: 1.35, lon: 103.82 });
    setZoom(3);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setPins([]);
    setUser(null);
  };

  const sortedPins = [...pins].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });

  // Show loading while checking auth
  if (checkingAuth) {
    return (
      <div style={{
        width: "100%", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif",
        background: "linear-gradient(160deg, #0a0a0f 0%, #12121f 40%, #0f1923 100%)",
        color: "#e8e6e1", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet" />
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 32, height: 32, border: "3px solid rgba(230,57,70,0.3)",
            borderTop: "3px solid #E63946", borderRadius: "50%",
            animation: "spin 0.8s linear infinite", margin: "0 auto 16px",
          }} />
          <div style={{ opacity: 0.5 }}>Loading...</div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Show auth screen if not logged in
  if (!user) {
    return <AuthScreen onAuth={setUser} />;
  }

  // Main app
  return (
    <div style={{
      width: "100%", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif",
      background: "linear-gradient(160deg, #0a0a0f 0%, #12121f 40%, #0f1923 100%)",
      color: "#e8e6e1", position: "relative", overflow: "hidden",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet" />

      <div style={{
        position: "fixed", top: "-20%", right: "-10%", width: "50vw", height: "50vw",
        background: "radial-gradient(circle, rgba(230,57,70,0.06) 0%, transparent 70%)",
        pointerEvents: "none", zIndex: 0,
      }} />

      {/* Header */}
      <header style={{
        padding: "20px 32px", display: "flex", alignItems: "center",
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

        <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
          {pins.length > 0 && (
            <>
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
                fontSize: 12, fontFamily: "'DM Sans', sans-serif",
              }}>Clear All</button>
            </>
          )}

          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            paddingLeft: pins.length > 0 ? 16 : 0,
            borderLeft: pins.length > 0 ? "1px solid rgba(255,255,255,0.1)" : "none",
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%", background: "#E63946",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 700, color: "white",
            }}>
              {user.email?.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 12, opacity: 0.6, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {user.email}
              </div>
            </div>
            <button onClick={handleLogout} style={{
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
              color: "#e8e6e1", padding: "6px 12px", borderRadius: 8, cursor: "pointer",
              fontSize: 11, fontFamily: "'DM Sans', sans-serif",
            }}>
              Log out
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div style={{ display: "flex", height: "calc(100vh - 80px)", position: "relative", zIndex: 5 }}>
        {/* Sidebar */}
        <div style={{
          width: pins.length > 0 ? 320 : 0, minWidth: pins.length > 0 ? 320 : 0,
          overflow: "hidden", transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
          borderRight: pins.length > 0 ? "1px solid rgba(255,255,255,0.06)" : "none",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{ padding: "20px 20px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <h2 style={{ margin: 0, fontSize: 14, letterSpacing: "1px", opacity: 0.5, fontWeight: 600 }}>TIMELINE</h2>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
            {sortedPins.map((pin) => (
              <div key={pin.id}
                onClick={() => { setSelectedPin(pin.id); setCenter({ lat: pin.lat, lon: pin.lon }); setZoom(12); }}
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
                  {pin.date && <div style={{ fontSize: 11, opacity: 0.4 }}>{pin.date}</div>}
                  <div style={{ fontSize: 11, opacity: 0.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pin.fileName}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Map area */}
        <div style={{ flex: 1, position: "relative" }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)} onDrop={handleDrop}
        >
          <SlippyMap pins={pins} center={center} zoom={zoom} />

          {loading && (
            <div style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 25, background: "rgba(10,10,15,0.8)",
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

          {!loading && pins.length === 0 && !processing && (
            <div style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 20, background: "rgba(10,10,15,0.7)", backdropFilter: "blur(4px)",
            }}>
              <div style={{
                textAlign: "center", padding: 48, border: "2px dashed rgba(255,255,255,0.15)",
                borderRadius: 24, background: "rgba(255,255,255,0.03)", maxWidth: 420,
              }}>
                <div style={{ fontSize: 56, marginBottom: 16 }}>🌍</div>
                <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 800, margin: "0 0 8px" }}>
                  Drop your photos here
                </h2>
                <p style={{ fontSize: 14, opacity: 0.5, margin: "0 0 24px", lineHeight: 1.6 }}>
                  Upload photos with GPS data and watch<br />your travels appear on the map
                </p>
                <button onClick={() => fileInputRef.current?.click()} style={{
                  background: "#E63946", color: "white", border: "none", padding: "14px 36px",
                  borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif", boxShadow: "0 4px 20px rgba(230,57,70,0.3)",
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

          {pins.length > 0 && (
            <button onClick={() => fileInputRef.current?.click()} style={{
              position: "absolute", top: 16, left: 16, zIndex: 30,
              background: "rgba(230,57,70,0.92)", color: "white", border: "none",
              padding: "10px 20px", borderRadius: 12, fontSize: 13, fontWeight: 600,
              cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
              boxShadow: "0 4px 16px rgba(230,57,70,0.3)",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{ fontSize: 18 }}>+</span> Add Photos
            </button>
          )}

          {dragOver && (
            <div style={{
              position: "absolute", inset: 0, zIndex: 40,
              background: "rgba(230,57,70,0.15)", backdropFilter: "blur(8px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              border: "3px dashed #E63946", borderRadius: 16, margin: 8,
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#E63946" }}>Drop photos here</div>
            </div>
          )}

          {processing && (
            <div style={{
              position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)",
              zIndex: 50, background: "rgba(15,15,15,0.92)", color: "#e8e6e1",
              padding: "12px 24px", borderRadius: 12, fontSize: 14,
              boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
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

          <input ref={fileInputRef} type="file" multiple accept="image/*" style={{ display: "none" }}
            onChange={(e) => processFiles(e.target.files)} />
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
