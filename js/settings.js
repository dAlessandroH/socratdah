// API key, ajustes, uso/costo, instalación como app y manejo común de errores.
import { MODELS } from "./config.js";
import { apiKey, settings, usage, db, ls } from "./store.js";
import { $, show, toast, openModal, closeModal, fmtCost, fmtTokens } from "./ui.js";
import { ttsSupported, dictationSupported } from "./voice.js";

// ---------------------------------------------------------------------------
//  API key
// ---------------------------------------------------------------------------
export function openKeyModal(message) {
  const has = !!apiKey.get();
  $("keyInput").value = "";
  $("keyInput").placeholder = has ? "Pega una clave nueva para reemplazarla" : "sk-ant-api03-…";
  $("keyRemember").checked = has ? apiKey.remembered() : true;
  $("keyError").textContent = message || "";
  show($("keyError"), !!message);
  show($("keyCancel"), has);
  openModal("keyModal");
}

function masked() {
  const k = apiKey.get();
  return k ? `${k.slice(0, 10)}…${k.slice(-4)}` : "Sin clave";
}

// ---------------------------------------------------------------------------
//  Errores de la API (compartido por los módulos)
// ---------------------------------------------------------------------------
export function handleApiError(box, err) {
  if (err?.name === "AbortError") return;
  box.textContent = err?.message || "Error inesperado.";
  show(box);
  if (err?.kind === "auth") openKeyModal(apiKey.get() ? "La clave guardada fue rechazada. Ingresa una nueva." : "");
  if (err?.kind === "budget") toast("Límite diario alcanzado.", { kind: "error", action: { label: "Ajustes", onClick: openSettings } });
}

// ---------------------------------------------------------------------------
//  Uso
// ---------------------------------------------------------------------------
function renderUsageChip() {
  const today = usage.today();
  const { dailyLimit } = settings.get();
  const chip = $("usageChip");
  chip.textContent = `${fmtCost(today.cost)} hoy`;
  chip.title = dailyLimit > 0 ? `Gasto de hoy: ${fmtCost(today.cost)} de $${dailyLimit}` : `Gasto de hoy: ${fmtCost(today.cost)}`;
  chip.classList.toggle("warn", dailyLimit > 0 && today.cost >= dailyLimit * 0.8);
}

function usageRows(u) {
  return [
    ["Peticiones", u.requests],
    ["Tokens de entrada", fmtTokens(u.input)],
    ["Escritos en caché", fmtTokens(u.cacheWrite)],
    ["Leídos de caché (0.1×)", fmtTokens(u.cacheRead)],
    ["Tokens de salida", fmtTokens(u.output)],
    ["Costo estimado", fmtCost(u.cost)],
  ];
}

function renderUsageTable() {
  const tbody = $("usageTable");
  tbody.innerHTML = "";
  const t = usageRows(usage.today()), all = usageRows(usage.total());
  t.forEach(([label, v], i) => {
    const tr = document.createElement("tr");
    [label, v, all[i][1]].forEach((x, j) => { const td = document.createElement(j ? "td" : "th"); td.textContent = x; tr.appendChild(td); });
    tbody.appendChild(tr);
  });
}

// ---------------------------------------------------------------------------
//  Ajustes
// ---------------------------------------------------------------------------
function fillModelSelect(select, value) {
  select.innerHTML = "";
  for (const [id, m] of Object.entries(MODELS)) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = `${m.label} — ${m.hint} ($${m.input}/$${m.output} por M tokens)`;
    select.appendChild(o);
  }
  select.value = value;
}

export function openSettings() {
  const s = settings.get();
  $("keyMasked").textContent = masked();
  $("keyStorageNote").textContent = !apiKey.get() ? "" : apiKey.remembered() ? "Guardada en este dispositivo." : "Solo para esta sesión (se borra al cerrar la pestaña).";
  fillModelSelect($("setModelEsquema"), s.modelEsquema);
  fillModelSelect($("setModelTutor"), s.modelTutor);
  $("setDailyLimit").value = s.dailyLimit;
  $("setVoiceLang").value = [...$("setVoiceLang").options].some((o) => o.value === s.voiceLang) ? s.voiceLang : "es-MX";
  $("setVoiceRate").value = s.voiceRate;
  $("voiceRateVal").textContent = `${Number(s.voiceRate).toFixed(1)}×`;
  $("setAutoRead").checked = s.autoRead;
  renderUsageTable();
  openModal("settingsModal");
}

