// Voz con las APIs del navegador (gratis): lectura en voz alta y dictado. Todo es manual: nada se activa solo
// salvo que el usuario encienda "leer respuestas automáticamente" en Ajustes.
import { settings } from "./store.js";
import { $, show, toast } from "./ui.js";
import { speechText } from "./markdown.js";

// ---------------------------------------------------------------------------
//  Lectura en voz alta (speechSynthesis)
// ---------------------------------------------------------------------------
const synth = window.speechSynthesis;
export const ttsSupported = !!synth && typeof SpeechSynthesisUtterance !== "undefined";

let queue = [];
let current = null;     // { onStop }
let paused = false;

function pickVoice(lang) {
  const voices = synth.getVoices();
  const base = lang.slice(0, 2);
  return voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase())
    || voices.find((v) => v.lang.toLowerCase().startsWith(base))
    || null;
}

// Chrome corta los textos largos: se divide en fragmentos de ~200 caracteres por frase.
function chunk(text) {
  const parts = text.split(/(?<=[.!?;:])\s+/);
  const out = [];
  let buf = "";
  for (const p of parts) {
    if ((buf + " " + p).length > 200 && buf) { out.push(buf); buf = p; } else buf = buf ? `${buf} ${p}` : p;
  }
  if (buf) out.push(buf);
  return out;
}

function updateBar() {
  const speaking = !!current;
  show($("ttsBar"), speaking);
  $("ttsPause").textContent = paused ? "▶" : "❚❚";
  $("ttsPause").setAttribute("aria-label", paused ? "Continuar" : "Pausar");
  $("ttsLabel").textContent = paused ? "En pausa" : "Leyendo…";
}

function next() {
  if (!queue.length) return stopSpeaking();
  const { voiceLang: lang, voiceRate } = settings.get();
  const u = new SpeechSynthesisUtterance(queue.shift());
  u.lang = lang;
  u.rate = voiceRate;
  const voice = pickVoice(lang);
  if (voice) u.voice = voice;
  u.onend = () => { if (current) next(); };
  u.onerror = (e) => { if (e.error !== "interrupted" && e.error !== "canceled") stopSpeaking(); };
  synth.speak(u);
}

export function speak(text, { onStop } = {}) {
  if (!ttsSupported) { toast("Tu navegador no permite lectura en voz alta."); return; }
  stopSpeaking();
  queue = chunk(text);
  if (!queue.length) return;
  current = { onStop };
  paused = false;
  updateBar();
  next();
}

export const speakElement = (el, opts) => speak(speechText(el), opts);

export function stopSpeaking() {
  const prev = current;
  current = null;
  queue = [];
  paused = false;
  if (ttsSupported) synth.cancel();
  updateBar();
  prev?.onStop?.();
}

export const isSpeaking = () => !!current;

/** Botón que alterna escuchar/detener para el elemento dado. */
export function bindSpeakButton(button, getElement) {
  if (!ttsSupported) { show(button, false); return; }
  const idle = button.innerHTML;
  button.addEventListener("click", () => {
    if (button.dataset.speaking === "1") { stopSpeaking(); return; }
    const el = getElement();
    if (!el) return;
    speakElement(el, { onStop: () => { button.dataset.speaking = "0"; button.innerHTML = idle; } });
    button.dataset.speaking = "1";
    button.innerHTML = "⏹ Detener";
  });
}

export function initTtsBar() {
  if (!ttsSupported) return;
  synth.getVoices(); // precarga la lista de voces
  $("ttsPause").addEventListener("click", () => {
    if (!current) return;
    if (paused) { synth.resume(); paused = false; } else { synth.pause(); paused = true; }
    updateBar();
  });
  $("ttsStop").addEventListener("click", stopSpeaking);
  window.addEventListener("pagehide", stopSpeaking);
}

// ---------------------------------------------------------------------------
//  Dictado (SpeechRecognition). Pulsas el micrófono para empezar y otra vez para terminar;
//  el texto queda en el campo para revisarlo antes de enviar.
// ---------------------------------------------------------------------------
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const dictationSupported = !!Recognition;

let active = null; // { rec, textarea, button, base, finalText, stopping }

export function stopDictation() {
  if (!active) return;
  active.stopping = true;
  try { active.rec.stop(); } catch {}
}

export function bindDictation(button, textarea) {
  if (!dictationSupported) { show(button, false); return; }
  button.addEventListener("click", () => {
    if (active?.button === button) { stopDictation(); return; }
    stopDictation();
    start(button, textarea);
  });
}

function start(button, textarea) {
  const rec = new Recognition();
  rec.lang = settings.get().voiceLang;
  rec.continuous = true;
  rec.interimResults = true;

  const base = textarea.value && !/\s$/.test(textarea.value) ? textarea.value + " " : textarea.value;
  const state = { rec, textarea, button, base, finalText: "", stopping: false };
  active = state;

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) state.finalText += r[0].transcript.trim() + " ";
      else interim += r[0].transcript;
    }
    textarea.value = state.base + state.finalText + interim;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      toast("Permiso de micrófono denegado. Actívalo en la configuración del navegador.", { kind: "error" });
      state.stopping = true;
    } else if (e.error === "network") {
      toast("El dictado necesita conexión a internet.", { kind: "error" });
      state.stopping = true;
    }
  };
  // Chrome corta tras unos segundos de silencio: si no lo detuvo el usuario, se reanuda.
  rec.onend = () => {
    if (!state.stopping && active === state) {
      state.base = textarea.value && !/\s$/.test(textarea.value) ? textarea.value + " " : textarea.value;
      state.finalText = "";
      try { rec.start(); return; } catch {}
    }
    if (active === state) active = null;
    button.classList.remove("recording");
    button.setAttribute("aria-pressed", "false");
    textarea.value = textarea.value.trimEnd();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
  };

  try {
    rec.start();
    button.classList.add("recording");
    button.setAttribute("aria-pressed", "true");
  } catch {
    active = null;
    toast("No se pudo iniciar el dictado.", { kind: "error" });
  }
}
