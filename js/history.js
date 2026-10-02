// Pestaña 3: historial de esquemas, casos y lagunas, con buscador.
import { MODELS } from "./config.js";
import { db } from "./store.js";
import { $, show, fmtDate, setTab, onTabShow, toast } from "./ui.js";
import { openEsquema } from "./esquema.js";
import { openCase, startCase } from "./tutor.js";

let items = [];
let filter = "all";
let pendingOnly = false;

const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function load() {
  const [esquemas, casos, lagunas] = await Promise.all([db.all("esquemas"), db.all("casos"), db.all("lagunas")]).catch(() => [[], [], []]);
  items = [
    ...esquemas.map((e) => ({
      type: "esquema", id: e.id, date: e.updatedAt, title: e.title,
      meta: [MODELS[e.model]?.label, e.files?.length ? `${e.files.length} archivo${e.files.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · "),
      search: norm(`${e.title} ${e.source} ${e.markdown}`),
    })),
    ...casos.map((c) => ({
      type: "caso", id: c.id, date: c.updatedAt, title: c.title, closed: c.closed, scores: c.scores,
      meta: c.closed ? "Cerrado" : "En curso",
      search: norm(`${c.title} ${c.messages.map((m) => m.content).join(" ")}`),
    })),
    ...lagunas.map((l) => ({
      type: "laguna", id: l.id, date: l.createdAt, title: l.tema, text: l.explicacion, from: l.casoTitle, repasada: l.repasada, raw: l,
      search: norm(`${l.tema} ${l.explicacion} ${l.casoTitle}`),
    })),
  ].sort((a, b) => b.date - a.date);
  render();
}

function render() {
  const q = norm($("histSearch").value.trim());
  const counts = { all: items.length, esquema: 0, caso: 0, laguna: 0 };
  items.forEach((i) => counts[i.type]++);
  document.querySelectorAll("#histFilters button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.filter === filter));
    b.querySelector(".count").textContent = counts[b.dataset.filter] ?? "";
  });
  show($("histPendingWrap"), filter === "laguna");

  const list = $("histList");
  list.innerHTML = "";
  const visible = items.filter((i) =>
    (filter === "all" || i.type === filter)
    && (!q || q.split(/\s+/).every((w) => i.search.includes(w)))
    && !(pendingOnly && filter === "laguna" && i.repasada));

  show($("histEmpty"), !visible.length);
  $("histEmpty").textContent = items.length ? "Nada coincide con la búsqueda." : "Aún no hay nada guardado. Genera un esquema o resuelve un caso.";

  for (const i of visible) list.appendChild(card(i));
}

function card(i) {
  const el = document.createElement("article");
  el.className = `hist-item hist-${i.type}${i.repasada ? " is-done" : ""}`;
  el.dataset.id = i.id;
  el.dataset.type = i.type;

  const head = document.createElement("div");
  head.className = "hist-head";
  const tag = document.createElement("span");
  tag.className = `tag tag-${i.type}`;
  tag.textContent = { esquema: "Esquema", caso: "Caso", laguna: "Laguna" }[i.type];
  const date = document.createElement("span");
  date.className = "muted small";
  date.textContent = fmtDate(i.date);
  head.append(tag, date);
  el.appendChild(head);

  const title = document.createElement("h3");
  title.className = "hist-title";
  title.textContent = i.title;
  el.appendChild(title);

  if (i.type === "laguna") {
    const p = document.createElement("p");
    p.className = "hist-text";
    p.textContent = i.text;
    el.appendChild(p);
    if (i.from) {
      const from = document.createElement("p");
      from.className = "muted small";
      from.textContent = `Del caso: ${i.from}`;
      el.appendChild(from);
    }
  } else {
    const meta = document.createElement("p");
    meta.className = "muted small";
    meta.textContent = i.meta;
    if (i.type === "caso" && i.scores) {
      const s = i.scores;
      meta.textContent += ` · ✓ ${s.correcta}  ◐ ${s.parcial}  ✗ ${s.incorrecta}`;
    }
    el.appendChild(meta);
  }

  const actions = document.createElement("div");
  actions.className = "hist-actions";
  const btn = (label, action, cls = "btn btn-sm btn-outline") => {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = label;
    b.dataset.action = action;
    actions.appendChild(b);
    return b;
  };
  if (i.type === "laguna") {
    const lbl = document.createElement("label");
    lbl.className = "check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!i.repasada;
    cb.dataset.action = "toggle";
    lbl.append(cb, " Repasada");
    actions.appendChild(lbl);
    btn("Practicar caso", "practice", "btn btn-sm btn-primary");
  } else {
    btn(i.type === "caso" && !i.closed ? "Continuar" : "Abrir", "open", "btn btn-sm btn-primary");
  }
  btn("Eliminar", "delete", "btn btn-sm btn-ghost danger");
  el.appendChild(actions);
  return el;
}

async function onAction(e) {
  const target = e.target.closest("[data-action]");
  if (!target) return;
  if ((target.dataset.action === "toggle") !== (e.type === "change")) return; // la casilla se maneja solo en "change"
  const el = target.closest(".hist-item");
  const item = items.find((x) => x.id === el.dataset.id);
  if (!item) return;
  const store = { esquema: "esquemas", caso: "casos", laguna: "lagunas" }[item.type];

  switch (target.dataset.action) {
    case "open":
      if (item.type === "esquema" && (await openEsquema(item.id))) setTab("esquema");
      if (item.type === "caso" && (await openCase(item.id))) setTab("tutor");
      break;
    case "practice":
      setTab("tutor");
      startCase(
        `Quiero practicar un caso clínico enfocado en esta laguna que tuve: "${item.title}". ${item.text}`,
        { display: `Repasar laguna: ${item.title}`, title: `Repaso: ${item.title}` },
      );
      break;
    case "toggle":
      item.repasada = target.checked;
      await db.put("lagunas", { ...item.raw, repasada: item.repasada });
      item.raw.repasada = item.repasada;
      el.classList.toggle("is-done", item.repasada);
      if (pendingOnly) render();
      break;
    case "delete":
      if (!confirm(`¿Eliminar "${item.title}" del historial? No se puede deshacer.`)) return;
      await db.del(store, item.id);
      items = items.filter((x) => x !== item);
      render();
      toast("Eliminado.");
      break;
  }
}

export function initHistory() {
  $("histSearch").addEventListener("input", render);
  $("histFilters").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-filter]");
    if (!b) return;
    filter = b.dataset.filter;
    render();
  });
  $("histPending").addEventListener("change", (e) => { pendingOnly = e.target.checked; render(); });
  $("histList").addEventListener("click", onAction);
  $("histList").addEventListener("change", onAction);
  onTabShow("historial", load);
}
