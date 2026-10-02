// Utilidades de interfaz compartidas.
import { ls } from "./store.js";

export const $ = (id) => document.getElementById(id);
export const show = (el, on = true) => el.classList.toggle("hidden", !on);

export const fmtCost = (usd) => (usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(usd < 1 ? 3 : 2)}`);
export const fmtTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
export const fmtBytes = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function fmtDate(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  const time = d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Hoy ${time}`;
  if (d.toDateString() === yest.toDateString()) return `Ayer ${time}`;
  return d.toLocaleDateString("es", { day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

export function usageLine(model, u, cost, label) {
  if (!u) return "";
  const parts = [label, `${fmtTokens((u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0))} entrada`, `${fmtTokens(u.output_tokens || 0)} salida`];
  if (u.cache_read_input_tokens) parts.push(`${fmtTokens(u.cache_read_input_tokens)} desde caché`);
  parts.push(`≈ ${fmtCost(cost)}`);
  return parts.filter(Boolean).join(" · ");
}

// Re-render limitado a un frame para no saturar el DOM durante el streaming.
export function rafRenderer(fn) {
  let frame = 0, last;
  const render = (value) => {
    last = value;
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; fn(last); });
  };
  // Descarta el frame pendiente (para que no pise el render final).
  render.cancel = () => { cancelAnimationFrame(frame); frame = 0; };
  return render;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------------------------------------------------------------------------
//  Toasts
// ---------------------------------------------------------------------------
export function toast(message, { action, timeout = 4500, kind = "info" } = {}) {
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.setAttribute("role", "status");
  const text = document.createElement("span");
  text.textContent = message;
  el.appendChild(text);
  if (action) {
    const b = document.createElement("button");
    b.className = "btn btn-sm btn-outline";
    b.textContent = action.label;
    b.addEventListener("click", () => { action.onClick(); el.remove(); });
    el.appendChild(b);
  }
  const close = document.createElement("button");
  close.className = "toast-close";
  close.setAttribute("aria-label", "Cerrar");
  close.textContent = "×";
  close.addEventListener("click", () => el.remove());
  el.appendChild(close);
  $("toasts").appendChild(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
  return el;
}

// ---------------------------------------------------------------------------
//  Modales
// ---------------------------------------------------------------------------
export function openModal(id) {
  show($(id));
  document.body.classList.add("modal-open");
  setTimeout(() => $(id).querySelector("input, select, button")?.focus(), 0);
}
export function closeModal(id) {
  show($(id), false);
  if (!document.querySelector(".modal:not(.hidden)")) document.body.classList.remove("modal-open");
}

// ---------------------------------------------------------------------------
//  Pestañas
// ---------------------------------------------------------------------------
const tabListeners = {};
export const onTabShow = (name, fn) => { (tabListeners[name] ||= []).push(fn); };

export function setTab(name) {
  if (!document.getElementById(`tab-${name}`)) name = "esquema";
  document.querySelectorAll(".tab-btn").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  document.querySelectorAll(".tab-panel").forEach((p) => show(p, p.id === `tab-${name}`));
  ls.set("tab", name);
  (tabListeners[name] || []).forEach((fn) => fn());
}

// Descarga un texto como archivo.
export function downloadText(filename, text, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const slug = (s) =>
  (s || "esquema").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "esquema";
