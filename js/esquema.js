// Módulo 1: Esquema rápido (texto, fotos y PDF → documento jerárquico con tabla, diagrama y active recall).
import { MODELS, SYSTEM_ESQUEMA, MAX_REQUEST_BYTES } from "./config.js";
import { callClaude } from "./api.js";
import { db, ls, settings, stats, uid } from "./store.js";
import { $, show, toast, fmtBytes, rafRenderer, debounce, usageLine, downloadText, slug } from "./ui.js";
import { renderMd, renderMermaid } from "./markdown.js";
import { bindSpeakButton, bindDictation, stopSpeaking } from "./voice.js";

let attachments = [];   // [{ id, kind: "image"|"pdf", name, mediaType, data(base64), size }]
let current = null;     // registro del esquema mostrado
let ctrl = null;
let onError = () => {};
let onPractice = () => {};

// ---------------------------------------------------------------------------
//  Adjuntos
// ---------------------------------------------------------------------------
const readAsBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

// Redimensiona a ≤1568 px y ≈1.15 MP (lo que la API usa de todos modos): menos tokens y menos MB.
async function processImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1568 / Math.max(bmp.width, bmp.height), Math.sqrt(1.15e6 / (bmp.width * bmp.height)));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  return { data: await readAsBase64(blob), mediaType: "image/jpeg", size: blob.size };
}

const requestBytes = () => attachments.reduce((n, a) => n + a.data.length, 0) + $("sourceText").value.length * 2;

async function addFiles(files) {
  const list = [...files];
  if (!list.length) return;
  for (const f of list) {
    try {
      if (f.type === "application/pdf") {
        attachments.push({ id: uid(), kind: "pdf", name: f.name, mediaType: "application/pdf", data: await readAsBase64(f), size: f.size });
      } else if (f.type.startsWith("image/")) {
        const img = await processImage(f);
        attachments.push({ id: uid(), kind: "image", name: f.name || "imagen.jpg", ...img });
      } else {
        toast(`"${f.name}" no es imagen ni PDF.`, { kind: "error" });
      }
    } catch {
      toast(`No se pudo leer "${f.name}". Prueba con JPG, PNG o PDF.`, { kind: "error" });
    }
  }
  if (requestBytes() > MAX_REQUEST_BYTES) {
    toast("Los adjuntos superan ~30 MB, el máximo de la API. Quita alguno antes de generar.", { kind: "error", timeout: 7000 });
  }
  renderAttachments();
  saveDraftFiles();
}

function removeAttachment(id) {
  attachments = attachments.filter((a) => a.id !== id);
  renderAttachments();
  saveDraftFiles();
}

function renderAttachments() {
  const box = $("attachList");
  box.innerHTML = "";
  show(box, attachments.length > 0);
  for (const a of attachments) {
    const chip = document.createElement("div");
    chip.className = "attach";
    if (a.kind === "image") {
      const img = document.createElement("img");
      img.src = `data:${a.mediaType};base64,${a.data}`;
      img.alt = "";
      chip.appendChild(img);
    } else {
      const icon = document.createElement("span");
      icon.className = "attach-pdf";
      icon.textContent = "PDF";
      chip.appendChild(icon);
    }
    const meta = document.createElement("div");
    meta.className = "attach-meta";
    meta.innerHTML = "<span class='attach-name'></span><span class='attach-size'></span>";
    meta.firstChild.textContent = a.name;
    meta.lastChild.textContent = fmtBytes(a.size);
    chip.appendChild(meta);
    const x = document.createElement("button");
    x.className = "attach-x";
    x.setAttribute("aria-label", `Quitar ${a.name}`);
    x.textContent = "×";
    x.addEventListener("click", () => removeAttachment(a.id));
    chip.appendChild(x);
    box.appendChild(chip);
  }
  updateCount();
}

const saveDraftFiles = () => db.put("drafts", { id: "esquema-files", files: attachments }).catch(() => {});

// ---------------------------------------------------------------------------
//  Borrador y contador
// ---------------------------------------------------------------------------
const saveDraftText = debounce(() => ls.set("draft_source", $("sourceText").value), 400);

function updateCount() {
  const n = $("sourceText").value.length;
  const files = attachments.length ? ` · ${attachments.length} archivo${attachments.length > 1 ? "s" : ""}` : "";
  $("charCount").textContent = `${n.toLocaleString("es")} caracteres${files}`;
}