let installEvent = null;

export function initSettings() {
  // Modal de clave
  $("keyForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("keyInput").value.trim();
    const err = apiKey.validate(v);
    if (err) { $("keyError").textContent = err; show($("keyError")); return; }
    apiKey.set(v, $("keyRemember").checked);
    closeModal("keyModal");
    $("keyMasked").textContent = masked();
    toast("Clave guardada.", { kind: "success" });
  });
  $("keyCancel").addEventListener("click", () => closeModal("keyModal"));

  // Modal de ajustes
  $("openSettingsBtn").addEventListener("click", openSettings);
  $("usageChip").addEventListener("click", openSettings);
  $("settingsClose").addEventListener("click", () => closeModal("settingsModal"));
  $("keyChange").addEventListener("click", () => { closeModal("settingsModal"); openKeyModal(); });
  $("keyDelete").addEventListener("click", () => {
    if (!confirm("¿Borrar la API key de este navegador?")) return;
    apiKey.clear();
    closeModal("settingsModal");
    openKeyModal();
  });

  $("setModelEsquema").addEventListener("change", (e) => settings.set({ modelEsquema: e.target.value }));
  $("setModelTutor").addEventListener("change", (e) => {
    settings.set({ modelTutor: e.target.value });
    toast("El nuevo modelo se usará a partir del próximo caso.");
  });
  $("setDailyLimit").addEventListener("change", (e) => {
    const v = Math.max(0, Number(e.target.value) || 0);
    e.target.value = v;
    settings.set({ dailyLimit: v });
  });
  $("setVoiceLang").addEventListener("change", (e) => settings.set({ voiceLang: e.target.value }));
  $("setVoiceRate").addEventListener("input", (e) => {
    $("voiceRateVal").textContent = `${Number(e.target.value).toFixed(1)}×`;
    settings.set({ voiceRate: Number(e.target.value) });
  });
  $("setAutoRead").addEventListener("change", (e) => settings.set({ autoRead: e.target.checked }));
  show($("voiceUnsupported"), !ttsSupported || !dictationSupported);
  $("voiceUnsupported").textContent = !ttsSupported && !dictationSupported
    ? "Este navegador no tiene funciones de voz."
    : !dictationSupported ? "Este navegador no permite dictado (prueba Chrome, Edge o Safari)." : "Este navegador no permite lectura en voz alta.";

  $("wipeHistory").addEventListener("click", async () => {
    if (!confirm("¿Borrar TODO el historial (esquemas, casos y lagunas) de este navegador? No se puede deshacer.")) return;
    await Promise.all(["esquemas", "casos", "lagunas", "drafts"].map((s) => db.clear(s).catch(() => {})));
    ["current_esquema", "current_caso", "draft_source", "draft_chat"].forEach((k) => ls.del(k));
    location.reload();
  });

  // Instalación como app (PWA)
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e;
    show($("installBtn"));
  });
  $("installBtn").addEventListener("click", async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice.catch(() => {});
    installEvent = null;
    show($("installBtn"), false);
  });
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  show($("installHintIos"), /iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone);
  show($("installDone"), !!standalone);

  window.addEventListener("usage-changed", () => { renderUsageChip(); if (!$("settingsModal").classList.contains("hidden")) renderUsageTable(); });
  window.addEventListener("settings-changed", renderUsageChip);
  renderUsageChip();

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("settingsModal").classList.contains("hidden")) closeModal("settingsModal");
    else if (!$("keyModal").classList.contains("hidden") && apiKey.get()) closeModal("keyModal");
  });
}
