// Persistencia local: API key, ajustes, estadísticas, uso/costo (localStorage) e historial (IndexedDB).
import { DEFAULT_SETTINGS, MODELS, CACHE_WRITE_MULT, CACHE_READ_MULT } from "./config.js";

const PREFIX = "socratdah_";

export const ls = {
  get(k, fallback = null) {
    try { const v = localStorage.getItem(PREFIX + k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(k, v) { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(PREFIX + k); } catch {} },
};

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------------------------------------------------------------------
//  API key: localStorage si "recordar", sessionStorage si no (se borra al cerrar la pestaña).
//  El nombre de la clave es el mismo de la versión anterior para no pedirla de nuevo.
// ---------------------------------------------------------------------------
const KEY_NAME = "socratdah_anthropic_api_key";

export const apiKey = {
  get() {
    try { return localStorage.getItem(KEY_NAME) || sessionStorage.getItem(KEY_NAME) || ""; } catch { return ""; }
  },
  remembered() {
    try { return !!localStorage.getItem(KEY_NAME); } catch { return false; }
  },
  set(value, remember) {
    this.clear();
    try { (remember ? localStorage : sessionStorage).setItem(KEY_NAME, value); } catch {}
  },
  clear() {
    try { localStorage.removeItem(KEY_NAME); sessionStorage.removeItem(KEY_NAME); } catch {}
  },
  validate(value) {
    if (!value) return "Ingresa una clave.";
    if (value.startsWith("sk-ant-admin")) return "Eso es una Admin key: da control sobre toda la organización. Usa una API key normal (sk-ant-api…).";
    if (!value.startsWith("sk-ant-")) return "No parece una API key de Anthropic (debe empezar con sk-ant-).";
    if (/\s/.test(value)) return "La clave contiene espacios; revisa que se haya copiado completa.";
    return "";
  },
};

// ---------------------------------------------------------------------------
//  Ajustes
// ---------------------------------------------------------------------------
export const settings = {
  get() {
    const s = { ...DEFAULT_SETTINGS, ...ls.get("settings", {}) };
    if (!MODELS[s.modelEsquema]) s.modelEsquema = DEFAULT_SETTINGS.modelEsquema;
    if (!MODELS[s.modelTutor]) s.modelTutor = DEFAULT_SETTINGS.modelTutor;
    return s;
  },
  set(patch) {
    const next = { ...this.get(), ...patch };
    ls.set("settings", next);
    window.dispatchEvent(new CustomEvent("settings-changed", { detail: next }));
    return next;
  },
};

// ---------------------------------------------------------------------------
//  Estadísticas diarias y racha
// ---------------------------------------------------------------------------
export const stats = {
  all() { return ls.get("stats", {}); },
  today() { return { esquemas: 0, casos: 0, respuestas: 0, pomodoros: 0, ...(this.all()[dateKey()] || {}) }; },
  bump(field, n = 1) {
    const all = this.all();
    const k = dateKey();
    all[k] = { ...(all[k] || {}), [field]: ((all[k] || {})[field] || 0) + n };
    ls.set("stats", all);
    window.dispatchEvent(new Event("stats-changed"));
  },
  streak() {
    const all = this.all();
    const active = (k) => Object.values(all[k] || {}).some((v) => v > 0);
    const d = new Date();
    if (!active(dateKey(d))) d.setDate(d.getDate() - 1); // hoy aún no cuenta: la racha sigue viva
    let n = 0;
    while (active(dateKey(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  },
};

// ---------------------------------------------------------------------------
//  Uso de tokens y costo
// ---------------------------------------------------------------------------
export function costOf(model, u) {
  const m = MODELS[model];
  if (!m || !u) return 0;
  const inp = (u.input_tokens || 0) * m.input
    + (u.cache_creation_input_tokens || 0) * m.input * CACHE_WRITE_MULT
    + (u.cache_read_input_tokens || 0) * m.input * CACHE_READ_MULT;
  return (inp + (u.output_tokens || 0) * m.output) / 1e6;
}

const emptyUsage = () => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, requests: 0 });

export const usage = {
  all() { return ls.get("usage", { days: {}, total: emptyUsage() }); },
  today() { return { ...emptyUsage(), ...(this.all().days[dateKey()] || {}) }; },
  total() { return { ...emptyUsage(), ...this.all().total }; },
  add(model, u) {
    const cost = costOf(model, u);
    const data = this.all();
    const k = dateKey();
    data.days[k] = { ...emptyUsage(), ...(data.days[k] || {}) };
    data.total = { ...emptyUsage(), ...data.total };
    for (const bucket of [data.days[k], data.total]) {
      bucket.input += u.input_tokens || 0;
      bucket.output += u.output_tokens || 0;
      bucket.cacheWrite += u.cache_creation_input_tokens || 0;
      bucket.cacheRead += u.cache_read_input_tokens || 0;
      bucket.cost += cost;
      bucket.requests += 1;
    }
    // Conserva solo 60 días de detalle diario
    const keys = Object.keys(data.days).sort();
    while (keys.length > 60) delete data.days[keys.shift()];
    ls.set("usage", data);
    window.dispatchEvent(new Event("usage-changed"));
    return cost;
  },
};

// ---------------------------------------------------------------------------
//  IndexedDB: esquemas, casos, lagunas y borradores (adjuntos)
// ---------------------------------------------------------------------------
const DB_NAME = "socratdah";
const STORES = ["esquemas", "casos", "lagunas", "drafts"];
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  put: (store, obj) => tx(store, "readwrite", (s) => s.put(obj)),
  get: (store, id) => tx(store, "readonly", (s) => s.get(id)),
  all: (store) => tx(store, "readonly", (s) => s.getAll()),
  del: (store, id) => tx(store, "readwrite", (s) => s.delete(id)),
  clear: (store) => tx(store, "readwrite", (s) => s.clear()),
};