// ---------------------------------------------------------------------------
//  Generación
// ---------------------------------------------------------------------------
const extractTitle = (md) => (md.match(/^#{1,2}\s+(.+)$/m)?.[1] || "").replace(/[*_`#]/g, "").trim();

function setBusy(busy, statusText) {
  $("generateBtn").disabled = busy;
  show($("stopEsquemaBtn"), busy);
  show($("esquemaStatus"), busy && !!statusText);
  if (statusText) $("esquemaStatusText").textContent = statusText;
}

function showResult(rec) {
  current = rec;
  const out = $("esquemaOutput");
  out.innerHTML = renderMd(rec.markdown);
  show($("esquemaResult"), !!rec.markdown);
  $("esquemaMeta").textContent = rec.usage ? usageLine(rec.model, rec.usage, rec.cost, MODELS[rec.model]?.label) : "";
  renderMermaid(out);
}

async function generate() {
  const text = $("sourceText").value.trim();
  if (ctrl) return;
  if (!text && !attachments.length) { $("sourceText").focus(); return; }
  if (requestBytes() > MAX_REQUEST_BYTES) { onError($("esquemaError"), { message: "Los adjuntos superan el máximo de la API (~30 MB). Quita alguno." }); return; }

  const model = settings.get().modelEsquema;
  const pdfs = attachments.filter((a) => a.kind === "pdf");
  const content = attachments.map((a) => (a.kind === "pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data }, title: a.name }
    : { type: "image", source: { type: "base64", media_type: a.mediaType, data: a.data } }));
  content.push({ type: "text", text: text || "Genera el esquema a partir de los archivos adjuntos." });

  stopSpeaking();
  ctrl = new AbortController();
  current = null;
  $("esquemaOutput").innerHTML = "";
  show($("esquemaResult"), false);
  show($("esquemaError"), false);
  setBusy(true, attachments.length ? `Leyendo ${attachments.length} archivo${attachments.length > 1 ? "s" : ""}…` : "Leyendo el texto…");
  if (pdfs.length && MODELS[model].maxPdfPages < 600) {
    $("esquemaStatusText").textContent += ` (${MODELS[model].label} admite PDF de hasta ${MODELS[model].maxPdfPages} páginas)`;
  }

  const render = rafRenderer((md) => { $("esquemaOutput").innerHTML = renderMd(md); });
  let markdown = "";
  let result = null;

  try {
    result = await callClaude({
      model,
      system: SYSTEM_ESQUEMA,
      messages: [{ role: "user", content }],
      maxTokens: 16000,
      cache: false, // petición única: escribir caché solo encarecería
      signal: ctrl.signal,
      onThinking: () => { $("esquemaStatusText").textContent = "Organizando ideas…"; },
      onText: (md) => {
        markdown = md;
        show($("esquemaStatus"), false);
        show($("esquemaResult"));
        render(md);
      },
    });
    markdown = result.text;
    if (result.stopReason === "max_tokens") markdown += "\n\n> ⚠️ Respuesta truncada por longitud. Divide el material en partes más pequeñas.";
  } catch (err) {
    onError($("esquemaError"), err);
  } finally {
    ctrl = null;
    render.cancel();
    setBusy(false);
  }

  if (!markdown.trim()) return;

  const rec = {
    id: uid(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    title: extractTitle(markdown) || text.slice(0, 70) || attachments[0]?.name || "Esquema",
    source: text,
    files: attachments.map(({ name, kind, size }) => ({ name, kind, size })),
    markdown,
    model,
    usage: result?.usage || null,
    cost: result?.cost || 0,
  };
  showResult(rec);
  ls.set("current_esquema", rec.id);
  await db.put("esquemas", rec).catch(() => toast("No se pudo guardar en el historial.", { kind: "error" }));
  stats.bump("esquemas");
}

function clearAll() {
  if (ctrl) ctrl.abort();
  stopSpeaking();
  $("sourceText").value = "";
  ls.del("draft_source");
  attachments = [];
  renderAttachments();
  saveDraftFiles();
  current = null;
  ls.del("current_esquema");
  $("esquemaOutput").innerHTML = "";
  show($("esquemaResult"), false);
  show($("esquemaError"), false);
  $("sourceText").focus();
}

// ---------------------------------------------------------------------------
//  API pública
// ---------------------------------------------------------------------------
export async function openEsquema(id) {
  const rec = await db.get("esquemas", id);
  if (!rec) return false;
  stopSpeaking();
  ls.set("current_esquema", id);
  show($("esquemaError"), false);
  showResult(rec);
  return true;
}

export const currentEsquema = () => current;

export async function initEsquema(opts) {
  onError = opts.onError;
  onPractice = opts.onPractice;

  const ta = $("sourceText");
  ta.addEventListener("input", () => { updateCount(); saveDraftText(); });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); generate(); }
  });
  ta.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    if (files.length) { e.preventDefault(); addFiles(files); }
  });

  $("attachBtn").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });

  const drop = $("esqInput");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("dragging"); });
  drop.addEventListener("dragleave", (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove("dragging"); });
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("dragging"); addFiles(e.dataTransfer.files); });

  bindDictation($("micEsquema"), ta);

  $("generateBtn").addEventListener("click", generate);
  $("stopEsquemaBtn").addEventListener("click", () => ctrl?.abort());
  $("esqNew").addEventListener("click", clearAll);

  $("esqCopy").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    try { await navigator.clipboard.writeText(current?.markdown || ""); btn.textContent = "¡Copiado!"; } catch { btn.textContent = "No se pudo copiar"; }
    setTimeout(() => (btn.textContent = "Copiar"), 1500);
  });
  $("esqDownload").addEventListener("click", () => {
    if (current) downloadText(`${slug(current.title)}.md`, current.markdown);
  });
  $("esqPrint").addEventListener("click", () => {
    document.body.classList.add("print-esquema");
    window.addEventListener("afterprint", () => document.body.classList.remove("print-esquema"), { once: true });
    window.print();
  });
  bindSpeakButton($("esqSpeak"), () => (current ? $("esquemaOutput") : null));
  $("esqPractice").addEventListener("click", () => { if (current) onPractice(current); });

  // Restaurar borradores y último esquema
  ta.value = ls.get("draft_source", "");
  try { attachments = (await db.get("drafts", "esquema-files"))?.files || []; } catch { attachments = []; }
  renderAttachments();
  const lastId = ls.get("current_esquema");
  if (lastId) await openEsquema(lastId);
}
