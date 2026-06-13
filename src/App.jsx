import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { initializeApp, getApps } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  confirmPasswordReset as firebaseConfirmPasswordReset,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updatePassword,
  verifyPasswordResetCode,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  getDoc,
  getDocs,
  limit as firestoreLimit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const envOrFallback = (value, fallback) => {
  const cleanValue = typeof value === "string" ? value.trim() : value;
  return cleanValue || fallback;
};

const firebaseConfig = {
  apiKey: envOrFallback(import.meta.env.VITE_FIREBASE_API_KEY, "AIzaSyAVk2LmV5L7KpECsvS3E-UmhBxP9xHf4WM"),
  authDomain: envOrFallback(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, "footprint-e5eff.firebaseapp.com"),
  projectId: envOrFallback(import.meta.env.VITE_FIREBASE_PROJECT_ID, "footprint-e5eff"),
  messagingSenderId: envOrFallback(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID, "389298776508"),
  appId: envOrFallback(import.meta.env.VITE_FIREBASE_APP_ID, "1:389298776508:web:f78383048e3735416a3b9"),
};

const firebaseApp = getApps()[0] || initializeApp(firebaseConfig);
const firebaseAuth = getAuth(firebaseApp);
const firebaseDb = getFirestore(firebaseApp);

function normalizeFirebaseUser(user) {
  if (!user) return null;
  return { id: user.uid, uid: user.uid, email: user.email, raw: user };
}

function firebaseError(error) {
  return error ? { message: error.message || String(error) } : null;
}

class FirebaseQuery {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.orderField = null;
    this.orderDirection = "asc";
    this.limitCount = null;
    this.action = "select";
    this.payload = null;
    this.singleResult = false;
    this.selectAfterWrite = false;
  }

  select() { this.selectAfterWrite = true; return this; }
  eq(field, value) { this.filters.push({ field, op: "==", value }); return this; }
  contains(field, value) { this.filters.push({ field, op: "array-contains", value }); return this; }
  not(field, op, value) { if (op === "is" && value === null) this.filters.push({ field, op: "!=", value: null }); return this; }
  order(field, options = {}) { this.orderField = field; this.orderDirection = options.ascending === false ? "desc" : "asc"; return this; }
  limit(count) { this.limitCount = count; return this; }
  insert(payload) { this.action = "insert"; this.payload = Array.isArray(payload) ? payload[0] : payload; return this; }
  update(payload) { this.action = "update"; this.payload = payload; return this; }
  delete() { this.action = "delete"; return this; }
  in(field, values) { this.filters.push({ field, op: "in", value: values }); return this; }
  single() { this.singleResult = true; return this.execute(); }
  then(resolve, reject) { return this.execute().then(resolve, reject); }

  collectionRef() { return collection(firebaseDb, this.table); }

  async matchingDocs() {
    if (!firebaseDb) throw new Error("Firebase failed to initialize. Reload the app and try again.");
    const idFilters = this.filters.filter(filter => filter.field === "id");
    const fieldFilters = this.filters.filter(filter => filter.field !== "id");
    const clauses = fieldFilters.map(filter => where(filter.field, filter.op, filter.value));
    const canUseServerSort = this.orderField && clauses.length === 0;
    if (canUseServerSort) clauses.push(orderBy(this.orderField, this.orderDirection));
    if (this.limitCount && canUseServerSort) clauses.push(firestoreLimit(this.limitCount));
    const snapshot = await getDocs(clauses.length ? query(this.collectionRef(), ...clauses) : this.collectionRef());
    let rows = snapshot.docs.map(item => ({ ...item.data(), id: item.id }));
    for (const filter of idFilters) {
      if (filter.op === "==") rows = rows.filter(row => row.id === String(filter.value));
      if (filter.op === "in") rows = rows.filter(row => filter.value.map(String).includes(row.id));
    }
    if (this.orderField && !canUseServerSort) {
      const direction = this.orderDirection === "desc" ? -1 : 1;
      rows.sort((a, b) => String(a[this.orderField] || "").localeCompare(String(b[this.orderField] || "")) * direction);
    }
    if (this.limitCount && !canUseServerSort) rows = rows.slice(0, this.limitCount);
    return rows;
  }

  async execute() {
    try {
      if (this.action === "select") {
        const rows = await this.matchingDocs();
        const data = this.singleResult ? (rows[0] || null) : rows;
        return { data, error: this.singleResult && !rows[0] ? { message: "No rows found" } : null };
      }

      if (this.action === "insert") {
        const payload = { ...this.payload, created_at: this.payload.created_at || new Date().toISOString() };
        let refDoc;
        if (payload.id) {
          refDoc = doc(firebaseDb, this.table, String(payload.id));
          await setDoc(refDoc, payload, { merge: true });
        } else {
          refDoc = await addDoc(this.collectionRef(), payload);
        }
        const saved = await getDoc(refDoc);
        return { data: { id: refDoc.id, ...saved.data() }, error: null };
      }

      if (this.action === "update") {
        const rows = await this.matchingDocs();
        await Promise.all(rows.map(row => updateDoc(doc(firebaseDb, this.table, String(row.id)), this.payload)));
        return { data: rows.map(row => ({ ...row, ...this.payload })), error: null };
      }

      if (this.action === "delete") {
        const rows = await this.matchingDocs();
        await Promise.all(rows.map(row => deleteDoc(doc(firebaseDb, this.table, String(row.id)))));
        return { data: rows, error: null };
      }

      return { data: null, error: null };
    } catch (error) {
      return { data: this.singleResult ? null : [], error: firebaseError(error) };
    }
  }
}

const supabase = {
  auth: {
    async getSession() {
      return { data: { session: firebaseAuth?.currentUser ? { user: normalizeFirebaseUser(firebaseAuth.currentUser) } : null } };
    },
    onAuthStateChange(callback) {
      if (!firebaseAuth) {
        callback("AUTH_STATE_CHANGED", null);
        return { data: { subscription: { unsubscribe() {} } } };
      }
      const unsubscribe = onAuthStateChanged(firebaseAuth, user => callback("AUTH_STATE_CHANGED", { user: normalizeFirebaseUser(user) }));
      return { data: { subscription: { unsubscribe } } };
    },
    async signInWithPassword({ email, password }) {
      if (!firebaseAuth) return { data: {}, error: { message: "Firebase is not configured yet." } };
      try {
        const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
        return { data: { user: normalizeFirebaseUser(credential.user) }, error: null };
      } catch (error) { return { data: {}, error: firebaseError(error) }; }
    },
    async signUp({ email, password }) {
      if (!firebaseAuth) return { data: {}, error: { message: "Firebase is not configured yet." } };
      try {
        const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
        return { data: { user: normalizeFirebaseUser(credential.user), session: { user: normalizeFirebaseUser(credential.user) } }, error: null };
      } catch (error) { return { data: {}, error: firebaseError(error) }; }
    },
    async resetPasswordForEmail(email) {
      if (!firebaseAuth) return { error: { message: "Firebase is not configured yet." } };
      try { await sendPasswordResetEmail(firebaseAuth, email); return { error: null }; }
      catch (error) { return { error: firebaseError(error) }; }
    },
    async updateUser({ password }) {
      if (!firebaseAuth?.currentUser) return { error: { message: "Please log in again before changing your password." } };
      try { await updatePassword(firebaseAuth.currentUser, password); return { error: null }; }
      catch (error) { return { error: firebaseError(error) }; }
    },
    async confirmPasswordReset({ code, password }) {
      if (!firebaseAuth) return { error: { message: "Firebase is not configured yet." } };
      try {
        await verifyPasswordResetCode(firebaseAuth, code);
        await firebaseConfirmPasswordReset(firebaseAuth, code, password);
        return { error: null };
      } catch (error) { return { error: firebaseError(error) }; }
    },
    async signOut() { if (firebaseAuth) await firebaseSignOut(firebaseAuth); },
  },
  from(table) { return new FirebaseQuery(table); },
  async rpc(name) {
    if (name === "global_heatmap_locations") {
      const { data, error } = await supabase.from("locations").select("*").eq("is_public", true);
      const rows = (data || [])
        .filter(row => row.lat != null && row.lon != null)
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      return { data: rows, error };
    }
    if (name === "admin_backfill_missing_profiles") return { data: 0, error: null };
    if (name === "admin_user_accounts") return { data: [], error: null };
    return { data: null, error: { message: "RPC is not available on Firebase Spark." } };
  },
  functions: {
    async invoke() { return { data: { error: "Admin functions are not available on Firebase Spark." }, error: null }; },
  },
};

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || "").split(",").map(email => email.trim().toLowerCase()).filter(Boolean);
const APP_VERSION = "1.2.0";

function formatCompactCount(value) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function friendDocId(a, b) {
  return [a, b].sort().join("_");
}

function useIsMobile() {
  const [m, setM] = useState(() => window.innerWidth < 640);
  useEffect(() => { const h = () => setM(window.innerWidth < 640); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);
  return m;
}

const palette = {
  ink: "#111827",
  panel: "rgba(17,24,39,0.88)",
  panelSoft: "rgba(255,255,255,0.075)",
  line: "rgba(255,255,255,0.13)",
  text: "#F7F3EA",
  muted: "rgba(247,243,234,0.62)",
  accent: "#FF6B4A",
  accentDark: "#D94C30",
  mint: "#42D9B8",
  sky: "#5DADEC",
  gold: "#F2C36B",
};

// ─── Geo Helpers ───
function svgDataUrl(svg) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const DEFAULT_AVATARS = [
  { name: "Summit", image: svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="#182235"/><circle cx="96" cy="30" r="14" fill="#F2C36B"/><path d="M14 92 45 48l22 30 16-20 31 34v22H14z" fill="#42D9B8"/><path d="M45 48 57 65l-16-5zm38 10 13 15-18-6z" fill="#F7F3EA"/></svg>`) },
  { name: "Coast", image: svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="#16324A"/><circle cx="90" cy="36" r="18" fill="#FF6B4A"/><path d="M0 84c18-10 34-10 50 0s32 10 50 0c12-7 21-8 28-6v50H0z" fill="#5DADEC"/><path d="M0 100c18-8 34-8 50 0s32 8 50 0c12-5 21-6 28-4v32H0z" fill="#42D9B8"/></svg>`) },
  { name: "Trail", image: svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="#1D2B22"/><path d="M25 101c13-22 28-31 43-39 15-8 25-17 35-36" stroke="#F7F3EA" stroke-width="10" stroke-linecap="round" fill="none"/><path d="M65 28c0-10 8-18 18-18s18 8 18 18c0 14-18 32-18 32S65 42 65 28z" fill="#FF6B4A"/><circle cx="83" cy="28" r="7" fill="#F7F3EA"/><circle cx="35" cy="94" r="9" fill="#42D9B8"/></svg>`) },
  { name: "City", image: svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="#111827"/><rect x="25" y="52" width="18" height="48" rx="4" fill="#5DADEC"/><rect x="50" y="32" width="24" height="68" rx="4" fill="#F7F3EA"/><rect x="82" y="44" width="20" height="56" rx="4" fill="#42D9B8"/><path d="M18 104h92" stroke="#FF6B4A" stroke-width="8" stroke-linecap="round"/><circle cx="87" cy="25" r="10" fill="#F2C36B"/></svg>`) },
  { name: "Compass", image: svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="#241B2F"/><circle cx="64" cy="64" r="42" fill="#F7F3EA"/><circle cx="64" cy="64" r="34" fill="#17243A"/><path d="m74 27-6 41-31 33 23-43z" fill="#FF6B4A"/><path d="m54 101 6-41 31-33-23 43z" fill="#42D9B8"/><circle cx="64" cy="64" r="7" fill="#F2C36B"/></svg>`) },
  { name: "Passport", image: svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="#17313B"/><rect x="36" y="24" width="56" height="80" rx="9" fill="#FF6B4A"/><path d="M48 44h32M48 88h24" stroke="#F7F3EA" stroke-width="6" stroke-linecap="round"/><circle cx="64" cy="65" r="15" fill="#42D9B8"/><path d="M49 65h30M64 50c7 8 7 22 0 30M64 50c-7 8-7 22 0 30" stroke="#17313B" stroke-width="3" fill="none"/></svg>`) },
];

const USERNAME_ADJECTIVES = ["sunny", "brave", "hidden", "golden", "wild", "cozy", "urban", "quiet", "bright", "lucky"];
const USERNAME_NOUNS = ["trail", "passport", "summit", "harbor", "compass", "journey", "skyline", "nomad", "map", "roamer"];

function randomUsernameCandidate() {
  const adjective = USERNAME_ADJECTIVES[Math.floor(Math.random() * USERNAME_ADJECTIVES.length)];
  const noun = USERNAME_NOUNS[Math.floor(Math.random() * USERNAME_NOUNS.length)];
  return `${adjective}_${noun}${Math.floor(10 + Math.random() * 90)}`;
}

const PASSWORD_HELP = "Use at least 8 characters with uppercase, lowercase, number, and symbol.";

