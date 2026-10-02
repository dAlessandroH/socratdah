// Módulo 2: Tutor socrático con puntaje por respuesta, cierre de caso y lagunas guardadas.
import { MODELS, SYSTEM_TUTOR, CLOSE_CASE_PROMPT, CLOSE_CASE_FORMAT } from "./config.js";
import { callClaude } from "./api.js";
import { db, ls, settings, stats, uid } from "./store.js";
import { $, show, toast, rafRenderer, debounce, usageLine, fmtCost } from "./ui.js";
import { renderMd } from "./markdown.js";
import { bindDictation, speakElement, stopSpeaking, ttsSupported, stopDictation } from "./voice.js";

const EVAL_RE = /\[\[EVAL:(correcta|parcial|incorrecta)\]\]\s*/i;
const EVAL_LABEL = { correcta: "✓ Correcta", parcial: "◐ Parcial", incorrecta: "✗ Incorrecta" };

let current = null;   // { id, title, model, messages: [{role, content, display?, eval?, cost?}], scores, closed, summary, cost, ... }
let ctrl = null;
let onError = () => {};

const chatLog = () => $("chatLog");
const apiMessages = (c) => c.messages.map(({ role, content }) => ({ role, content }));

// Oculta la etiqueta de evaluación (también mientras llega a medias durante el streaming).
function visibleText(raw) {
  let t = raw.replace(EVAL_RE, "");
  if (/^\s*\[\[?[A-Z:a-z]*$/.test(t)) t = "";
  return t;
}

// ---------------------------------------------------------------------------
//  Render
// ---------------------------------------------------------------------------
function scrollChat() { chatLog().scrollTop = chatLog().scrollHeight; }

function addBubble(role) {
  show($("chatEmpty"), false);
  const wrap = document.createElement("div");
  wrap.className = `msg msg-${role}`;
  const bubble = document.createElement("div");
  bubble.className = role === "user" ? "bubble bubble-user" : "bubble bubble-ai";
  const badge = document.createElement("div");
  badge.className = "eval-badge hidden";
  const body = document.createElement("div");
  body.className = role === "user" ? "bubble-text" : "md";
  bubble.append(badge, body);
  wrap.appendChild(bubble);

  let footer = null;
  if (role === "assistant") {
    footer = document.createElement("div");
    footer.className = "msg-footer";
    wrap.appendChild(footer);
  }
  chatLog().appendChild(wrap);
  scrollChat();
  return { wrap, badge, body, footer };
}

function setBadge(badge, ev) {
  if (!ev) return;
  badge.textContent = EVAL_LABEL[ev];
  badge.className = `eval-badge eval-${ev}`;
}

function fillFooter(footer, body, msg) {
  footer.innerHTML = "";
  if (ttsSupported) {
    const b = document.createElement("button");
    b.className = "btn-link";
    b.textContent = "🔊 Escuchar";
    b.addEventListener("click", () => {
      if (b.dataset.on === "1") { stopSpeaking(); return; }
      speakElement(body, { onStop: () => { b.dataset.on = "0"; b.textContent = "🔊 Escuchar"; } });
      b.dataset.on = "1";
      b.textContent = "⏹ Detener";
    });
    footer.appendChild(b);
  }
  if (msg?.cost) {
    const c = document.createElement("span");
    c.className = "muted";
    c.textContent = `≈ ${fmtCost(msg.cost)}`;
    if (msg.usage) c.title = usageLine(current?.model, msg.usage, msg.cost, MODELS[current?.model]?.label);
    footer.appendChild(c);
  }
}

function renderScore() {
  const has = !!current;
  show($("caseBar"), has);
  if (!has) return;
  const s = current.scores;
  const total = s.correcta + s.parcial + s.incorrecta;
  $("caseTitle").textContent = current.title;
  $("scoreOk").textContent = s.correcta;
  $("scorePartial").textContent = s.parcial;
  $("scoreBad").textContent = s.incorrecta;
  $("scorePct").textContent = total ? `${Math.round(((s.correcta + s.parcial * 0.5) / total) * 100)}%` : "–";
  $("closeCaseBtn").disabled = current.closed || total === 0 || !!ctrl;
  show($("closeCaseBtn"), !current.closed);
}

function renderClosedState() {
  const closed = !!current?.closed;
  show($("chatForm"), !closed);
  show($("chatClosed"), closed);
}

function renderSummary(summary) {
  const card = document.createElement("section");
  card.className = "summary-card";
  const h = document.createElement("h3");
  h.textContent = "Resumen del caso";
  card.appendChild(h);

  const add = (tag, text, cls) => { const el = document.createElement(tag); el.textContent = text; if (cls) el.className = cls; card.appendChild(el); return el; };
  if (summary.diagnostico) {
    const p = add("p", "");
    const b = document.createElement("strong"); b.textContent = "Diagnóstico: ";
    p.append(b, summary.diagnostico);
  }
  if (summary.resumen) add("p", summary.resumen);

  if (summary.aciertos?.length) {
    add("h4", "Lo que hiciste bien");
    const ul = document.createElement("ul");
    summary.aciertos.forEach((t) => { const li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
    card.appendChild(ul);
  }
  add("h4", summary.lagunas?.length ? "Lagunas para repasar (guardadas en Historial)" : "Sin lagunas detectadas 🎉");
  if (summary.lagunas?.length) {
    const ul = document.createElement("ul");
    summary.lagunas.forEach((l) => {
      const li = document.createElement("li");
      const b = document.createElement("strong"); b.textContent = l.tema;
      li.append(b, ` — ${l.explicacion}`);
      ul.appendChild(li);
    });
    card.appendChild(ul);
  }
  chatLog().appendChild(card);
  scrollChat();
}

function renderCase() {
  chatLog().querySelectorAll(":scope > :not(#chatEmpty)").forEach((n) => n.remove());
  show($("chatEmpty"), !current || !current.messages.length);
  if (current) {
    for (const m of current.messages) {
      const { badge, body, footer } = addBubble(m.role);
      if (m.role === "user") body.textContent = m.display || m.content;
      else { body.innerHTML = renderMd(visibleText(m.content)); setBadge(badge, m.eval); fillFooter(footer, body, m); }
    }
    if (current.summary) renderSummary(current.summary);
  }
  renderScore();
  renderClosedState();
}

// ---------------------------------------------------------------------------
//  Conversación
// ---------------------------------------------------------------------------
function newCaseObject(title) {
  return {
    id: uid(), createdAt: Date.now(), updatedAt: Date.now(), title: title.slice(0, 90),
    model: settings.get().modelTutor, messages: [], scores: { correcta: 0, parcial: 0, incorrecta: 0 },
    closed: false, summary: null, cost: 0,
  };
}

async function persist(c) {
  c.updatedAt = Date.now();
  try { await db.put("casos", c); } catch { toast("No se pudo guardar el caso en el historial.", { kind: "error" }); }
}

function setBusy(busy) {
  $("sendBtn").disabled = busy;
  show($("sendBtn"), !busy);
  show($("stopChatBtn"), busy);
  renderScore();
}

async function send(text, { display, title } = {}) {
  text = text.trim();
  if (!text || ctrl || current?.closed) return;
  show($("chatError"), false);
  stopDictation();

  if (!current) {
    current = newCaseObject(title || display || text);
    ls.set("current_caso", current.id);
  }
  const convo = current; // si se pulsa "Nuevo caso" a mitad de respuesta, este turno no contamina el nuevo
  const isFirst = convo.messages.length === 0;
  const userMsg = { role: "user", content: text, ...(display ? { display } : {}) };
  convo.messages.push(userMsg);
  const userBubble = addBubble("user");
  userBubble.body.textContent = display || text;
  $("chatInput").value = "";
  ls.del("draft_chat");
  autoGrow();
  renderScore();

  const { wrap, badge, body, footer } = addBubble("assistant");
  body.innerHTML = '<div class="typing"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
  const render = rafRenderer((raw) => { body.innerHTML = renderMd(visibleText(raw)); scrollChat(); });

  ctrl = new AbortController();
  setBusy(true);
  let reply = "";
  let result = null;

  try {
    result = await callClaude({
      model: convo.model,
      system: SYSTEM_TUTOR,
      messages: apiMessages(convo),
      maxTokens: 8000,
      effort: "medium", // solo aplica a Sonnet: respuestas más ágiles en el diálogo
      cache: true,
      signal: ctrl.signal,
      onText: (raw) => {
        reply = raw;
        const ev = raw.match(EVAL_RE)?.[1]?.toLowerCase();
        if (ev) setBadge(badge, ev);
        render(raw);
      },
    });
    reply = result.text;
  } catch (err) {
    onError($("chatError"), err);
  } finally {
    ctrl = null;
    render.cancel();
    setBusy(false);
  }

  if (convo !== current) return;

  if (!reply.trim()) {
    // Sin respuesta: retira el turno para que el historial siga alternando roles.
    wrap.remove();
    userBubble.wrap.remove();
    convo.messages.pop();
    if (!convo.messages.length) { current = null; ls.del("current_caso"); }
    renderCase();
    if (!display) { $("chatInput").value = text; autoGrow(); } // devuelve lo escrito para reintentar
    return;
  }

  const ev = reply.match(EVAL_RE)?.[1]?.toLowerCase();
  const msg = { role: "assistant", content: reply, ...(ev ? { eval: ev } : {}), ...(result ? { cost: result.cost, usage: result.usage } : {}) };
  convo.messages.push(msg);
  convo.cost += result?.cost || 0;
  if (ev) { convo.scores[ev]++; stats.bump("respuestas"); }
  if (isFirst) stats.bump("casos");
  body.innerHTML = renderMd(visibleText(reply));
  setBadge(badge, ev);
  fillFooter(footer, body, msg);
  renderScore();
  await persist(convo);

  if (settings.get().autoRead && ttsSupported) speakElement(body);
  $("chatInput").focus();
}

async function closeCase() {
  if (!current || current.closed || ctrl) return;
  const convo = current;
  show($("chatError"), false);
  ctrl = new AbortController();
  setBusy(true);
  $("closeCaseBtn").textContent = "Cerrando…";

  try {
    const result = await callClaude({
      model: convo.model,
      system: SYSTEM_TUTOR,
      messages: [...apiMessages(convo), { role: "user", content: CLOSE_CASE_PROMPT }],
      maxTokens: 6000,
      effort: "medium",
      format: CLOSE_CASE_FORMAT,
      cache: true,
      signal: ctrl.signal,
    });
    const summary = JSON.parse(result.text);
    convo.summary = summary;
    convo.closed = true;
    convo.cost += result.cost || 0;
    await persist(convo);

    const lagunas = summary.lagunas || [];
    for (const l of lagunas) {
      await db.put("lagunas", {
        id: uid(), createdAt: Date.now(), tema: l.tema, explicacion: l.explicacion,
        casoId: convo.id, casoTitle: convo.title, repasada: false,
      }).catch(() => {});
    }
    if (convo === current) renderCase();
    toast(lagunas.length ? `Caso cerrado. ${lagunas.length} laguna${lagunas.length > 1 ? "s" : ""} guardada${lagunas.length > 1 ? "s" : ""} en Historial.` : "Caso cerrado. ¡Sin lagunas detectadas!", { kind: "success" });
  } catch (err) {
    if (err instanceof SyntaxError) onError($("chatError"), { message: "No se pudo leer el resumen del caso. Inténtalo de nuevo." });
    else onError($("chatError"), err);
  } finally {
    ctrl = null;
    $("closeCaseBtn").textContent = "Cerrar caso";
    setBusy(false);
  }
}

function resetCase() {
  ctrl?.abort();
  stopSpeaking();
  stopDictation();
  current = null;
  ls.del("current_caso");
  renderCase();
  show($("chatError"), false);
  $("chatInput").focus();
}

function autoGrow() {
  const ta = $("chatInput");
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
}

// ---------------------------------------------------------------------------
//  API pública
// ---------------------------------------------------------------------------
export function startCase(content, { display, title } = {}) {
  resetCase();
  send(content, { display, title });
}

export async function openCase(id) {
  const rec = await db.get("casos", id);
  if (!rec) return false;
  ctrl?.abort();
  stopSpeaking();
  current = rec;
  ls.set("current_caso", id);
  renderCase();
  show($("chatError"), false);
  return true;
}

export async function initTutor(opts) {
  onError = opts.onError;
  const input = $("chatInput");
  const saveDraft = debounce(() => ls.set("draft_chat", input.value), 400);

  input.addEventListener("input", () => { autoGrow(); saveDraft(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); }
  });
  $("chatForm").addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
  $("stopChatBtn").addEventListener("click", () => ctrl?.abort());
  $("resetChatBtn").addEventListener("click", resetCase);
  $("newCaseBtn").addEventListener("click", resetCase);
  $("closeCaseBtn").addEventListener("click", closeCase);
  $("topicChips").addEventListener("click", (e) => {
    if (e.target.matches(".chip")) send(e.target.textContent);
  });
  bindDictation($("micChat"), input);

  input.value = ls.get("draft_chat", "");
  autoGrow();
  const lastId = ls.get("current_caso");
  if (!(lastId && (await openCase(lastId)))) renderCase();
}
