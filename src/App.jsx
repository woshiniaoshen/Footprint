import { useState, useRef, useCallback, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://dhywbdwveorpkurckflb.supabase.co",
  "sb_publishable_lFvJV3GM4cuzZ4GMTvUyVw_c-Am1bZU"
);

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

// ─── Geo Helpers ───
function degToNum(lat, lon, zoom) {
  const n = Math.pow(2, zoom);
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n };
}
function numToDeg(x, y, zoom) {
  const n = Math.pow(2, zoom);
  return { lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI, lon: (x / n) * 360 - 180 };
}

// ─── EXIF Parser ───
function parseExifGPS(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const view = new DataView(e.target.result);
      if (view.getUint16(0) !== 0xffd8) return resolve(null);
      let offset = 2;
      while (offset < view.byteLength - 1) {
        if (view.getUint16(offset) === 0xffe1) { resolve(parseExif(view, offset + 4)); return; }
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
  const ts = start + 6; const le = view.getUint16(ts) === 0x4949;
  const go = findGPSIFD(view, ts, ts + view.getUint32(ts + 4, le), le);
  return go ? readGPSData(view, ts, go, le) : null;
}
function findGPSIFD(view, ts, is, le) {
  try { const e = view.getUint16(is, le); for (let i = 0; i < e; i++) { const o = is + 2 + i * 12; if (view.getUint16(o, le) === 0x8825) return ts + view.getUint32(o + 8, le); } } catch (e) {} return null;
}
function readGPSData(view, ts, gs, le) {
  try {
    const e = view.getUint16(gs, le); let lat = null, lon = null, lr = "N", lnr = "E", ds = null;
    for (let i = 0; i < e; i++) {
      const o = gs + 2 + i * 12, tag = view.getUint16(o, le), vo = ts + view.getUint32(o + 8, le);
      if (tag === 1) lr = String.fromCharCode(view.getUint8(o + 8));
      if (tag === 3) lnr = String.fromCharCode(view.getUint8(o + 8));
      if (tag === 2) lat = readR(view, vo, le); if (tag === 4) lon = readR(view, vo, le);
      if (tag === 29) { let s = ""; for (let j = 0; j < 10; j++) s += String.fromCharCode(view.getUint8(vo + j)); ds = s; }
    }
    if (lat && lon) return { lat: (lat[0]+lat[1]/60+lat[2]/3600)*(lr==="S"?-1:1), lon: (lon[0]+lon[1]/60+lon[2]/3600)*(lnr==="W"?-1:1), date: ds };
  } catch (e) {} return null;
}
function readR(v, o, le) { return [v.getUint32(o,le)/v.getUint32(o+4,le), v.getUint32(o+8,le)/v.getUint32(o+12,le), v.getUint32(o+16,le)/v.getUint32(o+20,le)]; }

async function reverseGeocode(lat, lon) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&accept-language=en`);
    const d = await r.json(); const a = d.address || {};
    const city = a.city||a.town||a.village||a.county||"", country = a.country||"";
    return { city, country, display: city ? `${city}, ${country}` : country };
  } catch { return { city: "", country: "", display: `${lat.toFixed(2)}, ${lon.toFixed(2)}` }; }
}
function fileToBase64(file) { return new Promise((r) => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(file); }); }

// ─── Image Lightbox ───
function Lightbox({ pin, onClose }) {
  if (!pin) return null;
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.85)",
      display: "flex", alignItems: "center", justifyContent: "center",
      backdropFilter: "blur(12px)", cursor: "zoom-out",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        maxWidth: "90vw", maxHeight: "90vh", position: "relative",
        borderRadius: 16, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        <img src={pin.thumb} alt="" style={{ maxWidth: "90vw", maxHeight: "80vh", objectFit: "contain", display: "block" }} />
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          background: "linear-gradient(transparent, rgba(0,0,0,0.8))",
          padding: "40px 24px 20px", color: "white",
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>{pin.place}</div>
          {pin.date && <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4, fontFamily: "'DM Sans', sans-serif" }}>{pin.date}</div>}
          <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2, fontFamily: "'DM Sans', sans-serif" }}>{pin.fileName}</div>
        </div>
        <button onClick={onClose} style={{
          position: "absolute", top: 12, right: 12, width: 36, height: 36,
          borderRadius: "50%", background: "rgba(0,0,0,0.5)", border: "none",
          color: "white", fontSize: 20, cursor: "pointer", display: "flex",
          alignItems: "center", justifyContent: "center",
        }}>×</button>
      </div>
    </div>
  );
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
    setError(""); setLoading(true);
    if (!email || !password) { setError("Please fill in both fields"); setLoading(false); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); setLoading(false); return; }
    try {
      if (isLogin) {
        const { data, error: e } = await supabase.auth.signInWithPassword({ email, password });
        if (e) setError(e.message); else onAuth(data.user);
      } else {
        const { data, error: e } = await supabase.auth.signUp({ email, password });
        if (e) setError(e.message);
        else if (data.user && !data.user.confirmed_at && !data.session) setConfirmSent(true);
        else onAuth(data.user);
      }
    } catch { setError("Something went wrong."); }
    setLoading(false);
  };

  if (confirmSent) return (
    <div style={authContainerStyle}>
      <Fonts />
      <div style={authCardStyle}>
        <div style={{ fontSize: 48, marginBottom: 16, textAlign: "center" }}>📧</div>
        <h2 style={{ ...authTitleStyle, fontSize: 22 }}>Check your email</h2>
        <p style={{ opacity: 0.5, fontSize: 14, textAlign: "center", lineHeight: 1.6 }}>
          We sent a confirmation link to <strong>{email}</strong>. Click the link, then come back and log in.
        </p>
        <button onClick={() => { setConfirmSent(false); setIsLogin(true); }} style={authBtnStyle}>Back to Login</button>
      </div>
    </div>
  );

  return (
    <div style={authContainerStyle}>
      <Fonts />
      <div style={{ position: "fixed", top: "-20%", right: "-10%", width: "50vw", height: "50vw", background: "radial-gradient(circle, rgba(230,57,70,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={authCardStyle}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🌍</div>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 32, fontWeight: 800, margin: 0, background: "linear-gradient(135deg, #e8e6e1 0%, #a8a29e 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Footprint</h1>
          <p style={{ margin: "6px 0 0", fontSize: 12, opacity: 0.4, letterSpacing: "1px" }}>YOUR TRAVEL STORY, MAPPED</p>
        </div>
        <h2 style={authTitleStyle}>{isLogin ? "Welcome back" : "Create account"}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSubmit()} style={inputStyle} />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSubmit()} style={inputStyle} />
        </div>
        {error && <div style={{ background: "rgba(230,57,70,0.1)", border: "1px solid rgba(230,57,70,0.3)", color: "#E63946", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginTop: 12 }}>{error}</div>}
        <button onClick={handleSubmit} disabled={loading} style={{ ...authBtnStyle, marginTop: 16, opacity: loading ? 0.6 : 1 }}>
          {loading ? "Please wait..." : isLogin ? "Log In" : "Sign Up"}
        </button>
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <span style={{ opacity: 0.4, fontSize: 13 }}>{isLogin ? "Don't have an account? " : "Already have an account? "}</span>
          <button onClick={() => { setIsLogin(!isLogin); setError(""); }} style={{ background: "none", border: "none", color: "#E63946", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", padding: 0 }}>
            {isLogin ? "Sign Up" : "Log In"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Username Setup Screen ───
function UsernameSetup({ user, onComplete }) {
  const [username, setUsername] = useState("");
  const [avatar, setAvatar] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const fileRef = useRef(null);

  const checkUsername = async (name) => {
    if (name.length < 3) return;
    setChecking(true);
    const { data } = await supabase.from("profiles").select("id").eq("username", name).single();
    if (data) setError("Username is already taken");
    else setError("");
    setChecking(false);
  };

  const handleUsernameChange = (e) => {
    const val = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
    setUsername(val);
    setError("");
    if (val.length >= 3) {
      clearTimeout(window._usernameTimeout);
      window._usernameTimeout = setTimeout(() => checkUsername(val), 500);
    }
  };

  const handleAvatarSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const b64 = await fileToBase64(file);
    setAvatar(b64);
  };

  const handleSubmit = async () => {
    if (username.length < 3) { setError("Username must be at least 3 characters"); return; }
    if (error) return;
    setLoading(true);
    const { error: insertErr } = await supabase.from("profiles").insert({
      id: user.id, username, avatar_url: avatar,
    });
    if (insertErr) {
      if (insertErr.message.includes("unique") || insertErr.message.includes("duplicate")) setError("Username is already taken");
      else setError(insertErr.message);
      setLoading(false); return;
    }
    onComplete({ username, avatar_url: avatar });
  };

  return (
    <div style={authContainerStyle}>
      <Fonts />
      <div style={{ position: "fixed", top: "-20%", right: "-10%", width: "50vw", height: "50vw", background: "radial-gradient(circle, rgba(230,57,70,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={authCardStyle}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, fontWeight: 800, margin: "0 0 8px" }}>Set up your profile</h2>
          <p style={{ opacity: 0.4, fontSize: 13 }}>Choose a username and profile picture</p>
        </div>

        {/* Avatar picker */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
          <div onClick={() => fileRef.current?.click()} style={{
            width: 96, height: 96, borderRadius: "50%", cursor: "pointer",
            background: avatar ? `url(${avatar}) center/cover` : "rgba(255,255,255,0.06)",
            border: "3px solid rgba(255,255,255,0.15)", display: "flex",
            alignItems: "center", justifyContent: "center", position: "relative",
            transition: "border-color 0.2s",
          }}>
            {!avatar && <span style={{ fontSize: 32, opacity: 0.4 }}>📷</span>}
            <div style={{
              position: "absolute", bottom: -2, right: -2, width: 28, height: 28,
              borderRadius: "50%", background: "#E63946", display: "flex",
              alignItems: "center", justifyContent: "center", fontSize: 14, color: "white",
              border: "2px solid #12121f",
            }}>+</div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleAvatarSelect} />
        </div>

        {/* Username input */}
        <div style={{ position: "relative" }}>
          <div style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", opacity: 0.4, fontSize: 14 }}>@</div>
          <input
            type="text" placeholder="username" value={username}
            onChange={handleUsernameChange}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            style={{ ...inputStyle, paddingLeft: 32 }}
            maxLength={20}
          />
        </div>
        {username.length > 0 && username.length < 3 && <div style={{ fontSize: 12, opacity: 0.4, marginTop: 6 }}>At least 3 characters</div>}
        {checking && <div style={{ fontSize: 12, opacity: 0.4, marginTop: 6 }}>Checking availability...</div>}

        {error && <div style={{ background: "rgba(230,57,70,0.1)", border: "1px solid rgba(230,57,70,0.3)", color: "#E63946", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginTop: 12 }}>{error}</div>}

        {!error && username.length >= 3 && !checking && <div style={{ fontSize: 12, color: "#4ade80", marginTop: 6 }}>✓ Username available</div>}

        <button onClick={handleSubmit} disabled={loading || username.length < 3 || !!error} style={{
          ...authBtnStyle, marginTop: 20,
          opacity: (loading || username.length < 3 || !!error) ? 0.4 : 1,
          cursor: (loading || username.length < 3 || !!error) ? "not-allowed" : "pointer",
        }}>
          {loading ? "Setting up..." : "Continue"}
        </button>
      </div>
    </div>
  );
}

// ─── Edit Profile Modal ───
function EditProfile({ profile, onSave, onClose }) {
  const [username, setUsername] = useState(profile.username);
  const [avatar, setAvatar] = useState(profile.avatar_url);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const fileRef = useRef(null);
  const origUsername = profile.username;

  const checkUsername = async (name) => {
    if (name === origUsername) { setError(""); return; }
    if (name.length < 3) return;
    setChecking(true);
    const { data } = await supabase.from("profiles").select("id").eq("username", name).single();
    if (data) setError("Username is already taken");
    else setError("");
    setChecking(false);
  };

  const handleUsernameChange = (e) => {
    const val = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
    setUsername(val); setError("");
    if (val.length >= 3) {
      clearTimeout(window._editUsernameTimeout);
      window._editUsernameTimeout = setTimeout(() => checkUsername(val), 500);
    }
  };

  const handleAvatarSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const b64 = await fileToBase64(file);
    setAvatar(b64);
  };

  const handleSave = async () => {
    if (username.length < 3) { setError("Username must be at least 3 characters"); return; }
    if (error) return;
    setLoading(true);
    const { error: updateErr } = await supabase.from("profiles").update({
      username, avatar_url: avatar,
    }).eq("id", profile.id);

    if (updateErr) {
      if (updateErr.message.includes("unique") || updateErr.message.includes("duplicate")) setError("Username is already taken");
      else setError(updateErr.message);
      setLoading(false); return;
    }
    onSave({ ...profile, username, avatar_url: avatar });
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 900, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
      backdropFilter: "blur(8px)",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        ...authCardStyle, maxWidth: 420, animation: "fadeIn 0.2s ease",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 20, fontWeight: 700, margin: 0 }}>Edit Profile</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#e8e6e1", fontSize: 24, cursor: "pointer", opacity: 0.5 }}>×</button>
        </div>

        <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
          <div onClick={() => fileRef.current?.click()} style={{
            width: 96, height: 96, borderRadius: "50%", cursor: "pointer",
            background: avatar ? `url(${avatar}) center/cover` : "rgba(255,255,255,0.06)",
            border: "3px solid rgba(255,255,255,0.15)", display: "flex",
            alignItems: "center", justifyContent: "center", position: "relative",
          }}>
            {!avatar && <span style={{ fontSize: 32, opacity: 0.4 }}>📷</span>}
            <div style={{
              position: "absolute", bottom: -2, right: -2, width: 28, height: 28,
              borderRadius: "50%", background: "#E63946", display: "flex",
              alignItems: "center", justifyContent: "center", fontSize: 14, color: "white",
              border: "2px solid #12121f",
            }}>✎</div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleAvatarSelect} />
        </div>

        <div style={{ position: "relative" }}>
          <div style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", opacity: 0.4, fontSize: 14 }}>@</div>
          <input type="text" value={username} onChange={handleUsernameChange} style={{ ...inputStyle, paddingLeft: 32 }} maxLength={20} />
        </div>
        {checking && <div style={{ fontSize: 12, opacity: 0.4, marginTop: 6 }}>Checking availability...</div>}
        {error && <div style={{ background: "rgba(230,57,70,0.1)", border: "1px solid rgba(230,57,70,0.3)", color: "#E63946", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginTop: 12 }}>{error}</div>}
        {!error && username.length >= 3 && !checking && username !== origUsername && <div style={{ fontSize: 12, color: "#4ade80", marginTop: 6 }}>✓ Username available</div>}

        <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
          <button onClick={onClose} style={{ ...authBtnStyle, background: "rgba(255,255,255,0.06)", boxShadow: "none", flex: 1 }}>Cancel</button>
          <button onClick={handleSave} disabled={loading || username.length < 3 || !!error} style={{
            ...authBtnStyle, flex: 1,
            opacity: (loading || username.length < 3 || !!error) ? 0.4 : 1,
          }}>
            {loading ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Map Component ───
function SlippyMap({ pins, center, zoom, onPinClick }) {
  const containerRef = useRef(null);
  const dragging = useRef(false);
  const dragMoved = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const [mapState, setMapState] = useState({ center, zoom });
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [hoveredPin, setHoveredPin] = useState(null);

  useEffect(() => { setMapState({ center, zoom }); }, [center, zoom]);
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const obs = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    obs.observe(el); return () => obs.disconnect();
  }, []);

  const z = mapState.zoom, cp = degToNum(mapState.center.lat, mapState.center.lon, z), tileSize = 256;
  const tilesX = Math.ceil(size.w / tileSize) + 2, tilesY = Math.ceil(size.h / tileSize) + 2;
  const cPX = cp.x * tileSize, cPY = cp.y * tileSize;
  const tlPX = cPX - size.w / 2, tlPY = cPY - size.h / 2;
  const stX = Math.floor(tlPX / tileSize), stY = Math.floor(tlPY / tileSize);
  const oX = -(tlPX % tileSize), oY = -(tlPY % tileSize);
  const n = Math.pow(2, z), tiles = [];
  for (let dy = 0; dy < tilesY; dy++) for (let dx = 0; dx < tilesX; dx++) {
    const tx = ((stX + dx) % n + n) % n, ty = stY + dy;
    if (ty < 0 || ty >= n) continue;
    tiles.push({ key: `${z}-${tx}-${ty}-${dx}-${dy}`, url: TILE_URL.replace("{z}", z).replace("{x}", tx).replace("{y}", ty), left: oX + dx * tileSize, top: oY + dy * tileSize });
  }
  const pinPos = pins.map((p) => { const pp = degToNum(p.lat, p.lon, z); return { ...p, x: pp.x * tileSize - tlPX, y: pp.y * tileSize - tlPY }; });

  const handlePointerDown = (e) => { dragging.current = true; dragMoved.current = false; lastPos.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); };
  const handlePointerMove = (e) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x, dy = e.clientY - lastPos.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setMapState((prev) => { const c2 = degToNum(prev.center.lat, prev.center.lon, prev.zoom); const nc = numToDeg(c2.x - dx / tileSize, c2.y - dy / tileSize, prev.zoom); return { ...prev, center: { lat: nc.lat, lon: nc.lon } }; });
  };
  const handlePointerUp = () => { dragging.current = false; };
  const handleWheel = (e) => { e.preventDefault(); setMapState((p) => ({ ...p, zoom: Math.max(1, Math.min(18, p.zoom + (e.deltaY > 0 ? -1 : 1))) })); };

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", cursor: dragging.current ? "grabbing" : "grab", touchAction: "none", borderRadius: "16px" }}
      onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onWheel={handleWheel}>
      {tiles.map((t) => <img key={t.key} src={t.url} alt="" style={{ position: "absolute", left: t.left, top: t.top, width: tileSize, height: tileSize, pointerEvents: "none" }} draggable={false} />)}
      {pinPos.map((p, i) => (
        <div key={p.id || i} style={{ position: "absolute", left: p.x, top: p.y, transform: "translate(-50%, -100%)", zIndex: hoveredPin === i ? 20 : 10 }}
          onPointerEnter={() => setHoveredPin(i)} onPointerLeave={() => setHoveredPin(null)}
          onClick={(e) => { e.stopPropagation(); if (!dragMoved.current && onPinClick) onPinClick(p); }}>
          <svg width="32" height="42" viewBox="0 0 32 42" fill="none" style={{ cursor: "pointer" }}>
            <path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 26 16 26s16-14 16-26C32 7.16 24.84 0 16 0z" fill="#E63946"/><circle cx="16" cy="15" r="7" fill="white"/>
          </svg>
          {hoveredPin === i && (
            <div style={{ position: "absolute", bottom: 48, left: "50%", transform: "translateX(-50%)", background: "rgba(15,15,15,0.92)", color: "#fff", padding: "8px 14px", borderRadius: 10, fontSize: 13, whiteSpace: "nowrap", pointerEvents: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.3)", fontFamily: "'DM Sans', sans-serif" }}>
              <div style={{ fontWeight: 700 }}>{p.place}</div>
              {p.date && <div style={{ opacity: 0.7, fontSize: 11, marginTop: 2 }}>{p.date}</div>}
            </div>
          )}
          {p.thumb && (
            <div style={{ position: "absolute", bottom: 46, left: "50%", transform: "translateX(-50%)", width: 44, height: 44, borderRadius: "50%", overflow: "hidden", border: "3px solid white", boxShadow: "0 2px 12px rgba(0,0,0,0.3)", display: hoveredPin === i ? "none" : "block", cursor: "pointer" }}>
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

const zoomBtnStyle = { width: 36, height: 36, border: "none", borderRadius: 10, background: "rgba(255,255,255,0.92)", cursor: "pointer", fontSize: 20, fontWeight: 700, color: "#333", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center" };

// ─── Styles ───
const authContainerStyle = { width: "100%", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif", background: "linear-gradient(160deg, #0a0a0f 0%, #12121f 40%, #0f1923 100%)", color: "#e8e6e1", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" };
const authCardStyle = { width: "100%", maxWidth: 400, padding: "40px 36px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 20, backdropFilter: "blur(12px)", position: "relative", zIndex: 10 };
const authTitleStyle = { fontFamily: "'DM Sans', sans-serif", fontSize: 18, fontWeight: 600, margin: "0 0 20px", textAlign: "center", opacity: 0.8 };
const inputStyle = { width: "100%", padding: "14px 16px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, color: "#e8e6e1", fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: "none", boxSizing: "border-box" };
const authBtnStyle = { width: "100%", padding: "14px", background: "#E63946", color: "white", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", boxShadow: "0 4px 20px rgba(230,57,70,0.3)" };

function Fonts() { return <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet" />; }

// ─── Main App ───
export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [lightboxPin, setLightboxPin] = useState(null);
  const [pins, setPins] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [center, setCenter] = useState({ lat: 1.35, lon: 103.82 });
  const [zoom, setZoom] = useState(3);
  const [selectedPin, setSelectedPin] = useState(null);
  const [stats, setStats] = useState({ countries: 0, cities: 0 });
  const [loading, setLoading] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const fileInputRef = useRef(null);

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

  // Load profile when user logs in
  useEffect(() => {
    if (!user) { setProfile(null); setNeedsUsername(false); setPins([]); return; }
    async function loadProfile() {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (error || !data) { setNeedsUsername(true); return; }
      setProfile(data);
      setNeedsUsername(false);
    }
    loadProfile();
  }, [user]);

  // Load pins
  useEffect(() => {
    if (!user || needsUsername) return;
    async function loadPins() {
      setLoading(true);
      const { data } = await supabase.from("locations").select("*").eq("user_id", user.id).order("created_at", { ascending: true });
      if (data && data.length > 0) {
        const loaded = data.map((r) => ({ id: r.id, lat: r.lat, lon: r.lon, place: r.place || "Unknown", city: r.city || "", country: r.country || "", date: r.date || null, thumb: r.photo_url || null, fileName: r.file_name || "" }));
        setPins(loaded); fitMapToPins(loaded);
      }
      setLoading(false);
    }
    loadPins();
  }, [user, needsUsername]);

  useEffect(() => {
    setStats({ countries: new Set(pins.map(p => p.country).filter(Boolean)).size, cities: new Set(pins.map(p => p.city).filter(Boolean)).size });
  }, [pins]);

  const fitMapToPins = (all) => {
    if (all.length === 1) { setCenter({ lat: all[0].lat, lon: all[0].lon }); setZoom(10); }
    else if (all.length > 1) {
      const lats = all.map(p => p.lat), lons = all.map(p => p.lon);
      setCenter({ lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 });
      const d = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons));
      setZoom(d > 100 ? 2 : d > 50 ? 3 : d > 20 ? 4 : d > 5 ? 6 : d > 1 ? 8 : 11);
    }
  };

  const processFiles = useCallback(async (files) => {
    if (!user) return;
    setProcessing(true);
    const imgs = Array.from(files).filter(f => f.type.startsWith("image/"));
    const np = [];
    for (const file of imgs) {
      const gps = await parseExifGPS(file);
      if (gps?.lat && gps?.lon) {
        const geo = await reverseGeocode(gps.lat, gps.lon);
        const b64 = await fileToBase64(file);
        const { data, error } = await supabase.from("locations").insert({ lat: gps.lat, lon: gps.lon, place: geo.display || "Unknown", city: geo.city || "", country: geo.country || "", date: gps.date || null, photo_url: b64, file_name: file.name, user_id: user.id }).select().single();
        if (!error) np.push({ id: data.id, lat: gps.lat, lon: gps.lon, place: geo.display || "Unknown", city: geo.city, country: geo.country, date: gps.date || null, thumb: b64, fileName: file.name });
      }
    }
    if (np.length > 0) setPins(prev => { const all = [...prev, ...np]; fitMapToPins(all); return all; });
    if (np.length === 0 && imgs.length > 0) alert(`No GPS data found in ${imgs.length} image(s).`);
    setProcessing(false);
  }, [user]);

  const clearAll = async () => {
    if (pins.length > 0) await supabase.from("locations").delete().in("id", pins.map(p => p.id));
    setPins([]); setSelectedPin(null); setCenter({ lat: 1.35, lon: 103.82 }); setZoom(3);
  };

  const handleLogout = async () => { await supabase.auth.signOut(); setPins([]); setUser(null); setProfile(null); };

  const sortedPins = [...pins].sort((a, b) => { if (!a.date && !b.date) return 0; if (!a.date) return 1; if (!b.date) return -1; return a.date.localeCompare(b.date); });

  if (checkingAuth) return (
    <div style={{ ...authContainerStyle, minHeight: "100vh" }}><Fonts />
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 32, height: 32, border: "3px solid rgba(230,57,70,0.3)", borderTop: "3px solid #E63946", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
        <div style={{ opacity: 0.5 }}>Loading...</div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (!user) return <AuthScreen onAuth={setUser} />;
  if (needsUsername) return <UsernameSetup user={user} onComplete={(p) => { setProfile({ id: user.id, ...p }); setNeedsUsername(false); }} />;

  return (
    <div style={{ width: "100%", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif", background: "linear-gradient(160deg, #0a0a0f 0%, #12121f 40%, #0f1923 100%)", color: "#e8e6e1", position: "relative", overflow: "hidden" }}>
      <Fonts />
      <div style={{ position: "fixed", top: "-20%", right: "-10%", width: "50vw", height: "50vw", background: "radial-gradient(circle, rgba(230,57,70,0.06) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

      {/* Lightbox */}
      <Lightbox pin={lightboxPin} onClose={() => setLightboxPin(null)} />

      {/* Edit Profile */}
      {showEditProfile && profile && <EditProfile profile={profile} onSave={(p) => { setProfile(p); setShowEditProfile(false); }} onClose={() => setShowEditProfile(false)} />}

      {/* Header */}
      <header style={{ padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative", zIndex: 10, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 800, margin: 0, background: "linear-gradient(135deg, #e8e6e1 0%, #a8a29e 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Footprint</h1>
          <p style={{ margin: "2px 0 0", fontSize: 12, opacity: 0.4, letterSpacing: "0.5px" }}>YOUR TRAVEL STORY, MAPPED</p>
        </div>

        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          {pins.length > 0 && <>
            <div style={{ textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 700, color: "#E63946" }}>{stats.countries}</div><div style={{ fontSize: 9, opacity: 0.4, letterSpacing: "1px" }}>COUNTRIES</div></div>
            <div style={{ textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 700, color: "#E63946" }}>{stats.cities}</div><div style={{ fontSize: 9, opacity: 0.4, letterSpacing: "1px" }}>CITIES</div></div>
            <div style={{ textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 700, color: "#E63946" }}>{pins.length}</div><div style={{ fontSize: 9, opacity: 0.4, letterSpacing: "1px" }}>PHOTOS</div></div>
            <button onClick={clearAll} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#e8e6e1", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontFamily: "'DM Sans', sans-serif" }}>Clear All</button>
          </>}

          {/* User avatar & dropdown */}
          <div style={{ position: "relative", paddingLeft: pins.length > 0 ? 12 : 0, borderLeft: pins.length > 0 ? "1px solid rgba(255,255,255,0.1)" : "none" }}>
            <div onClick={() => setShowUserMenu(!showUserMenu)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "4px 8px", borderRadius: 12, background: showUserMenu ? "rgba(255,255,255,0.06)" : "transparent", transition: "background 0.2s" }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                background: profile?.avatar_url ? `url(${profile.avatar_url}) center/cover` : "#E63946",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 15, fontWeight: 700, color: "white", border: "2px solid rgba(255,255,255,0.15)",
              }}>
                {!profile?.avatar_url && (profile?.username?.charAt(0).toUpperCase() || "?")}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>@{profile?.username}</div>
                <div style={{ fontSize: 10, opacity: 0.4 }}>{user.email}</div>
              </div>
              <span style={{ fontSize: 10, opacity: 0.4, marginLeft: 4 }}>▼</span>
            </div>

            {showUserMenu && (
              <div style={{
                position: "absolute", top: "calc(100% + 8px)", right: 0, width: 200,
                background: "rgba(20,20,30,0.95)", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 14, overflow: "hidden", boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
                backdropFilter: "blur(12px)", zIndex: 100,
              }}>
                <button onClick={() => { setShowEditProfile(true); setShowUserMenu(false); }} style={menuItemStyle}>
                  <span>✎</span> Edit Profile
                </button>
                <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
                <button onClick={() => { handleLogout(); setShowUserMenu(false); }} style={{ ...menuItemStyle, color: "#E63946" }}>
                  <span>↩</span> Log Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Click away to close menu */}
      {showUserMenu && <div onClick={() => setShowUserMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 5 }} />}

      {/* Main content */}
      <div style={{ display: "flex", height: "calc(100vh - 76px)", position: "relative", zIndex: 5 }}>
        <div style={{ width: pins.length > 0 ? 320 : 0, minWidth: pins.length > 0 ? 320 : 0, overflow: "hidden", transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)", borderRight: pins.length > 0 ? "1px solid rgba(255,255,255,0.06)" : "none", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "18px 20px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <h2 style={{ margin: 0, fontSize: 13, letterSpacing: "1px", opacity: 0.5, fontWeight: 600 }}>TIMELINE</h2>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
            {sortedPins.map((pin) => (
              <div key={pin.id} onClick={() => { setSelectedPin(pin.id); setCenter({ lat: pin.lat, lon: pin.lon }); setZoom(12); }} style={{
                display: "flex", gap: 12, padding: "10px 20px", cursor: "pointer",
                background: selectedPin === pin.id ? "rgba(230,57,70,0.1)" : "transparent",
                borderLeft: selectedPin === pin.id ? "3px solid #E63946" : "3px solid transparent",
                transition: "all 0.2s ease",
              }}>
                <div onClick={(e) => { e.stopPropagation(); setLightboxPin(pin); }} style={{
                  width: 48, height: 48, borderRadius: 10, overflow: "hidden", flexShrink: 0,
                  border: "2px solid rgba(255,255,255,0.1)", cursor: "zoom-in",
                }}>
                  {pin.thumb && <img src={pin.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{pin.place}</div>
                  {pin.date && <div style={{ fontSize: 11, opacity: 0.4 }}>{pin.date}</div>}
                  <div style={{ fontSize: 10, opacity: 0.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pin.fileName}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, position: "relative" }} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); processFiles(e.dataTransfer.files); }}>
          <SlippyMap pins={pins} center={center} zoom={zoom} onPinClick={(p) => setLightboxPin(p)} />

          {loading && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 25, background: "rgba(10,10,15,0.8)" }}>
            <div style={{ textAlign: "center" }}><div style={{ width: 32, height: 32, border: "3px solid rgba(230,57,70,0.3)", borderTop: "3px solid #E63946", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} /><div style={{ fontSize: 16, opacity: 0.7 }}>Loading your travels...</div></div>
          </div>}

          {!loading && pins.length === 0 && !processing && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20, background: "rgba(10,10,15,0.7)", backdropFilter: "blur(4px)" }}>
              <div style={{ textAlign: "center", padding: 48, border: "2px dashed rgba(255,255,255,0.15)", borderRadius: 24, background: "rgba(255,255,255,0.03)", maxWidth: 420 }}>
                <div style={{ fontSize: 56, marginBottom: 16 }}>🌍</div>
                <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 800, margin: "0 0 8px" }}>Drop your photos here</h2>
                <p style={{ fontSize: 14, opacity: 0.5, margin: "0 0 24px", lineHeight: 1.6 }}>Upload photos with GPS data and watch<br />your travels appear on the map</p>
                <button onClick={() => fileInputRef.current?.click()} style={{ background: "#E63946", color: "white", border: "none", padding: "14px 36px", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", boxShadow: "0 4px 20px rgba(230,57,70,0.3)", transition: "transform 0.2s ease" }}
                  onMouseEnter={e => e.target.style.transform = "scale(1.05)"} onMouseLeave={e => e.target.style.transform = "scale(1)"}>Choose Photos</button>
              </div>
            </div>
          )}

          {pins.length > 0 && <button onClick={() => fileInputRef.current?.click()} style={{ position: "absolute", top: 16, left: 16, zIndex: 30, background: "rgba(230,57,70,0.92)", color: "white", border: "none", padding: "10px 20px", borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", boxShadow: "0 4px 16px rgba(230,57,70,0.3)", display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 18 }}>+</span> Add Photos</button>}

          {dragOver && <div style={{ position: "absolute", inset: 0, zIndex: 40, background: "rgba(230,57,70,0.15)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", border: "3px dashed #E63946", borderRadius: 16, margin: 8 }}><div style={{ fontSize: 22, fontWeight: 700, color: "#E63946" }}>Drop photos here</div></div>}

          {processing && <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 50, background: "rgba(15,15,15,0.92)", color: "#e8e6e1", padding: "12px 24px", borderRadius: 12, fontSize: 14, boxShadow: "0 4px 20px rgba(0,0,0,0.4)", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 16, height: 16, border: "2px solid rgba(230,57,70,0.3)", borderTop: "2px solid #E63946", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />Reading GPS data...</div>}

          <input ref={fileInputRef} type="file" multiple accept="image/*" style={{ display: "none" }} onChange={(e) => processFiles(e.target.files)} />
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
      `}</style>
    </div>
  );
}

const menuItemStyle = { width: "100%", padding: "12px 16px", background: "none", border: "none", color: "#e8e6e1", fontSize: 13, fontFamily: "'DM Sans', sans-serif", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 10, transition: "background 0.15s" };