function passwordComplexityError(password) {
  if (password.length < 8) return PASSWORD_HELP;
  if (!/[A-Z]/.test(password)) return PASSWORD_HELP;
  if (!/[a-z]/.test(password)) return PASSWORD_HELP;
  if (!/[0-9]/.test(password)) return PASSWORD_HELP;
  if (!/[^A-Za-z0-9]/.test(password)) return PASSWORD_HELP;
  return "";
}

function heatmapCenter(points) {
  if (!points.length) return { center: { lat: 1.35, lon: 103.82 }, zoom: 2 };
  const lats = points.map(point => point.lat);
  const lons = points.map(point => point.lon);
  const spread = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons));
  return {
    center: { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 },
    zoom: spread > 100 ? 2 : spread > 50 ? 3 : spread > 20 ? 4 : spread > 5 ? 5 : spread > 1 ? 7 : 10,
  };
}

function groupHeatPoints(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
    const current = grouped.get(key) || { lat: 0, lon: 0, count: 0, place: row.place || "Popular place", thumb: "", fileName: "", sampleId: null };
    grouped.set(key, {
      lat: current.lat + lat,
      lon: current.lon + lon,
      count: current.count + 1,
      place: current.place || row.place || "Popular place",
      thumb: current.thumb || row.thumb || row.photo_url || "",
      fileName: current.fileName || row.fileName || row.file_name || "",
      sampleId: current.sampleId || row.id || null,
    });
  }
  return [...grouped.values()].map(point => ({
    ...point,
    lat: point.lat / point.count,
    lon: point.lon / point.count,
  })).sort((a, b) => b.count - a.count);
}

function degToNum(lat, lon, zoom) {
  const n = Math.pow(2, zoom);
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n };
}
function numToDeg(x, y, zoom) {
  const n = Math.pow(2, zoom);
  return { lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI, lon: (x / n) * 360 - 180 };
}

// ─── EXIF Parser ───
async function parseExifGPS(file) {
  try {
    const exifr = await import("exifr");
    const gps = await Promise.race([
      exifr.gps(file),
      new Promise(resolve => setTimeout(() => resolve(null), 10000)),
    ]);
    if (gps?.latitude != null && gps?.longitude != null) return { lat: gps.latitude, lon: gps.longitude, date: null };

    const parsed = await Promise.race([
      exifr.parse(file, { gps: true, xmp: true, exif: true, ifd0: true }),
      new Promise(resolve => setTimeout(() => resolve(null), 10000)),
    ]);
    const lat = parsed?.latitude ?? parsed?.GPSLatitude;
    const lon = parsed?.longitude ?? parsed?.GPSLongitude;
    if (lat == null || lon == null) return null;
    return { lat: Number(lat), lon: Number(lon), date: parsed?.DateTimeOriginal?.toISOString?.().slice(0, 10) || null };
  } catch { return null; }
}

