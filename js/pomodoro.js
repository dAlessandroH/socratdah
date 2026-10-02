// Temporizador Pomodoro + contador diario y racha. El estado sobrevive a recargas.
import { ls, settings, stats } from "./store.js";
import { $, show, toast } from "./ui.js";

const BASE_TITLE = document.title;
let state = ls.get("pomodoro", { mode: "idle", next: "focus", running: false, endsAt: 0, remaining: 0 });
let audioCtx = null;
let ticker = null;

const minutesFor = (mode) => (mode === "break" ? settings.get().breakMin : settings.get().focusMin);
const save = () => ls.set("pomodoro", state);

function remainingMs() {
  if (state.running) return Math.max(0, state.endsAt - Date.now());
  if (state.mode === "idle") return minutesFor(state.next) * 60000;
  return state.remaining;
}

const mmss = (ms) => {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function beep() {
  try {
    audioCtx ||= new AudioContext();
    const t = audioCtx.currentTime;
    [0, 0.25, 0.5].forEach((d, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = i === 2 ? 880 : 660;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.2);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + d);
      o.stop(t + d + 0.22);
    });
  } catch {}
}

function start(mode = state.mode === "idle" ? state.next : state.mode) {
  try { audioCtx ||= new AudioContext(); audioCtx.resume(); } catch {}
  const ms = state.mode === mode && state.remaining > 0 ? state.remaining : minutesFor(mode) * 60000;
  state = { ...state, mode, running: true, endsAt: Date.now() + ms, remaining: 0 };
  save();
  tick();
}

function pause() {
  state = { ...state, running: false, remaining: Math.max(0, state.endsAt - Date.now()) };
  save();
  render();
}

function reset() {
  state = { mode: "idle", next: "focus", running: false, endsAt: 0, remaining: 0 };
  save();
  render();
}

function finish() {
  const was = state.mode;
  state = { mode: "idle", next: was === "focus" ? "break" : "focus", running: false, endsAt: 0, remaining: 0 };
  save();
  beep();
  if (was === "focus") {
    stats.bump("pomodoros");
    toast(`¡Bloque completado! Pausa sugerida: ${settings.get().breakMin} min. Levántate y estírate.`, {
      timeout: 0, kind: "success", action: { label: "Empezar pausa", onClick: () => start("break") },
    });
  } else {
    toast("Pausa terminada. ¿Otro bloque?", { timeout: 0, action: { label: "Empezar bloque", onClick: () => start("focus") } });
  }
  render();
}

function tick() {
  clearInterval(ticker);
  render();
  if (!state.running) return;
  ticker = setInterval(() => {
    if (remainingMs() <= 0) { clearInterval(ticker); finish(); } else render();
  }, 1000);
}

function render() {
  const ms = remainingMs();
  const s = stats.today();
  const streak = stats.streak();

  // Botón de la cabecera
  const label = $("pomoLabel");
  if (state.running || state.mode !== "idle") {
    label.textContent = `${state.running ? "" : "❚❚ "}${mmss(ms)}`;
    $("pomoBtn").classList.toggle("is-break", state.mode === "break");
    $("pomoBtn").classList.toggle("is-running", state.running);
  } else {
    label.textContent = streak ? `🔥 ${streak}` : "";
    $("pomoBtn").classList.remove("is-break", "is-running");
  }
  document.title = state.running ? `${mmss(ms)} ${state.mode === "break" ? "Pausa" : "Enfoque"} · ${BASE_TITLE}` : BASE_TITLE;

  // Panel
  $("pomoTime").textContent = mmss(ms);
  $("pomoMode").textContent =
    state.mode === "focus" ? "Bloque de enfoque" : state.mode === "break" ? "Pausa" : state.next === "break" ? "Listo para la pausa" : "Listo para empezar";
  $("pomoStart").textContent = state.running ? "Pausar" : state.mode === "idle" ? (state.next === "break" ? "Empezar pausa" : "Empezar") : "Continuar";
  document.querySelectorAll("#pomoFocusOpts button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.min) === settings.get().focusMin)));
  document.querySelectorAll("#pomoBreakOpts button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.min) === settings.get().breakMin)));
  $("pomoStats").innerHTML = "";
  [["Esquemas", s.esquemas], ["Casos", s.casos], ["Respuestas", s.respuestas], ["Bloques", s.pomodoros]].forEach(([k, v]) => {
    const div = document.createElement("div");
    div.className = "stat";
    div.innerHTML = `<strong></strong><span></span>`;
    div.querySelector("strong").textContent = v;
    div.querySelector("span").textContent = k;
    $("pomoStats").appendChild(div);
  });
  $("pomoStreak").textContent = streak
    ? `🔥 Racha: ${streak === 1 ? "1 día" : `${streak} días seguidos`} estudiando`
    : "Estudia hoy para empezar una racha 🔥";
}

export function initPomodoro() {
  const pop = $("pomoPop");
  $("pomoBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    show(pop, pop.classList.contains("hidden"));
    $("pomoBtn").setAttribute("aria-expanded", String(!pop.classList.contains("hidden")));
  });
  document.addEventListener("click", (e) => {
    if (!pop.contains(e.target) && !pop.classList.contains("hidden")) { show(pop, false); $("pomoBtn").setAttribute("aria-expanded", "false"); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") show(pop, false); });

  $("pomoStart").addEventListener("click", () => (state.running ? pause() : start()));
  $("pomoReset").addEventListener("click", reset);
  $("pomoFocusOpts").addEventListener("click", (e) => {
    const min = Number(e.target.dataset?.min);
    if (!min) return;
    settings.set({ focusMin: min }); // aplica al próximo bloque
    render();
  });
  $("pomoBreakOpts").addEventListener("click", (e) => {
    const min = Number(e.target.dataset?.min);
    if (!min) return;
    settings.set({ breakMin: min });
    render();
  });
  window.addEventListener("stats-changed", render);

  // Si el bloque terminó mientras la página estaba cerrada
  if (state.running && state.endsAt <= Date.now()) finish();
  else tick();
}