async function reverseGeocode(lat, lon) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&accept-language=en`);
    const d = await r.json(); const a = d.address || {};
    const city = a.city||a.town||a.village||a.county||"", country = a.country||"";
    return { city, country, display: city ? `${city}, ${country}` : country };
  } catch { return { city: "", country: "", display: `${lat.toFixed(2)}, ${lon.toFixed(2)}` }; }
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => resolve(rd.result);
    rd.onerror = () => reject(rd.error || new Error("Could not read image"));
    rd.readAsDataURL(file);
  });
}
function isPhotoFile(file) {
  const name = file.name?.toLowerCase() || "";
  return file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|heics)$/i.test(name) || name.startsWith("mvimg_");
}
function isHeicLike(file) {
  const name = file.name?.toLowerCase() || "";
  const type = file.type?.toLowerCase() || "";
  return type.includes("heic") || type.includes("heif") || name.endsWith(".heic") || name.endsWith(".heif") || name.endsWith(".heics");
}
function isMvimgFile(file) {
  return file.name?.toLowerCase().startsWith("mvimg_");
}
function heicMimeHint(fileName = "", fallback = "image/heic") {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".heif")) return "image/heif";
  if (lower.endsWith(".heics")) return "image/heic-sequence";
  return fallback || "image/heic";
}
async function extractJpegFromMotionPhoto(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      canvas.toBlob((blob) => { URL.revokeObjectURL(url); resolve(blob || file); }, "image/jpeg", 0.92);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
async function photoToDisplayDataUrl(file) {
  const blob = isHeicLike(file)
    ? await convertHeicToJpeg(file, heicMimeHint(file.name, file.type || "image/heic"))
    : isMvimgFile(file)
      ? await extractJpegFromMotionPhoto(file)
      : file;
  const compressed = await resizeImageBlob(blob, 720, 0.62);
  return fileToBase64(compressed);
}
async function safePhotoToDisplayDataUrl(file) {
  try {
    return await photoToDisplayDataUrl(file);
  } catch {
    if (isHeicLike(file)) {
      try {
        const compressed = await resizeImageBlob(file, 720, 0.62);
        return await fileToBase64(compressed);
      } catch {
        return "";
      }
    }
    try {
      return await fileToBase64(file);
    } catch {
      return "";
    }
  }
}
function resizeImageBlob(blob, maxSize, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((resized) => {
        URL.revokeObjectURL(url);
        if (resized) resolve(resized);
        else reject(new Error("Could not compress image"));
      }, "image/jpeg", quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load image"));
    };
    img.src = url;
  });
}
async function convertHeicToJpeg(blob, typeHint = "image/heic") {
  const mod = await import("heic2any");
  const heic2any = mod.default || mod;
  const buffer = await blob.arrayBuffer();
  const candidates = [
    blob.type && blob.type !== "application/octet-stream" ? blob : null,
    new Blob([buffer], { type: typeHint }),
    new Blob([buffer], { type: "image/heic" }),
    new Blob([buffer], { type: "image/heif" }),
  ].filter(Boolean);

  let lastError;
  for (const source of candidates) {
    try {
      const converted = await heic2any({ blob: source, toType: "image/jpeg", quality: 0.9 });
      const jpeg = Array.isArray(converted) ? converted[0] : converted;
      return jpeg.type === "image/jpeg" ? jpeg : new Blob([jpeg], { type: "image/jpeg" });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Could not convert HEIC");
}
function dataUrlToBlob(dataUrl) {
  const [meta, data] = dataUrl.split(",");
  const mime = meta.match(/data:(.*?);base64/)?.[1] || "application/octet-stream";
  const bytes = atob(data);
  const parts = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) parts[i] = bytes.charCodeAt(i);
  return new Blob([parts], { type: mime });
}
async function displayablePhotoUrl(photoUrl, fileName = "") {
  const isHeicData = photoUrl?.startsWith("data:image/heic") || photoUrl?.startsWith("data:image/heif");
  const isHeicName = fileName.toLowerCase().endsWith(".heic") || fileName.toLowerCase().endsWith(".heif");
  if (isHeicName && photoUrl?.startsWith("data:image/jpeg")) return photoUrl;
  if (!photoUrl || (!isHeicData && !isHeicName)) return photoUrl;
  try {
    const jpeg = await convertHeicToJpeg(dataUrlToBlob(photoUrl), heicMimeHint(fileName));
    return fileToBase64(jpeg);
  } catch {
    return "";
  }
}
function LogoMark({ size = 42 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#111827" />
      <path d="M16 39c6.6-9.8 12.1-15.4 16.6-16.9 4.8-1.6 10.2.4 15.9 6" stroke="#42D9B8" strokeWidth="4" strokeLinecap="round" />
      <path d="M18 45c7.5-4.5 14.2-6.1 20.1-4.7 3.4.8 6.7 2.6 9.9 5.3" stroke="#F7F3EA" strokeWidth="4" strokeLinecap="round" />
      <path d="M40 18c0 6.7-8 15.2-8 15.2S24 24.7 24 18a8 8 0 1 1 16 0Z" fill="#FF6B4A" />
      <circle cx="32" cy="18" r="3" fill="#F7F3EA" />
      <path d="M47 18l2.3 4.6 5.1.8-3.7 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1-3.7-3.6 5.1-.8L47 18Z" fill="#F2C36B" />
    </svg>
  );
}

function BrandLockup({ align = "center", titleSize = 32, compact = false }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: align === "center" ? "center" : "flex-start",
      gap: 12,
      textAlign: align,
    }}>
      <LogoMark size={compact ? 38 : 50} />
      <div>
        <h1 style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: titleSize,
          lineHeight: 1,
          fontWeight: 800,
          margin: 0,
          color: palette.text,
        }}>Footprint</h1>
        <p style={{ margin: "6px 0 0", fontSize: compact ? 10 : 12, opacity: 0.58, letterSpacing: "0.8px", color: palette.muted }}>YOUR TRAVEL STORY, MAPPED</p>
      </div>
    </div>
  );
}

function ProfileLightbox({ profile, user, onClose }) {
  if (!profile) return null;
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1100, background: "rgba(6,10,18,0.78)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      backdropFilter: "blur(14px)", cursor: "zoom-out",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(440px, 92vw)", padding: 28, borderRadius: 24,
        background: "linear-gradient(180deg, rgba(255,255,255,0.13), rgba(255,255,255,0.06))",
        border: `1px solid ${palette.line}`, boxShadow: "0 28px 80px rgba(0,0,0,0.48)",
        textAlign: "center", color: palette.text,
      }}>
        <div style={{
          width: "min(280px, 70vw)", height: "min(280px, 70vw)", margin: "0 auto 20px",
          borderRadius: "50%", background: profile.avatar_url ? `url(${profile.avatar_url}) center/cover` : `linear-gradient(135deg, ${palette.accent}, ${palette.sky})`,
          border: "6px solid rgba(255,255,255,0.18)", display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: 92, fontWeight: 800, color: "white",
          boxShadow: "0 22px 60px rgba(0,0,0,0.35)",
        }}>
          {!profile.avatar_url && (profile.username?.charAt(0).toUpperCase() || "?")}
        </div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>@{profile.username}</div>
        <div style={{ fontSize: 13, color: palette.muted, marginTop: 4 }}>{user?.email}</div>
        <button onClick={onClose} style={{ ...secondaryBtnStyle, marginTop: 22, width: "100%" }}>Close</button>
      </div>
    </div>
  );
}

// ─── Image Lightbox ───
function AdminPanel({ currentUser, onClose }) {
  const [profiles, setProfiles] = useState([]);
  const [authUsers, setAuthUsers] = useState(new Map());
  const [uploads, setUploads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [previewProfile, setPreviewProfile] = useState(null);
  const [message, setMessage] = useState("");
  const [authEmailError, setAuthEmailError] = useState("");

  const uploadCounts = useMemo(() => {
    const counts = new Map();
    for (const upload of uploads) counts.set(upload.user_id, (counts.get(upload.user_id) || 0) + 1);
    return counts;
  }, [uploads]);
  const heatPoints = useMemo(() => {
    return groupHeatPoints(uploads);
  }, [uploads]);
  const heatView = useMemo(() => heatmapCenter(heatPoints), [heatPoints]);
  const adminUsers = useMemo(() => {
    const usersById = new Map(profiles.map(person => [person.id, person]));
    for (const authUser of authUsers.values()) {
      const profileUser = usersById.get(authUser.id);
      if (profileUser) {
        usersById.set(authUser.id, {
          ...profileUser,
          email: authUser.email || profileUser.email,
          username: profileUser.username || authUser.username,
          avatar_url: profileUser.avatar_url || authUser.avatar_url,
          role: profileUser.role || authUser.role || "user",
          hasProfile: true,
        });
      } else {
        const hasProfile = authUser.has_profile ?? Boolean(authUser.username || authUser.avatar_url);
        usersById.set(authUser.id, {
          id: authUser.id,
          email: authUser.email,
          username: authUser.username || authUser.email?.split("@")[0] || "no_profile",
          role: authUser.role || "user",
          avatar_url: authUser.avatar_url || null,
          hasProfile,
        });
      }
    }
    return [...usersById.values()].sort((a, b) => {
      const aUploads = uploadCounts.get(a.id) || 0;
      const bUploads = uploadCounts.get(b.id) || 0;
      if (aUploads !== bUploads) return bUploads - aUploads;
      const aLabel = authUsers.get(a.id)?.email || a.email || a.username || "";
      const bLabel = authUsers.get(b.id)?.email || b.email || b.username || "";
      return aLabel.localeCompare(bLabel);
    });
  }, [profiles, authUsers, uploadCounts]);
  const effectiveUserId = userId || selectedUserId;
  const selectedUser = adminUsers.find(person => person.id === effectiveUserId);
  const selectedEmail = selectedUser ? userEmail(selectedUser) : "";
  const filteredUploads = effectiveUserId ? uploads.filter(upload => upload.user_id === effectiveUserId) : uploads;

  function userEmail(person) {
    return authUsers.get(person.id)?.email || person.email || "";
  }

  useEffect(() => {
    async function loadAdminData() {
      setLoading(true);
      const [{ data: profileRows }, { data: locationRows }, authResult, rpcResult] = await Promise.all([
        supabase.from("profiles").select("*"),
        supabase.from("locations").select("*").order("created_at", { ascending: false }),
        supabase.functions.invoke("admin-update-email", { body: { action: "listUsers" } }),
        supabase.rpc("admin_user_accounts"),
      ]);
      const profileList = profileRows || [];
      const profileById = new Map(profileList.map(p => [p.id, p]));
      const authRows = authResult.data?.users?.length ? authResult.data.users : (rpcResult.data || []);
      const authById = new Map(authRows.map(authUser => [authUser.id, authUser]));
      const emailError = authResult.error?.message || authResult.data?.error || rpcResult.error?.message || "";
      setAuthEmailError(authRows.length ? "" : emailError);
      const uploadList = await Promise.all((locationRows || []).map(async (row) => ({
        ...row,
        profile: profileById.get(row.user_id),
        thumb: await displayablePhotoUrl(row.photo_url || null, row.file_name || ""),
      })));
      setProfiles(profileList);
      setAuthUsers(authById);
      setUploads(uploadList);
      setLoading(false);
    }
    loadAdminData();
  }, []);

  const selectAdminUser = (person) => {
    setSelectedUserId(person.id);
    setUserId(person.id);
    setNewEmail("");
    setNewPassword("");
    setMessage("");
  };

  const handleUserIdChange = (value) => {
    setUserId(value);
    setSelectedUserId(adminUsers.some(person => person.id === value) ? value : "");
    setNewEmail("");
    setNewPassword("");
    setMessage("");
  };

  const handleDeleteAdminUpload = async (upload) => {
    const ok = window.confirm(`Delete ${upload.file_name || "this upload"} from @${upload.profile?.username || "this user"}?`);
    if (!ok) return;
    const { error } = await supabase.from("locations").delete().eq("id", upload.id);
    if (error) { setMessage(error.message); return; }
    setUploads(prev => prev.filter(item => item.id !== upload.id));
    setMessage("Upload deleted");
  };

  const handleBackfillProfiles = async () => {
    setMessage("");
    const { data, error } = await supabase.rpc("admin_backfill_missing_profiles");
    if (error) { setMessage(error.message); return; }
    const { data: profileRows } = await supabase.from("profiles").select("*");
    setProfiles(profileRows || []);
    setMessage(`Created ${data || 0} missing profile${data === 1 ? "" : "s"}`);
  };

  const handleUpdateUserAccount = async () => {
    setMessage("");
    if (!userId) { setMessage("Choose a user first"); return; }
    if (!newEmail && !newPassword) { setMessage("Enter a new email or new password"); return; }
    if (newPassword) {
      const passwordError = passwordComplexityError(newPassword);
      if (passwordError) { setMessage(passwordError); return; }
    }
    const changes = [newEmail ? `email to ${newEmail}` : "", newPassword ? "password" : ""].filter(Boolean).join(" and ");
    const ok = window.confirm(`Update this user's ${changes}?`);
    if (!ok) return;
    const { data, error } = await supabase.functions.invoke("admin-update-email", {
      body: { userId, newEmail: newEmail || undefined, newPassword: newPassword || undefined },
    });
    if (error) setMessage(error.message);
    else {
      if (data?.user?.email) {
        setAuthUsers(prev => new Map(prev).set(data.user.id, { ...prev.get(data.user.id), ...data.user }));
        setProfiles(prev => prev.map(person => person.id === data.user.id ? { ...person, email: data.user.email } : person));
      }
      setMessage("User account updated");
      setNewEmail("");
      setNewPassword("");
    }
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 950, background: "rgba(6,10,18,0.76)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      backdropFilter: "blur(12px)",
    }}>
      {previewProfile && <ProfileLightbox profile={previewProfile} user={{ email: userEmail(previewProfile) || previewProfile.id }} onClose={() => setPreviewProfile(null)} />}
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(1080px, calc(100vw - 32px))", maxHeight: "calc(100vh - 48px)",
        overflow: "hidden", borderRadius: 24, background: "rgba(17,24,39,0.96)",
        border: `1px solid ${palette.line}`, boxShadow: "0 28px 90px rgba(0,0,0,0.46)",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "22px 24px", borderBottom: `1px solid ${palette.line}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Admin Dashboard</h2>
            <div style={{ marginTop: 4, color: palette.muted, fontSize: 12 }}>Signed in as {currentUser.email}</div>
          </div>
          <button onClick={onClose} style={{ ...secondaryBtnStyle, padding: "10px 14px" }}>Close</button>
        </div>

        <div style={{ overflowY: "auto", padding: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 20 }}>
            <div style={adminStatStyle}><strong>{adminUsers.length}</strong><span>Users</span></div>
            <div style={adminStatStyle}><strong>{uploads.length}</strong><span>Total uploads</span></div>
          </div>

          <div style={{ padding: 18, borderRadius: 18, background: "rgba(255,255,255,0.06)", border: `1px solid ${palette.line}`, marginBottom: 22 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14 }}>Popular Places Heatmap</h3>
              <div style={{ color: palette.muted, fontSize: 12 }}>{heatPoints.length} place groups</div>
            </div>
            <div style={{ height: 280, borderRadius: 14, overflow: "hidden", border: `1px solid ${palette.line}` }}>
              <SlippyMap pins={[]} heatPoints={heatPoints} center={heatView.center} zoom={heatView.zoom} />
            </div>
          </div>

          <div style={{ padding: 18, borderRadius: 18, background: "rgba(255,255,255,0.06)", border: `1px solid ${palette.line}`, marginBottom: 22 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 14 }}>Manage User Account</h3>
            {selectedUser && <div style={{ marginBottom: 10, color: palette.muted, fontSize: 12 }}>Selected: @{selectedUser.username || "unknown"} - {selectedEmail || "email unavailable"} - {uploadCounts.get(selectedUser.id) || 0} uploads</div>}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) minmax(180px, 1fr) minmax(180px, 1fr) auto", gap: 10 }}>
              <input value={userId} onChange={(e) => handleUserIdChange(e.target.value)} placeholder="User ID" style={inputStyle} />
              <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder={selectedEmail ? `Current: ${selectedEmail}` : "New email to set"} style={inputStyle} />
              <div style={{ position: "relative" }}>
                <input type={showPassword ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password to set" style={{ ...inputStyle, paddingRight: 70 }} />
                <button type="button" onClick={() => setShowPassword(value => !value)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.08)", color: palette.text, border: `1px solid ${palette.line}`, borderRadius: 10, padding: "6px 9px", fontSize: 11, cursor: "pointer" }}>
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <button onClick={handleUpdateUserAccount} style={authBtnStyle}>Update</button>
            </div>
            {message && <div style={{ marginTop: 10, fontSize: 12, color: /updated|deleted|created/i.test(message) ? "#4ade80" : "#E63946" }}>{message}</div>}
            <div style={{ marginTop: 10, color: palette.muted, fontSize: 12, lineHeight: 1.5 }}>
              Emails are loaded from Supabase Auth. Passwords cannot be viewed; type a new password only when you want to replace it.
            </div>
            {authEmailError && (
              <div style={{ marginTop: 10, color: "#F2C36B", fontSize: 12, lineHeight: 1.5 }}>
                Email lookup failed: {authEmailError}. Deploy the admin-update-email Edge Function and set SUPABASE_SERVICE_ROLE_KEY, or add emails to profiles.email as a fallback.
              </div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>All Users</h3>
            <button onClick={handleBackfillProfiles} style={{ ...secondaryBtnStyle, padding: "8px 10px", fontSize: 12 }}>Create Missing Profiles</button>
          </div>
          {loading ? <div style={{ color: palette.muted, marginBottom: 22 }}>Loading users...</div> : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14, marginBottom: 26 }}>
              {adminUsers.map((person) => (
                <div key={person.id} onClick={() => selectAdminUser(person)} style={{ padding: 14, border: effectiveUserId === person.id ? `1px solid ${palette.mint}` : `1px solid ${palette.line}`, borderRadius: 16, background: effectiveUserId === person.id ? "rgba(66,217,184,0.1)" : "rgba(255,255,255,0.055)", display: "flex", gap: 12, alignItems: "center", cursor: "pointer" }}>
                  <div onClick={(e) => { e.stopPropagation(); setPreviewProfile(person); }} title="View profile picture" style={{
                    width: 42, height: 42, borderRadius: "50%", flexShrink: 0,
                    background: person.avatar_url ? `url(${person.avatar_url}) center/cover` : `linear-gradient(135deg, ${palette.accent}, ${palette.sky})`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 800, cursor: "zoom-in",
                  }}>
                    {!person.avatar_url && (person.username?.charAt(0).toUpperCase() || "?")}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>@{person.username || "unknown"}</div>
                    <div style={{ color: palette.muted, fontSize: 11, marginTop: 2 }}>{person.role || "user"} - {userEmail(person) || "email unavailable"}</div>
                    <div style={{ color: palette.muted, fontSize: 11, marginTop: 2 }}>{uploadCounts.get(person.id) || 0} uploads - {person.hasProfile === false ? "profile not set" : "password can be reset only"}</div>
                    <div style={{ color: "rgba(247,243,234,0.36)", fontSize: 10, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{person.id}</div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); selectAdminUser(person); }} style={{ ...secondaryBtnStyle, padding: "8px 10px", fontSize: 11, flexShrink: 0 }}>Select</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>{selectedUser ? `Uploads by @${selectedUser.username || "unknown"}` : "All Uploads"}</h3>
            {effectiveUserId && <button onClick={() => { setSelectedUserId(""); setUserId(""); }} style={{ ...secondaryBtnStyle, padding: "8px 10px", fontSize: 12 }}>Show All Uploads</button>}
          </div>
          {loading ? <div style={{ color: palette.muted }}>Loading admin data...</div> : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
              {filteredUploads.map((item) => (
                <div key={item.id} style={{ border: `1px solid ${palette.line}`, borderRadius: 16, overflow: "hidden", background: "rgba(255,255,255,0.055)" }}>
                  <div style={{ height: 130, background: "rgba(255,255,255,0.05)" }}>
                    {item.thumb && <img src={item.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                  </div>
                  <div style={{ padding: 12 }}>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>{item.place || "Unknown"}</div>
                    <div style={{ color: palette.muted, fontSize: 11, marginTop: 4 }}>@{item.profile?.username || "unknown"} · {item.file_name || "photo"}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                      <button onClick={() => handleUserIdChange(item.user_id)} style={{ ...secondaryBtnStyle, width: "100%", padding: "9px 10px", fontSize: 12 }}>Use ID</button>
                      <button onClick={() => handleDeleteAdminUpload(item)} style={{ ...dangerBtnStyle, width: "100%", padding: "9px 10px", fontSize: 12 }}>Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FriendsPanel({ currentUser, onClose }) {
  const isMobile = useIsMobile();
  const currentUserId = currentUser.id || currentUser.uid;
  const [friendships, setFriendships] = useState([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [profilesById, setProfilesById] = useState(new Map());
  const [selectedChat, setSelectedChat] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatText, setChatText] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState(false);

  const loadFriends = useCallback(async () => {
    setLoading(true);
    const { data: rows, error } = await supabase.from("friends").select("*").contains("user_ids", currentUserId);
    if (error) {
      setMessage(error.message);
      setFriendships([]);
      setLoading(false);
      return;
    }
    const friendIds = [...new Set((rows || []).map(row => row.user_ids?.find(id => id !== currentUserId)).filter(Boolean))];
    if (friendIds.length === 0) {
      setFriendships(rows || []);
      setProfilesById(new Map());
      setLoading(false);
      return;
    }
    const { data: profiles } = await supabase.from("profiles").select("*").in("id", friendIds);
    setProfilesById(new Map((profiles || []).map(person => [person.id, person])));
    setFriendships(rows || []);
    setLoading(false);
  }, [currentUserId]);

  useEffect(() => {
    const id = window.setTimeout(() => loadFriends(), 0);
    return () => window.clearTimeout(id);
  }, [loadFriends]);

  const enrichedFriendships = useMemo(() => friendships.map(friendship => {
    const otherId = friendship.user_ids?.find(id => id !== currentUserId);
    return { ...friendship, otherId, profile: profilesById.get(otherId) };
  }).filter(item => item.otherId), [friendships, currentUserId, profilesById]);

  const acceptedFriends = enrichedFriendships.filter(item => item.status === "accepted" && item.profile);
  const incomingRequests = enrichedFriendships.filter(item => item.status === "pending" && item.friend_id === currentUserId && item.profile);
  const outgoingRequests = enrichedFriendships.filter(item => item.status === "pending" && item.requester_id === currentUserId && item.profile);

  const loadMessages = useCallback(async (friendshipId) => {
    const { data, error } = await supabase.from("messages").select("*").eq("friendship_id", friendshipId).order("created_at", { ascending: true });
    if (error) {
      setMessage(error.message);
      setChatMessages([]);
      return;
    }
    setChatMessages(data || []);
  }, []);

  useEffect(() => {
    if (!selectedChat) return undefined;
    const firstLoad = window.setTimeout(() => loadMessages(selectedChat.id), 0);
    const intervalId = window.setInterval(() => loadMessages(selectedChat.id), 5000);
    return () => {
      window.clearTimeout(firstLoad);
      window.clearInterval(intervalId);
    };
  }, [selectedChat, loadMessages]);

  const handleSearch = async () => {
    const username = search.trim().replace(/^@/, "").toLowerCase();
    setMessage("");
    setResults([]);
    if (username.length < 3) { setMessage("Type at least 3 characters"); return; }
    setSearching(true);
    const { data, error } = await supabase.from("profiles").select("*").eq("username", username).limit(5);
    if (error) setMessage(error.message);
    else setResults((data || []).filter(person => person.id !== currentUserId));
    setSearching(false);
  };

  const requestFriend = async (person) => {
    setMessage("");
    const friendshipId = friendDocId(currentUserId, person.id);
    const existing = friendships.find(item => item.id === friendshipId);
    if (existing?.status === "accepted") {
      setMessage("You are already friends");
      return;
    }
    if (existing?.status === "pending") {
      setMessage(existing.requester_id === currentUserId ? "Friend request already sent" : "This person already sent you a request");
      return;
    }
    const { error } = await supabase.from("friends").insert({
      id: friendshipId,
      user_ids: [currentUserId, person.id],
      requester_id: currentUserId,
      friend_id: person.id,
      status: "pending",
    });
    if (error) {
      setMessage(error.message.includes("already") || error.message.includes("duplicate") ? "Friend request already exists" : error.message);
      return;
    }
    setResults([]);
    setSearch("");
    setMessage(`Friend request sent to @${person.username}`);
    loadFriends();
  };

  const acceptRequest = async (friendship) => {
    const { error } = await supabase.from("friends").update({ status: "accepted", accepted_at: new Date().toISOString() }).eq("id", friendship.id);
    if (error) { setMessage(error.message); return; }
    setMessage(`You are now friends with @${friendship.profile.username}`);
    loadFriends();
  };

  const declineRequest = async (friendship) => {
    const { error } = await supabase.from("friends").delete().eq("id", friendship.id);
    if (error) { setMessage(error.message); return; }
    setMessage(`Declined @${friendship.profile.username}`);
    loadFriends();
  };

  const removeFriend = async (friendshipId, username) => {
    const ok = window.confirm(`Remove @${username} from your friends?`);
    if (!ok) return;
    const { error } = await supabase.from("friends").delete().eq("id", friendshipId);
    if (error) { setMessage(error.message); return; }
    setFriendships(prev => prev.filter(item => item.id !== friendshipId));
    if (selectedChat?.id === friendshipId) {
      setSelectedChat(null);
      setChatMessages([]);
    }
    setMessage(`Removed @${username}`);
  };

  const sendMessage = async () => {
    const text = chatText.trim();
    if (!selectedChat || !text) return;
    setSending(true);
    const { error } = await supabase.from("messages").insert({
      friendship_id: selectedChat.id,
      user_ids: selectedChat.user_ids,
      sender_id: currentUserId,
      text,
    });
    if (error) setMessage(error.message);
    else {
      setChatText("");
      await loadMessages(selectedChat.id);
    }
    setSending(false);
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 960, background: "rgba(6,10,18,0.76)",
      display: "flex", alignItems: isMobile ? "stretch" : "center", justifyContent: "center", padding: isMobile ? 0 : 24,
      backdropFilter: "blur(12px)",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: isMobile ? "100vw" : "min(920px, calc(100vw - 32px))", maxHeight: isMobile ? "100dvh" : "calc(100vh - 48px)",
        height: isMobile ? "100dvh" : "auto", overflow: "hidden", borderRadius: isMobile ? 0 : 24, background: "rgba(17,24,39,0.96)",
        border: `1px solid ${palette.line}`, boxShadow: "0 28px 90px rgba(0,0,0,0.46)",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: isMobile ? "16px 18px" : "22px 24px", borderBottom: `1px solid ${palette.line}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Friends</h2>
            <div style={{ marginTop: 4, color: palette.muted, fontSize: 12 }}>Send requests, accept friends, and chat</div>
          </div>
          <button onClick={onClose} style={{ ...secondaryBtnStyle, padding: "10px 14px" }}>Close</button>
        </div>

        <div style={{ overflowY: "auto", padding: isMobile ? 16 : 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr auto", gap: 10, marginBottom: 14 }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()} placeholder="Search username, e.g. golden_skyline37" style={inputStyle} />
            <button onClick={handleSearch} disabled={searching} style={{ ...authBtnStyle, width: "auto", minWidth: 110 }}>{searching ? "Searching..." : "Search"}</button>
          </div>

          {message && <div style={{ marginBottom: 14, fontSize: 12, color: /sent|friends|removed|declined/i.test(message) ? "#4ade80" : "#F2C36B" }}>{message}</div>}

          {results.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <h3 style={{ margin: "0 0 10px", fontSize: 14 }}>Search Results</h3>
              <div style={{ display: "grid", gap: 10 }}>
                {results.map(person => (
                  <FriendRow key={person.id} person={person} actionLabel="Send Request" onAction={() => requestFriend(person)} />
                ))}
              </div>
            </div>
          )}

          {incomingRequests.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <h3 style={{ margin: "0 0 10px", fontSize: 14 }}>Friend Requests</h3>
              <div style={{ display: "grid", gap: 10 }}>
                {incomingRequests.map(item => (
                  <FriendRow key={item.id} person={item.profile} actionLabel="Accept" onAction={() => acceptRequest(item)} secondaryActionLabel="Decline" onSecondaryAction={() => declineRequest(item)} />
                ))}
              </div>
            </div>
          )}

          {outgoingRequests.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <h3 style={{ margin: "0 0 10px", fontSize: 14 }}>Sent Requests</h3>
              <div style={{ display: "grid", gap: 10 }}>
                {outgoingRequests.map(item => (
                  <FriendRow key={item.id} person={item.profile} actionLabel="Cancel" danger onAction={() => declineRequest(item)} statusText="Waiting for accept" />
                ))}
              </div>
            </div>
          )}

          <h3 style={{ margin: "0 0 10px", fontSize: 14 }}>Your Friends</h3>
          {loading ? <div style={{ color: palette.muted }}>Loading friends...</div> : acceptedFriends.length === 0 ? (
            <div style={{ color: palette.muted, padding: 18, borderRadius: 16, border: `1px solid ${palette.line}`, background: "rgba(255,255,255,0.05)" }}>No friends yet.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(260px, 0.8fr) minmax(0, 1.2fr)", gap: 14 }}>
              <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
                {acceptedFriends.map(item => (
                  <FriendRow key={item.id} person={item.profile} actionLabel="Chat" active={selectedChat?.id === item.id} onAction={() => { setChatMessages([]); setSelectedChat(item); }} secondaryActionLabel="Remove" onSecondaryAction={() => removeFriend(item.id, item.profile.username)} dangerSecondary />
                ))}
              </div>
              <div style={{ minHeight: 280, border: `1px solid ${palette.line}`, borderRadius: 18, background: "rgba(255,255,255,0.045)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                {selectedChat ? (
                  <>
                    <div style={{ padding: "12px 14px", borderBottom: `1px solid ${palette.line}`, fontWeight: 800 }}>Chat with @{selectedChat.profile.username}</div>
                    <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                      {chatMessages.length === 0 ? <div style={{ color: palette.muted, fontSize: 13 }}>No messages yet.</div> : chatMessages.map(item => {
                        const mine = item.sender_id === currentUserId;
                        return (
                          <div key={item.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%" }}>
                            <div style={{ padding: "9px 11px", borderRadius: mine ? "14px 14px 3px 14px" : "14px 14px 14px 3px", background: mine ? "rgba(66,217,184,0.22)" : "rgba(255,255,255,0.08)", color: palette.text, fontSize: 13, lineHeight: 1.35, wordBreak: "break-word" }}>{item.text}</div>
                            <div style={{ marginTop: 3, textAlign: mine ? "right" : "left", color: palette.muted, fontSize: 10 }}>{item.created_at ? new Date(item.created_at).toLocaleString() : ""}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, padding: 12, borderTop: `1px solid ${palette.line}` }}>
                      <input value={chatText} onChange={(e) => setChatText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMessage()} placeholder="Write a message" style={inputStyle} />
                      <button onClick={sendMessage} disabled={sending || !chatText.trim()} style={{ ...authBtnStyle, width: "auto", minWidth: 82, padding: "0 14px", opacity: sending || !chatText.trim() ? 0.55 : 1 }}>Send</button>
                    </div>
                  </>
                ) : (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: palette.muted, padding: 20, textAlign: "center" }}>Select a friend to start chatting.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FriendRow({ person, actionLabel, onAction, secondaryActionLabel, onSecondaryAction, danger = false, dangerSecondary = false, statusText = "", active = false }) {
  const isMobile = useIsMobile();
  return (
    <div style={{ padding: 14, border: `1px solid ${active ? palette.mint : palette.line}`, borderRadius: 16, background: active ? "rgba(66,217,184,0.1)" : "rgba(255,255,255,0.055)", display: "flex", alignItems: "center", gap: 12, flexWrap: isMobile ? "wrap" : "nowrap" }}>
      <div style={{
        width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
        background: person.avatar_url ? `url(${person.avatar_url}) center/cover` : `linear-gradient(135deg, ${palette.accent}, ${palette.sky})`,
        display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800,
      }}>
        {!person.avatar_url && (person.username?.charAt(0).toUpperCase() || "?")}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800 }}>@{person.username}</div>
        <div style={{ color: palette.muted, fontSize: 11, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{person.id}</div>
        {statusText && <div style={{ color: palette.gold, fontSize: 11, marginTop: 3 }}>{statusText}</div>}
      </div>
      <div style={{ display: "flex", gap: 8, width: isMobile ? "100%" : "auto", justifyContent: isMobile ? "flex-end" : "initial" }}>
        {secondaryActionLabel && <button onClick={onSecondaryAction} style={{ ...(dangerSecondary ? dangerBtnStyle : secondaryBtnStyle), padding: "9px 11px", fontSize: 12, flexShrink: 0 }}>{secondaryActionLabel}</button>}
        <button onClick={onAction} style={{ ...(danger ? dangerBtnStyle : secondaryBtnStyle), padding: "9px 11px", fontSize: 12, flexShrink: 0 }}>{actionLabel}</button>
      </div>
    </div>
  );
}

function Lightbox({ pin, onClose, onDelete }) {
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
          {onDelete && <button onClick={() => onDelete(pin)} style={{ ...dangerBtnStyle, marginTop: 14 }}>Delete Photo</button>}
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
  const [forgotMode, setForgotMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const handleSubmit = async () => {
    setError(""); setLoading(true);
    if (!email || !password) { setError("Please fill in both fields"); setLoading(false); return; }
    if (!isLogin) {
      const passwordError = passwordComplexityError(password);
      if (passwordError) { setError(passwordError); setLoading(false); return; }
    }
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

  const handleForgotPassword = async () => {
    setError("");
    if (!email) { setError("Enter your email address first"); return; }
    setLoading(true);
    const { error: e } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (e) setError(e.message);
    else setResetSent(true);
    setLoading(false);
  };

  if (forgotMode || resetSent) return (
    <div style={authContainerStyle}>
      <Fonts />
      <div style={authCardStyle}>
        <div style={{ textAlign: "center", marginBottom: 28 }}><BrandLockup /></div>
        <h2 style={authTitleStyle}>{resetSent ? "Check your email" : "Reset password"}</h2>
        {resetSent ? (
          <p style={{ opacity: 0.55, fontSize: 14, textAlign: "center", lineHeight: 1.6 }}>
            We sent a password reset link to <strong>{email}</strong>.
          </p>
        ) : (
          <>
            <input type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleForgotPassword()} style={inputStyle} />
            {error && <div style={{ background: "rgba(230,57,70,0.1)", border: "1px solid rgba(230,57,70,0.3)", color: "#E63946", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginTop: 12 }}>{error}</div>}
            <button onClick={handleForgotPassword} disabled={loading} style={{ ...authBtnStyle, marginTop: 16, opacity: loading ? 0.6 : 1 }}>{loading ? "Sending..." : "Send Reset Link"}</button>
          </>
        )}
        <button onClick={() => { setForgotMode(false); setResetSent(false); setError(""); }} style={{ ...secondaryBtnStyle, width: "100%", marginTop: 14 }}>Back to Login</button>
      </div>
    </div>
  );

  if (confirmSent) return (
    <div style={authContainerStyle}>
      <Fonts />
      <div style={authCardStyle}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}><LogoMark size={52} /></div>
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
      <div style={{ width: "min(980px, calc(100vw - 32px))", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 24, alignItems: "stretch", position: "relative", zIndex: 10 }}>
      <div style={{ ...authCardStyle, width: "100%", maxWidth: "none", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <BrandLockup align="left" titleSize={38} />
        <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 34, lineHeight: 1.05, margin: "28px 0 12px" }}>Turn your photos into a travel map</h2>
        <p style={{ color: palette.muted, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
          Footprint reads GPS data from your photos, places them on a map, and builds a visual timeline of where you have been. You can upload JPG, PNG, HEIC, explore popular places, and revisit each memory by clicking its photo.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 24 }}>
          {["Upload", "Map", "Remember"].map((label, index) => (
            <div key={label} style={{ padding: 12, borderRadius: 14, background: "rgba(255,255,255,0.07)", border: `1px solid ${palette.line}` }}>
              <div style={{ color: [palette.mint, palette.gold, palette.sky][index], fontWeight: 800, fontSize: 20 }}>{index + 1}</div>
              <div style={{ marginTop: 4, fontSize: 12, fontWeight: 700 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={authCardStyle}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <BrandLockup />
        </div>
        <h2 style={authTitleStyle}>{isLogin ? "Welcome back" : "Create account"}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSubmit()} style={inputStyle} />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSubmit()} style={inputStyle} />
        </div>
        {!isLogin && <div style={{ marginTop: 8, color: palette.muted, fontSize: 12, lineHeight: 1.4 }}>{PASSWORD_HELP}</div>}
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
        {isLogin && <button onClick={() => { setForgotMode(true); setError(""); }} style={{ width: "100%", marginTop: 14, background: "none", border: "none", color: palette.mint, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>Forgot password?</button>}
      </div>
      </div>
    </div>
  );
}

// ─── Username Setup Screen ───
function PasswordResetScreen({ resetCode, onComplete }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handlePasswordReset = async () => {
    setError("");
    const passwordError = passwordComplexityError(password);
    if (passwordError) { setError(passwordError); return; }
    if (password !== confirmPassword) { setError("Passwords do not match"); return; }
    setLoading(true);
    const { error: e } = resetCode
      ? await supabase.auth.confirmPasswordReset({ code: resetCode, password })
      : await supabase.auth.updateUser({ password });
    if (e) setError(e.message);
    else {
      window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
      onComplete();
    }
    setLoading(false);
  };

  return (
    <div style={authContainerStyle}>
      <Fonts />
      <div style={authCardStyle}>
        <div style={{ textAlign: "center", marginBottom: 28 }}><BrandLockup /></div>
        <h2 style={authTitleStyle}>Choose a new password</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input type="password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handlePasswordReset()} style={inputStyle} />
          <input type="password" placeholder="Confirm password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handlePasswordReset()} style={inputStyle} />
        </div>
        <div style={{ marginTop: 8, color: palette.muted, fontSize: 12, lineHeight: 1.4 }}>{PASSWORD_HELP}</div>
        {error && <div style={{ background: "rgba(230,57,70,0.1)", border: "1px solid rgba(230,57,70,0.3)", color: "#E63946", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginTop: 12 }}>{error}</div>}
        <button onClick={handlePasswordReset} disabled={loading} style={{ ...authBtnStyle, marginTop: 16, opacity: loading ? 0.6 : 1 }}>{loading ? "Updating..." : "Update Password"}</button>
      </div>
    </div>
  );
}

function UsernameSetup({ user, onComplete }) {
  const [username, setUsername] = useState("");
  const [avatar, setAvatar] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [generatingName, setGeneratingName] = useState(false);
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

  const generateUsername = async () => {
    setGeneratingName(true);
    setError("");
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = randomUsernameCandidate();
      const { data } = await supabase.from("profiles").select("id").eq("username", candidate).limit(1);
      if (!data?.length) {
        setUsername(candidate);
        setGeneratingName(false);
        return;
      }
    }
    setUsername(randomUsernameCandidate());
    setGeneratingName(false);
  };

  const handleSubmit = async () => {
    if (username.length < 3) { setError("Username must be at least 3 characters"); return; }
    if (error) return;
    setLoading(true);
    const userId = user.id || user.uid;
    const { error: insertErr } = await supabase.from("profiles").insert({
      id: userId, user_id: userId, email: user.email || "", username, avatar_url: avatar,
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

        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 22 }}>
          {DEFAULT_AVATARS.map((preset) => (
            <button key={preset.name} type="button" title={preset.name} onClick={() => setAvatar(preset.image)} style={{
              width: "100%", aspectRatio: "1", borderRadius: "50%", border: avatar === preset.image ? `2px solid ${palette.mint}` : `1px solid ${palette.line}`,
              background: `url(${preset.image}) center/cover`, cursor: "pointer", boxShadow: avatar === preset.image ? "0 0 0 3px rgba(66,217,184,0.14)" : "none",
            }} />
          ))}
        </div>

        {/* Username input */}
        <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
          <div style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", opacity: 0.4, fontSize: 14 }}>@</div>
          <input
            type="text" placeholder="username" value={username}
            onChange={handleUsernameChange}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            style={{ ...inputStyle, paddingLeft: 32 }}
            maxLength={20}
          />
          <button type="button" onClick={generateUsername} disabled={generatingName} style={{ ...secondaryBtnStyle, padding: "0 14px", whiteSpace: "nowrap", opacity: generatingName ? 0.55 : 1 }}>
            {generatingName ? "..." : "Generate"}
          </button>
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
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [generatingName, setGeneratingName] = useState(false);
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

  const generateUsername = async () => {
    setGeneratingName(true);
    setError("");
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = randomUsernameCandidate();
      const { data } = await supabase.from("profiles").select("id").eq("username", candidate).limit(1);
      if (!data?.length) {
        setUsername(candidate);
        setGeneratingName(false);
        return;
      }
    }
    setUsername(randomUsernameCandidate());
    setGeneratingName(false);
  };

  const handleSave = async () => {
    if (username.length < 3) { setError("Username must be at least 3 characters"); return; }
    if (error) return;
    setLoading(true);
    const { error: updateErr } = await supabase.from("profiles").update({
      username, avatar_url: avatar, user_id: profile.id,
    }).eq("id", profile.id);

    if (updateErr) {
      if (updateErr.message.includes("unique") || updateErr.message.includes("duplicate")) setError("Username is already taken");
      else setError(updateErr.message);
      setLoading(false); return;
    }
    onSave({ ...profile, username, avatar_url: avatar });
  };

  const handleChangePassword = async () => {
    setPasswordMessage("");
    const passwordError = passwordComplexityError(newPassword);
    if (passwordError) { setPasswordMessage(passwordError); return; }
    if (newPassword !== confirmPassword) { setPasswordMessage("Passwords do not match"); return; }
    setPasswordLoading(true);
    const { error: e } = await supabase.auth.updateUser({ password: newPassword });
    if (e) setPasswordMessage(e.message);
    else {
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("Password updated");
    }
    setPasswordLoading(false);
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 900, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
      backdropFilter: "blur(8px)",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        ...authCardStyle, maxWidth: 420, maxHeight: "calc(100vh - 40px)", overflowY: "auto", animation: "fadeIn 0.2s ease",
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

        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 22 }}>
          {DEFAULT_AVATARS.map((preset) => (
            <button key={preset.name} type="button" title={preset.name} onClick={() => setAvatar(preset.image)} style={{
              width: "100%", aspectRatio: "1", borderRadius: "50%", border: avatar === preset.image ? `2px solid ${palette.mint}` : `1px solid ${palette.line}`,
              background: `url(${preset.image}) center/cover`, cursor: "pointer", boxShadow: avatar === preset.image ? "0 0 0 3px rgba(66,217,184,0.14)" : "none",
            }} />
          ))}
        </div>

        <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
          <div style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", opacity: 0.4, fontSize: 14 }}>@</div>
          <input type="text" value={username} onChange={handleUsernameChange} style={{ ...inputStyle, paddingLeft: 32 }} maxLength={20} />
          <button type="button" onClick={generateUsername} disabled={generatingName} style={{ ...secondaryBtnStyle, padding: "0 14px", whiteSpace: "nowrap", opacity: generatingName ? 0.55 : 1 }}>
            {generatingName ? "..." : "Generate"}
          </button>
        </div>
        {checking && <div style={{ fontSize: 12, opacity: 0.4, marginTop: 6 }}>Checking availability...</div>}
        {error && <div style={{ background: "rgba(230,57,70,0.1)", border: "1px solid rgba(230,57,70,0.3)", color: "#E63946", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginTop: 12 }}>{error}</div>}
        {!error && username.length >= 3 && !checking && username !== origUsername && <div style={{ fontSize: 12, color: "#4ade80", marginTop: 6 }}>✓ Username available</div>}

        <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "22px 0" }} />
        <h3 style={{ margin: "0 0 12px", fontSize: 13, letterSpacing: "0.6px", opacity: 0.6, fontWeight: 700 }}>CHANGE PASSWORD</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input type="password" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={inputStyle} />
          <input type="password" placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ marginTop: 8, color: palette.muted, fontSize: 12, lineHeight: 1.4 }}>{PASSWORD_HELP}</div>
        {passwordMessage && <div style={{ color: passwordMessage === "Password updated" ? "#4ade80" : "#E63946", fontSize: 12, marginTop: 8 }}>{passwordMessage}</div>}
        <button onClick={handleChangePassword} disabled={passwordLoading || !newPassword || !confirmPassword} style={{
          ...secondaryBtnStyle, width: "100%", marginTop: 12,
          opacity: (passwordLoading || !newPassword || !confirmPassword) ? 0.45 : 1,
          cursor: (passwordLoading || !newPassword || !confirmPassword) ? "not-allowed" : "pointer",
        }}>
          {passwordLoading ? "Updating..." : "Change Password"}
        </button>

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
function SlippyMap({ pins, center, zoom, onPinClick, heatPoints = [], onHeatPointClick, onMapClick, placementMode = false, currentLocation = null }) {
  const containerRef = useRef(null);
  const dragging = useRef(false);
  const dragMoved = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const [mapState, setMapState] = useState({ center, zoom });
  const [isDragging, setIsDragging] = useState(false);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [hoveredPin, setHoveredPin] = useState(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect
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
  const maxHeat = Math.max(1, ...heatPoints.map(point => point.count || 1));
  const heatPos = heatPoints.map((p) => {
    const pp = degToNum(p.lat, p.lon, z);
    return { ...p, x: pp.x * tileSize - tlPX, y: pp.y * tileSize - tlPY, strength: (p.count || 1) / maxHeat };
  });
  const currentLocationPos = currentLocation ? (() => {
    const pp = degToNum(currentLocation.lat, currentLocation.lon, z);
    return { ...currentLocation, x: pp.x * tileSize - tlPX, y: pp.y * tileSize - tlPY };
  })() : null;

  const handlePointerDown = (e) => { dragging.current = true; setIsDragging(true); dragMoved.current = false; lastPos.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); };
  const handlePointerMove = (e) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x, dy = e.clientY - lastPos.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setMapState((prev) => { const c2 = degToNum(prev.center.lat, prev.center.lon, prev.zoom); const nc = numToDeg(c2.x - dx / tileSize, c2.y - dy / tileSize, prev.zoom); return { ...prev, center: { lat: nc.lat, lon: nc.lon } }; });
  };
  const handlePointerUp = () => { dragging.current = false; setIsDragging(false); };
  const openPin = (pin) => {
    dragging.current = false;
    dragMoved.current = false;
    setIsDragging(false);
    if (onPinClick) onPinClick(pin);
  };
  const openHeatPoint = (point) => {
    dragging.current = false;
    dragMoved.current = false;
    setIsDragging(false);
    if (point.thumb && onHeatPointClick) onHeatPointClick(point);
  };
  const handleContainerClick = (e) => {
    if (dragMoved.current || !onMapClick || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const c2 = degToNum(mapState.center.lat, mapState.center.lon, mapState.zoom);
    const tlX = c2.x * tileSize - size.w / 2;
    const tlY = c2.y * tileSize - size.h / 2;
    onMapClick(numToDeg((tlX + px) / tileSize, (tlY + py) / tileSize, mapState.zoom));
  };
  const handleWheel = (e) => { e.preventDefault(); setMapState((p) => ({ ...p, zoom: Math.max(1, Math.min(18, p.zoom + (e.deltaY > 0 ? -1 : 1))) })); };

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", cursor: isDragging ? "grabbing" : placementMode ? "crosshair" : "grab", touchAction: "none", borderRadius: "16px" }}
      onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onWheel={handleWheel} onClick={handleContainerClick}>
      {tiles.map((t) => <img key={t.key} src={t.url} alt="" style={{ position: "absolute", left: t.left, top: t.top, width: tileSize, height: tileSize, pointerEvents: "none" }} draggable={false} />)}
      {heatPos.map((point, i) => (
        <div key={`${point.lat}-${point.lon}-${i}`} title={`${point.place}: ${point.count} public uploads`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); openHeatPoint(point); }} style={{
          position: "absolute",
          left: point.x,
          top: point.y,
          width: 50 + point.strength * 82,
          height: 50 + point.strength * 82,
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(255,107,74,${0.68 + point.strength * 0.22}) 0%, rgba(242,195,107,${0.38 + point.strength * 0.22}) 44%, rgba(66,217,184,0.16) 68%, rgba(66,217,184,0) 78%)`,
          boxShadow: `0 0 ${26 + point.strength * 30}px rgba(255,107,74,0.42)`,
          pointerEvents: point.thumb && onHeatPointClick ? "auto" : "none",
          cursor: point.thumb && onHeatPointClick ? "zoom-in" : "default",
          zIndex: 7,
        }}>
          {point.thumb && (
            <button type="button" style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 38,
              height: 38,
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              overflow: "hidden",
              border: "2px solid white",
              boxShadow: "0 8px 20px rgba(17,24,39,0.28)",
              background: "rgba(17,24,39,0.55)",
              padding: 0,
              cursor: "zoom-in",
            }}>
              <img src={point.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} draggable={false} />
            </button>
          )}
        </div>
      ))}
      {currentLocationPos && (
        <div
          title="Your current location"
          style={{
            position: "absolute",
            left: currentLocationPos.x,
            top: currentLocationPos.y,
            transform: "translate(-50%, -50%)",
            zIndex: 18,
            pointerEvents: "none",
          }}
        >
          <div style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "rgba(66,217,184,0.18)",
            border: "1px solid rgba(66,217,184,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 0 10px rgba(66,217,184,0.08)",
          }}>
            <div style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: palette.mint,
              border: "3px solid white",
              boxShadow: "0 8px 22px rgba(17,24,39,0.35)",
            }} />
          </div>
          <div style={{
            position: "absolute",
            left: "50%",
            top: 54,
            transform: "translateX(-50%)",
            background: "rgba(17,24,39,0.9)",
            color: palette.text,
            border: `1px solid ${palette.line}`,
            borderRadius: 10,
            padding: "5px 8px",
            fontSize: 11,
            fontWeight: 800,
            whiteSpace: "nowrap",
          }}>
            You are here
          </div>
        </div>
      )}
      {pinPos.map((p, i) => (
        <div key={p.id || i} style={{ position: "absolute", left: p.x, top: p.y, transform: "translate(-50%, -100%)", zIndex: hoveredPin === i ? 20 : 10, cursor: "zoom-in" }}
          onPointerEnter={() => setHoveredPin(i)} onPointerLeave={() => setHoveredPin(null)}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); openPin(p); }}>
          <svg width="32" height="42" viewBox="0 0 32 42" fill="none" style={{ cursor: "zoom-in" }}>
            <path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 26 16 26s16-14 16-26C32 7.16 24.84 0 16 0z" fill="#E63946"/><circle cx="16" cy="15" r="7" fill="white"/>
          </svg>
          {hoveredPin === i && (
            <div style={{ position: "absolute", bottom: 48, left: "50%", transform: "translateX(-50%)", background: "rgba(15,15,15,0.92)", color: "#fff", padding: "8px 14px", borderRadius: 10, fontSize: 13, whiteSpace: "nowrap", pointerEvents: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.3)", fontFamily: "'DM Sans', sans-serif" }}>
              <div style={{ fontWeight: 700 }}>{p.place}</div>
              {p.date && <div style={{ opacity: 0.7, fontSize: 11, marginTop: 2 }}>{p.date}</div>}
            </div>
          )}
          {p.thumb && (
            <button type="button" title="Open photo" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); openPin(p); }} style={{ position: "absolute", bottom: 46, left: "50%", transform: "translateX(-50%)", width: 50, height: 50, borderRadius: "50%", overflow: "hidden", border: "3px solid white", boxShadow: "0 2px 12px rgba(0,0,0,0.3)", display: "block", cursor: "zoom-in", padding: 0, background: "rgba(17,24,39,0.55)" }}>
              <img src={p.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} draggable={false} />
            </button>
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

function TutorialModal({ onClose }) {
  const steps = [
    { title: "Add travel photos", body: "Upload photos from your trips. Footprint reads GPS metadata and places each photo where it was taken." },
    { title: "Explore your map", body: "Click map pins or timeline photos to view memories bigger, then delete individual uploads when you need to clean up." },
    { title: "Find popular places", body: "Use Popular Places to see heatmap areas from photos people chose to share publicly." },
    { title: "Make it yours", body: "Open Edit Profile to change your avatar, generate a username, or update your password." },
  ];
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1200, background: "rgba(6,10,18,0.78)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      backdropFilter: "blur(12px)",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(720px, calc(100vw - 32px))", borderRadius: 24,
        background: "linear-gradient(180deg, rgba(255,255,255,0.13), rgba(255,255,255,0.06))",
        border: `1px solid ${palette.line}`, boxShadow: "0 28px 90px rgba(0,0,0,0.46)",
        padding: 28, color: palette.text,
      }}>
        <BrandLockup align="left" titleSize={28} compact />
        <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 30, margin: "24px 0 8px" }}>How Footprint works</h2>
        <p style={{ color: palette.muted, fontSize: 14, lineHeight: 1.7, margin: "0 0 22px" }}>
          Build a private-feeling travel map from your own photos, then compare it with popular places other users have visited.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {steps.map((step, index) => (
            <div key={step.title} style={{ padding: 16, borderRadius: 16, background: "rgba(255,255,255,0.07)", border: `1px solid ${palette.line}` }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: [palette.mint, palette.gold, palette.sky, palette.accent][index], color: palette.ink, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, marginBottom: 12 }}>{index + 1}</div>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>{step.title}</div>
              <div style={{ color: palette.muted, fontSize: 13, lineHeight: 1.55 }}>{step.body}</div>
            </div>
          ))}
        </div>
        <button onClick={onClose} style={{ ...authBtnStyle, marginTop: 22 }}>Start Mapping</button>
      </div>
    </div>
  );
}

const zoomBtnStyle = { width: 36, height: 36, border: "none", borderRadius: 10, background: "rgba(255,255,255,0.94)", cursor: "pointer", fontSize: 20, fontWeight: 700, color: palette.ink, boxShadow: "0 2px 10px rgba(17,24,39,0.18)", display: "flex", alignItems: "center", justifyContent: "center" };

// ─── Styles ───
const authContainerStyle = { width: "100%", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif", background: "linear-gradient(145deg, #101827 0%, #17243A 42%, #22312C 100%)", color: palette.text, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden", padding: 20 };
const authCardStyle = { width: "min(420px, calc(100vw - 40px))", maxWidth: 420, padding: "40px 36px", background: "linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.055))", border: `1px solid ${palette.line}`, borderRadius: 24, backdropFilter: "blur(14px)", position: "relative", zIndex: 10, boxShadow: "0 26px 80px rgba(0,0,0,0.32)", boxSizing: "border-box" };
const authTitleStyle = { fontFamily: "'DM Sans', sans-serif", fontSize: 18, fontWeight: 600, margin: "0 0 20px", textAlign: "center", opacity: 0.8 };
const inputStyle = { width: "100%", padding: "14px 16px", background: "rgba(255,255,255,0.085)", border: `1px solid ${palette.line}`, borderRadius: 14, color: palette.text, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: "none", boxSizing: "border-box" };
const authBtnStyle = { width: "100%", padding: "14px", background: `linear-gradient(135deg, ${palette.accent}, ${palette.accentDark})`, color: "white", border: "none", borderRadius: 14, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", boxShadow: "0 12px 28px rgba(255,107,74,0.28)" };
const secondaryBtnStyle = { padding: "12px 16px", background: "rgba(255,255,255,0.09)", color: palette.text, border: `1px solid ${palette.line}`, borderRadius: 14, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" };
const dangerBtnStyle = { padding: "9px 12px", background: "rgba(255,107,74,0.16)", color: "#FFB19F", border: "1px solid rgba(255,107,74,0.35)", borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" };
const adminStatStyle = { padding: 16, borderRadius: 16, background: "rgba(255,255,255,0.06)", border: `1px solid ${palette.line}`, display: "flex", flexDirection: "column", gap: 4 };

function Fonts() { return <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet" />; }

// ─── Main App ───
export default function App() {
  const initialPasswordResetCode = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("mode") === "resetPassword" ? (params.get("oobCode") || "") : "";
  }, []);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [needsPasswordReset, setNeedsPasswordReset] = useState(() => Boolean(initialPasswordResetCode));
  const [passwordResetCode, setPasswordResetCode] = useState(initialPasswordResetCode);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showFriendsPanel, setShowFriendsPanel] = useState(false);
  const [showProfilePreview, setShowProfilePreview] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [lightboxPin, setLightboxPin] = useState(null);
  const [pins, setPins] = useState([]);
  const [allLocations, setAllLocations] = useState([]);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatmapScope, setHeatmapScope] = useState("global");
  const [processing, setProcessing] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState([]);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [center, setCenter] = useState({ lat: 1.35, lon: 103.82 });
  const [zoom, setZoom] = useState(3);
  const [selectedPin, setSelectedPin] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false); // mobile sidebar toggle
  const [publicSamplePin, setPublicSamplePin] = useState(null);
  const isMobile = useIsMobile();
  const fileInputRef = useRef(null);

  const stats = useMemo(() => ({
    countries: new Set(pins.map(p => p.country).filter(Boolean)).size,
    cities: new Set(pins.map(p => p.city).filter(Boolean)).size,
  }), [pins]);
  const publicHeatPoints = useMemo(() => groupHeatPoints(allLocations), [allLocations]);
  const ownHeatPoints = useMemo(() => groupHeatPoints(pins), [pins]);
  const activeHeatPoints = heatmapScope === "own" ? ownHeatPoints : publicHeatPoints;
  const activeHeatLabel = heatmapScope === "own" ? "your place groups" : "global place groups";
  const globalUploadDisplayCount = allLocations.length * 100000;
  const isAdmin = profile?.role === "admin" || ADMIN_EMAILS.includes(user?.email?.toLowerCase() || "");

  const locateCurrentUser = useCallback(async ({ centerMap = false, timeout = 8000 } = {}) => {
    if (!navigator.geolocation) return null;
    const pos = await new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(p => resolve(p), () => resolve(null), { timeout });
    });
    if (!pos) return null;

    const geo = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
    const location = { lat: pos.coords.latitude, lon: pos.coords.longitude, place: geo.display };
    setCurrentLocation(location);
    if (centerMap) {
      setCenter({ lat: location.lat, lon: location.lon });
      setZoom(14);
    }
    return location;
  }, []);

  const loadGlobalHeatmapLocations = useCallback(async () => {
    const { data, error } = await supabase.rpc("global_heatmap_locations");
    if (!error) {
      const rows = await Promise.all((data || []).map(async (row) => ({
        ...row,
        thumb: await displayablePhotoUrl(row.photo_url || null, row.file_name || ""),
      })));
      setAllLocations(rows);
      return rows;
    }

    console.warn("Global heatmap query failed.", error);
    const { data: fallbackRows, error: fallbackError } = await supabase
      .from("locations")
      .select("*")
      .eq("is_public", true);

    if (fallbackError) {
      console.warn("Global heatmap fallback query failed.", fallbackError);
      setAllLocations([]);
      return [];
    }

    const publicRows = (fallbackRows || [])
      .filter(row => row.lat != null && row.lon != null)
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    const rows = await Promise.all(publicRows.map(async (row) => ({
      ...row,
      thumb: await displayablePhotoUrl(row.photo_url || null, row.file_name || ""),
    })));
    setAllLocations(rows);
    return rows;
  }, []);

  useEffect(() => {
    if (!user || needsUsername) return;
    if (localStorage.getItem("footprint_tutorial_seen") === "yes") return;
    localStorage.setItem("footprint_tutorial_seen", "yes");
    const id = window.setTimeout(() => setShowTutorial(true), 0);
    return () => window.clearTimeout(id);
  }, [user, needsUsername]);

  useEffect(() => {
    if (!user || needsUsername) return;
    const id = window.setTimeout(() => locateCurrentUser({ centerMap: true }), 0);
    return () => window.clearTimeout(id);
  }, [user, needsUsername, locateCurrentUser]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setCheckingAuth(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setNeedsPasswordReset(true);
      setUser(session?.user || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load profile when user logs in
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!user) { setProfile(null); setNeedsUsername(false); setPins([]); setAllLocations([]); setCurrentLocation(null); return; }
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
      const [{ data }] = await Promise.all([
        supabase.from("locations").select("*").eq("user_id", user.id).order("created_at", { ascending: true }),
        loadGlobalHeatmapLocations(),
      ]);
      if (data && data.length > 0) {
        const loaded = await Promise.all(data.map(async (r) => ({ id: r.id, lat: r.lat, lon: r.lon, place: r.place || "Unknown", city: r.city || "", country: r.country || "", date: r.date || null, thumb: await displayablePhotoUrl(r.photo_url || null, r.file_name || ""), fileName: r.file_name || "", isPublic: Boolean(r.is_public) })));
        setPins(loaded); fitMapToPins(loaded);
      }
      setLoading(false);
    }
    loadPins();
  }, [user, needsUsername, loadGlobalHeatmapLocations]);

  function fitMapToPins(all) {
    if (all.length === 0) { setCenter({ lat: 1.35, lon: 103.82 }); setZoom(3); }
    else if (all.length === 1) { setCenter({ lat: all[0].lat, lon: all[0].lon }); setZoom(10); }
    else if (all.length > 1) {
      const lats = all.map(p => p.lat), lons = all.map(p => p.lon);
      setCenter({ lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 });
      const d = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons));
      setZoom(d > 100 ? 2 : d > 50 ? 3 : d > 20 ? 4 : d > 5 ? 6 : d > 1 ? 8 : 11);
    }
  }

  const savePhotoAt = useCallback(async (file, lat, lon, thumb, date = null, isPublic = false) => {
    const geo = await reverseGeocode(lat, lon);
    const b64 = thumb || await safePhotoToDisplayDataUrl(file);
    const savedDate = date || todayDateString();
    if (!b64) {
      alert(isHeicLike(file)
        ? `Could not convert ${file.name} from HEIC. Please try exporting it as JPG, or use the original photo file from your Photos app.`
        : `Could not load ${file.name}. Please try exporting it as JPG or PNG.`);
      return null;
    }
    const { data, error } = await supabase.from("locations").insert({
      lat,
      lon,
      place: geo.display || "Unknown",
      city: geo.city || "",
      country: geo.country || "",
      date: savedDate,
      photo_url: b64,
      file_name: file.name,
      user_id: user.id,
      is_public: isPublic,
    }).select().single();
    if (error) {
      alert(error.message);
      return null;
    }
    const pin = { id: data.id, lat, lon, place: geo.display || "Unknown", city: geo.city, country: geo.country, date: savedDate, thumb: b64, fileName: file.name, isPublic };
    setPins(prev => {
      const all = [...prev, pin];
      fitMapToPins(all);
      return all;
    });
    if (isPublic) {
      setAllLocations(prev => [{ id: data.id, lat, lon, place: geo.display || "Unknown", thumb: b64, photo_url: b64, file_name: file.name }, ...prev]);
    }
    return pin;
  }, [user]);

  const processFiles = useCallback(async (files) => {
    if (!user) return;
    setProcessing(true);
    await new Promise(resolve => setTimeout(resolve, 30));
    try {
      const imgs = Array.from(files).filter(isPhotoFile);
      const queued = [];
      const noGps = [];
      for (const file of imgs) {
        const thumb = await safePhotoToDisplayDataUrl(file);
        if (!thumb) continue;
        const gps = await parseExifGPS(file);
        if (gps?.lat != null && gps?.lon != null) queued.push({ file, thumb, fileName: file.name, suggestion: { lat: gps.lat, lon: gps.lon, place: "GPS location from photo" }, date: gps.date || null, isPublic: false });
        else noGps.push({ file, thumb });
      }
      if (noGps.length > 0) {
        const suggestion = await Promise.race([
          locateCurrentUser({ centerMap: true, timeout: 6000 }),
          new Promise(resolve => setTimeout(() => resolve(null), 7000)),
        ]);
        queued.push(...noGps.map(({ file, thumb }) => ({ file, thumb, fileName: file.name, suggestion, date: null, isPublic: false })));
      }
      if (queued.length > 0) setPendingPhotos(prev => [...prev, ...queued]);
      if (imgs.length > 0 && queued.length === 0) alert("Could not load the selected image. For HEIC photos, try exporting as JPG or uploading the original photo file.");
      if (imgs.length === 0) alert("No supported image files found.");
    } finally {
      setProcessing(false);
    }
  }, [user, locateCurrentUser]);

  const clearAll = async () => {
    if (pins.length > 0) await supabase.from("locations").delete().in("id", pins.map(p => p.id));
    setPins([]); setSelectedPin(null); setCenter({ lat: 1.35, lon: 103.82 }); setZoom(3);
    setAllLocations(prev => prev.filter(location => !pins.some(pin => pin.id === location.id)));
  };

  const togglePopularPlaces = async () => {
    const latestHeatRows = heatmapScope === "own" ? pins : (showHeatmap ? allLocations : await loadGlobalHeatmapLocations());
    const latestHeatPoints = groupHeatPoints(latestHeatRows);
    const latestHeatView = heatmapCenter(latestHeatPoints);

    setShowHeatmap(value => {
      const next = !value;
      if (next && latestHeatPoints.length > 0) {
        setCenter(latestHeatView.center);
        setZoom(latestHeatView.zoom);
      } else if (!next) {
        fitMapToPins(pins);
      }
      return next;
    });
  };

  const chooseHeatmapScope = async (scope) => {
    setHeatmapScope(scope);
    const rows = scope === "own" ? pins : await loadGlobalHeatmapLocations();
    const points = groupHeatPoints(rows);
    const view = heatmapCenter(points);
    setShowHeatmap(true);
    if (points.length > 0) {
      setCenter(view.center);
      setZoom(view.zoom);
    }
  };

  const deletePin = async (pin) => {
    if (!pin?.id) return;
    const ok = window.confirm(`Delete ${pin.fileName || "this photo"} from your map?`);
    if (!ok) return;
    const { error } = await supabase.from("locations").delete().eq("id", pin.id).eq("user_id", user.id);
    if (error) { alert(error.message); return; }
    setLightboxPin(current => current?.id === pin.id ? null : current);
    setSelectedPin(current => current === pin.id ? null : current);
    setPins(prev => {
      const next = prev.filter(p => p.id !== pin.id);
      fitMapToPins(next);
      return next;
    });
    setAllLocations(prev => prev.filter(location => location.id !== pin.id));
  };

  const handleMapClick = useCallback(async (geo) => {
    if (pendingPhotos.length === 0) return;
    const [current, ...rest] = pendingPhotos;
    setPendingPhotos(rest);
    await savePhotoAt(current.file, geo.lat, geo.lon, current.thumb, current.date || null, Boolean(current.isPublic));
  }, [pendingPhotos, savePhotoAt]);

  const handleUseMyLocation = useCallback(async () => {
    if (pendingPhotos.length === 0 || !navigator.geolocation) return;
    const location = await locateCurrentUser({ centerMap: true });
    if (!location) {
      alert("Could not get your current location. Tap the map to place this photo.");
      return;
    }
    setPendingPhotos(prev => {
      const [first, ...rest] = prev;
      if (!first) return prev;
      return [{ ...first, suggestion: location }, ...rest];
    });
  }, [pendingPhotos, locateCurrentUser]);

  const handleConfirmSuggestion = useCallback(async () => {
    if (pendingPhotos.length === 0) return;
    const [current, ...rest] = pendingPhotos;
    if (!current.suggestion) return;
    setPendingPhotos(rest);
    await savePhotoAt(current.file, current.suggestion.lat, current.suggestion.lon, current.thumb, current.date || null, Boolean(current.isPublic));
  }, [pendingPhotos, savePhotoAt]);

  const updatePendingVisibility = useCallback((isPublic) => {
    setPendingPhotos(prev => {
      const [first, ...rest] = prev;
      if (!first) return prev;
      return [{ ...first, isPublic }, ...rest];
    });
  }, []);

  const handleDismissSuggestion = useCallback(() => {
    setPendingPhotos(prev => {
      const [first, ...rest] = prev;
      if (!first) return prev;
      return [{ ...first, suggestion: null }, ...rest];
    });
  }, []);

  const handleSkipPendingPhoto = useCallback(() => {
    setPendingPhotos(prev => prev.slice(1));
  }, []);

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
  if (needsPasswordReset) return <PasswordResetScreen resetCode={passwordResetCode} onComplete={() => { setNeedsPasswordReset(false); setPasswordResetCode(""); }} />;
  if (needsUsername) return <UsernameSetup user={user} onComplete={(p) => { setProfile({ id: user.id || user.uid, ...p }); setNeedsUsername(false); }} />;

  return (
    <div style={{ width: "100%", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif", background: "linear-gradient(145deg, #101827 0%, #17243A 42%, #22312C 100%)", color: palette.text, position: "relative", overflow: "hidden" }}>
      <Fonts />

      {/* Lightbox */}
      <Lightbox pin={lightboxPin} onClose={() => setLightboxPin(null)} onDelete={deletePin} />
      <Lightbox pin={publicSamplePin} onClose={() => setPublicSamplePin(null)} />
      <ProfileLightbox profile={showProfilePreview ? profile : null} user={user} onClose={() => setShowProfilePreview(false)} />
      {showTutorial && <TutorialModal onClose={() => setShowTutorial(false)} />}

      {/* Edit Profile */}
      {showEditProfile && profile && <EditProfile profile={profile} onSave={(p) => { setProfile(p); setShowEditProfile(false); }} onClose={() => setShowEditProfile(false)} />}
      {showAdminPanel && isAdmin && <AdminPanel currentUser={user} onClose={() => setShowAdminPanel(false)} />}
      {showFriendsPanel && <FriendsPanel currentUser={user} onClose={() => setShowFriendsPanel(false)} />}

      {/* Header */}
      <header style={{ padding: isMobile ? "10px 16px" : "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative", zIndex: 10, borderBottom: `1px solid ${palette.line}`, background: "rgba(17,24,39,0.72)", backdropFilter: "blur(18px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BrandLockup align="left" titleSize={isMobile ? 20 : 26} compact />
          <span style={{ fontSize: 10, opacity: 0.35, letterSpacing: "0.5px", marginTop: 2 }}>v{APP_VERSION}</span>
        </div>

        <div style={{ display: "flex", gap: isMobile ? 10 : 20, alignItems: "center" }}>
          {pins.length > 0 && !isMobile && <>
            <div style={{ textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 800, color: palette.mint }}>{stats.countries}</div><div style={{ fontSize: 9, opacity: 0.5, letterSpacing: "1px" }}>COUNTRIES</div></div>
            <div style={{ textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 800, color: palette.gold }}>{stats.cities}</div><div style={{ fontSize: 9, opacity: 0.5, letterSpacing: "1px" }}>CITIES</div></div>
            <div style={{ textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 800, color: palette.sky }}>{pins.length}</div><div style={{ fontSize: 9, opacity: 0.5, letterSpacing: "1px" }}>PHOTOS</div></div>
            <button onClick={clearAll} style={secondaryBtnStyle}>Clear All</button>
          </>}
          {pins.length > 0 && isMobile && <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ textAlign: "center" }}><div style={{ fontSize: 16, fontWeight: 800, color: palette.mint }}>{stats.countries}</div><div style={{ fontSize: 8, opacity: 0.5, letterSpacing: "1px" }}>CNTRS</div></div>
            <div style={{ textAlign: "center" }}><div style={{ fontSize: 16, fontWeight: 800, color: palette.sky }}>{pins.length}</div><div style={{ fontSize: 8, opacity: 0.5, letterSpacing: "1px" }}>PHOTOS</div></div>
          </div>}

          {/* User avatar & dropdown */}
          <div style={{ position: "relative", paddingLeft: pins.length > 0 ? 12 : 0, borderLeft: pins.length > 0 ? "1px solid rgba(255,255,255,0.1)" : "none" }}>
            <div onClick={() => setShowUserMenu(!showUserMenu)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "5px 9px", borderRadius: 16, background: showUserMenu ? "rgba(255,255,255,0.09)" : "transparent", transition: "background 0.2s" }}>
              <div onClick={(e) => { e.stopPropagation(); setShowUserMenu(false); setShowProfilePreview(true); }} title="View profile picture" style={{
                width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                background: profile?.avatar_url ? `url(${profile.avatar_url}) center/cover` : `linear-gradient(135deg, ${palette.accent}, ${palette.sky})`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 15, fontWeight: 800, color: "white", border: "2px solid rgba(255,255,255,0.22)",
                boxShadow: "0 0 0 3px rgba(66,217,184,0.12)", cursor: "zoom-in",
              }}>
                {!profile?.avatar_url && (profile?.username?.charAt(0).toUpperCase() || "?")}
              </div>
              <div style={{ display: isMobile ? "none" : "block" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>@{profile?.username}</div>
                <div style={{ fontSize: 10, opacity: 0.4 }}>{user.email}</div>
              </div>
              <span style={{ fontSize: 10, opacity: 0.4, marginLeft: 4 }}>▼</span>
            </div>

            {showUserMenu && (
              <div style={{
                position: "absolute", top: "calc(100% + 8px)", right: 0, width: 200,
                background: "rgba(17,24,39,0.96)", border: `1px solid ${palette.line}`,
                borderRadius: 16, overflow: "hidden", boxShadow: "0 18px 46px rgba(0,0,0,0.38)",
                backdropFilter: "blur(12px)", zIndex: 100,
              }}>
                {isAdmin && (
                  <>
                    <button onClick={() => { setShowAdminPanel(true); setShowUserMenu(false); }} style={menuItemStyle}>
                      <span>★</span> Admin Dashboard
                    </button>
                    <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
                  </>
                )}
                <button onClick={() => { setShowEditProfile(true); setShowUserMenu(false); }} style={menuItemStyle}>
                  <span>✎</span> Edit Profile
                </button>
                <button onClick={() => { setShowFriendsPanel(true); setShowUserMenu(false); }} style={menuItemStyle}>
                  <span>+</span> Friends
                </button>
                <button onClick={() => { setShowTutorial(true); setShowUserMenu(false); }} style={menuItemStyle}>
                  <span>?</span> Tutorial
                </button>
                <div style={{ padding: "10px 16px", color: palette.muted, fontSize: 11 }}>Version {APP_VERSION}</div>
                <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
                <button onClick={() => { handleLogout(); setShowUserMenu(false); }} style={{ ...menuItemStyle, color: palette.accent }}>
                  <span>↩</span> Log Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Click away to close menu */}
      {showUserMenu && <div onClick={() => setShowUserMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 5 }} />}

      {/* Placement mode banner */}
      {pendingPhotos.length > 0 && (() => {
        const cur = pendingPhotos[0];
        const hasSuggestion = !!cur.suggestion;
        return (
          <div style={{ position: "fixed", top: isMobile ? 58 : 78, left: "50%", transform: "translateX(-50%)", zIndex: 200, background: "rgba(17,24,39,0.97)", border: `1px solid ${hasSuggestion ? palette.mint : palette.gold}`, borderRadius: 16, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", maxWidth: "calc(100vw - 24px)" }}>
            {cur.thumb && <img src={cur.thumb} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />}
            <div style={{ minWidth: 0, flex: 1 }}>
              {hasSuggestion ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: palette.mint }}>Is this location correct?</div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginTop: 1 }}>{cur.suggestion.place}</div>
                  <div style={{ fontSize: 10, opacity: 0.45, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cur.fileName} · choose sharing before saving</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: palette.gold }}>No GPS — tap map to place</div>
                  <div style={{ fontSize: 10, opacity: 0.45, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cur.fileName}{pendingPhotos.length > 1 ? ` (+${pendingPhotos.length - 1} more)` : ""} · choose sharing before saving</div>
                </>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <div style={{ display: "flex", alignItems: "center", padding: 3, borderRadius: 12, background: "rgba(255,255,255,0.08)", border: `1px solid ${palette.line}` }}>
                {[{ label: "Private", value: false }, { label: "Public", value: true }].map(option => (
                  <button key={option.label} onClick={() => updatePendingVisibility(option.value)} style={{
                    border: "none",
                    borderRadius: 9,
                    padding: "7px 9px",
                    background: Boolean(cur.isPublic) === option.value ? (option.value ? "rgba(66,217,184,0.24)" : "rgba(255,255,255,0.14)") : "transparent",
                    color: option.value && cur.isPublic ? palette.mint : palette.text,
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif",
                  }}>{option.label}</button>
                ))}
              </div>
              {hasSuggestion ? (
                <>
                  <button onClick={handleConfirmSuggestion} style={{ ...secondaryBtnStyle, padding: "8px 12px", fontSize: 12, border: `1px solid ${palette.mint}`, color: palette.mint }}>Save</button>
                  <button onClick={handleDismissSuggestion} style={{ ...secondaryBtnStyle, padding: "8px 10px", fontSize: 12 }}>Tap map</button>
                </>
              ) : (
                navigator.geolocation && <button onClick={handleUseMyLocation} style={{ ...secondaryBtnStyle, padding: "8px 10px", fontSize: 12, border: `1px solid ${palette.mint}`, color: palette.mint }}>📍 My location</button>
              )}
              <button onClick={handleSkipPendingPhoto} style={{ ...secondaryBtnStyle, padding: "8px 10px", fontSize: 12, opacity: 0.6 }}>Skip</button>
              <button onClick={() => setPendingPhotos([])} style={{ ...dangerBtnStyle, padding: "8px 10px", fontSize: 12 }}>✕</button>
            </div>
          </div>
        );
      })()}

      {/* Main content */}
      <div style={{ display: "flex", height: isMobile ? "calc(100dvh - 58px)" : "calc(100vh - 76px)", position: "relative", zIndex: 5 }}>
        {/* Mobile timeline drawer */}
        {isMobile && showTimeline && pins.length > 0 && (
          <div onClick={() => setShowTimeline(false)} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.5)" }}>
            <div onClick={e => e.stopPropagation()} style={{ position: "absolute", bottom: 0, left: 0, right: 0, maxHeight: "70vh", background: "rgba(17,24,39,0.98)", borderRadius: "20px 20px 0 0", border: `1px solid ${palette.line}`, display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "14px 20px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ margin: 0, fontSize: 13, letterSpacing: "1px", opacity: 0.5, fontWeight: 600 }}>TIMELINE</h2>
                <button onClick={() => setShowTimeline(false)} style={{ background: "none", border: "none", color: palette.text, fontSize: 20, cursor: "pointer", opacity: 0.5 }}>×</button>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
                {sortedPins.map((pin) => (
                  <div key={pin.id} onClick={() => { setSelectedPin(pin.id); setCenter({ lat: pin.lat, lon: pin.lon }); setZoom(12); setShowTimeline(false); }} style={{ display: "flex", gap: 12, padding: "10px 20px", cursor: "pointer", background: selectedPin === pin.id ? "rgba(230,57,70,0.1)" : "transparent", borderLeft: selectedPin === pin.id ? "3px solid #E63946" : "3px solid transparent" }}>
                    <div onClick={(e) => { e.stopPropagation(); setLightboxPin(pin); }} style={{ width: 48, height: 48, borderRadius: 10, overflow: "hidden", flexShrink: 0, border: "2px solid rgba(255,255,255,0.1)", cursor: "zoom-in" }}>
                      {pin.thumb && <img src={pin.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{pin.place}</div>
                      {pin.date && <div style={{ fontSize: 11, opacity: 0.4 }}>{pin.date}</div>}
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); deletePin(pin); }} style={{ ...dangerBtnStyle, width: 34, height: 34, padding: 0, flexShrink: 0, alignSelf: "center" }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        <div style={{ width: !isMobile && pins.length > 0 ? 320 : 0, minWidth: !isMobile && pins.length > 0 ? 320 : 0, overflow: "hidden", transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)", borderRight: !isMobile && pins.length > 0 ? "1px solid rgba(255,255,255,0.06)" : "none", display: "flex", flexDirection: "column" }}>
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
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{pin.place}</div>
                  {pin.date && <div style={{ fontSize: 11, opacity: 0.4 }}>{pin.date}</div>}
                  <div style={{ fontSize: 10, opacity: 0.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pin.fileName}</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deletePin(pin); }}
                  title="Delete photo"
                  style={{ ...dangerBtnStyle, width: 34, height: 34, padding: 0, flexShrink: 0, alignSelf: "center" }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, position: "relative" }} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); processFiles(e.dataTransfer.files); }}>
          <SlippyMap
            pins={pins}
            heatPoints={showHeatmap ? activeHeatPoints : []}
            center={center}
            zoom={zoom}
            onPinClick={(p) => setLightboxPin(p)}
            onHeatPointClick={(point) => setPublicSamplePin({ id: point.sampleId, lat: point.lat, lon: point.lon, place: point.place, thumb: point.thumb, fileName: point.fileName || (heatmapScope === "own" ? "Your upload" : "Public upload") })}
            onMapClick={pendingPhotos.length > 0 ? handleMapClick : undefined}
            placementMode={pendingPhotos.length > 0}
            currentLocation={currentLocation}
          />

          {loading && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 25, background: "rgba(10,10,15,0.8)" }}>
            <div style={{ textAlign: "center" }}><div style={{ width: 32, height: 32, border: "3px solid rgba(230,57,70,0.3)", borderTop: "3px solid #E63946", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} /><div style={{ fontSize: 16, opacity: 0.7 }}>Loading your travels...</div></div>
          </div>}

          {!loading && pins.length === 0 && !processing && !showHeatmap && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20, background: "rgba(10,10,15,0.7)", backdropFilter: "blur(4px)" }}>
              <div style={{ textAlign: "center", padding: 48, border: `2px dashed ${palette.line}`, borderRadius: 24, background: "rgba(255,255,255,0.055)", maxWidth: 420, boxShadow: "0 22px 70px rgba(0,0,0,0.22)" }}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}><LogoMark size={64} /></div>
                <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 800, margin: "0 0 8px" }}>{isMobile ? "Tap + to add photos" : "Drop your photos here"}</h2>
                <p style={{ fontSize: 14, opacity: 0.5, margin: "0 0 24px", lineHeight: 1.6 }}>{isMobile ? "Upload photos with GPS and watch your travels appear on the map" : <>Upload photos with GPS data and watch<br />your travels appear on the map</>}</p>
                <button onClick={() => fileInputRef.current?.click()} style={{ ...authBtnStyle, width: "auto", padding: "14px 36px", transition: "transform 0.2s ease" }}
                  onMouseEnter={e => e.target.style.transform = "scale(1.05)"} onMouseLeave={e => e.target.style.transform = "scale(1)"}>Choose Photos</button>
              </div>
            </div>
          )}

          <div style={{ position: "absolute", top: 16, left: 16, zIndex: 30, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {!isMobile && <button onClick={() => fileInputRef.current?.click()} style={{ background: `linear-gradient(135deg, ${palette.accent}, ${palette.accentDark})`, color: "white", border: "none", padding: "10px 18px", borderRadius: 14, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", boxShadow: "0 12px 28px rgba(255,107,74,0.25)", display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 18 }}>+</span> Add Photos</button>}
            <div style={{ display: "flex", alignItems: "center", gap: 4, padding: 3, borderRadius: 14, background: "rgba(17,24,39,0.78)", border: `1px solid ${showHeatmap ? palette.mint : palette.line}`, boxShadow: "0 12px 28px rgba(0,0,0,0.18)" }}>
              {[
                { value: "global", label: isMobile ? "Global" : "Global Popular Places" },
                { value: "own", label: isMobile ? "Mine" : "My Popular Places" },
              ].map(option => (
                <button key={option.value} onClick={() => chooseHeatmapScope(option.value)} style={{
                  border: "none",
                  borderRadius: 11,
                  padding: isMobile ? "8px 10px" : "8px 12px",
                  background: showHeatmap && heatmapScope === option.value ? "rgba(66,217,184,0.22)" : "transparent",
                  color: showHeatmap && heatmapScope === option.value ? palette.mint : palette.text,
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                }}>{option.label}</button>
              ))}
              {showHeatmap && <button onClick={togglePopularPlaces} title="Hide heatmap" style={{ ...dangerBtnStyle, width: 28, height: 28, padding: 0, borderRadius: 9 }}>x</button>}
            </div>
            {isMobile && pins.length > 0 && <button onClick={() => setShowTimeline(t => !t)} style={{ ...secondaryBtnStyle, padding: "10px 14px", background: "rgba(17,24,39,0.78)", boxShadow: "0 12px 28px rgba(0,0,0,0.18)" }}>☰</button>}
          </div>

          {showHeatmap && <div style={{ position: "absolute", left: 16, bottom: 16, zIndex: 30, background: "rgba(17,24,39,0.82)", border: `1px solid ${palette.line}`, borderRadius: 12, padding: "9px 12px", color: palette.text, fontSize: 12, boxShadow: "0 12px 30px rgba(0,0,0,0.2)", lineHeight: 1.45 }}>
            <div>Showing {activeHeatPoints.length} {activeHeatLabel}</div>
            {heatmapScope === "global" && (
              <div style={{ color: palette.mint, fontWeight: 800 }}>
                Global photo uploads {formatCompactCount(globalUploadDisplayCount)}+
              </div>
            )}
          </div>}

          {dragOver && <div style={{ position: "absolute", inset: 0, zIndex: 40, background: "rgba(230,57,70,0.15)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", border: "3px dashed #E63946", borderRadius: 16, margin: 8 }}><div style={{ fontSize: 22, fontWeight: 700, color: "#E63946" }}>Drop photos here</div></div>}

          {processing && <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 50, background: "rgba(15,15,15,0.92)", color: "#e8e6e1", padding: "12px 24px", borderRadius: 12, fontSize: 14, boxShadow: "0 4px 20px rgba(0,0,0,0.4)", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 16, height: 16, border: "2px solid rgba(230,57,70,0.3)", borderTop: "2px solid #E63946", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />Reading GPS data...</div>}

          <input ref={fileInputRef} type="file" multiple accept="image/*,.heic,.heif" style={{ display: "none" }} onChange={(e) => processFiles(e.target.files)} />
          {/* Mobile FAB */}
          {isMobile && (
            <button onClick={() => fileInputRef.current?.click()} style={{ position: "absolute", bottom: 24, right: 16, zIndex: 30, width: 56, height: 56, borderRadius: "50%", background: `linear-gradient(135deg, ${palette.accent}, ${palette.accentDark})`, color: "white", border: "none", fontSize: 26, fontWeight: 700, cursor: "pointer", boxShadow: "0 8px 24px rgba(255,107,74,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
          )}
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
