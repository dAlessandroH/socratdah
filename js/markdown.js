// Renderizado de Markdown (marked + DOMPurify) y diagramas Mermaid bajo demanda.
import { MERMAID } from "./config.js";

/* global marked, DOMPurify */
marked.setOptions({ gfm: true, breaks: false });

// Los enlaces que genere el modelo se abren aparte y sin enviar referer.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export const renderMd = (md) =>
  DOMPurify.sanitize(marked.parse(md || ""), { FORBID_TAGS: ["style", "form", "input", "button", "iframe"], FORBID_ATTR: ["style"] });

// Texto plano a partir del HTML renderizado (para lectura en voz alta).
export function speechText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll("pre, svg, .mermaid-wrap, .no-speech").forEach((n) => n.remove());
  clone.querySelectorAll("h1, h2, h3, h4, p, li, td, th, blockquote").forEach((n) => n.append(". "));
  return clone.textContent.replace(/\s+/g, " ").replace(/(\.\s*){2,}/g, ". ").replace(/:\./g, ":").trim();
}

// ---------------------------------------------------------------------------
//  Mermaid (≈1.5 MB): solo se descarga la primera vez que hay un diagrama.
// ---------------------------------------------------------------------------
let mermaidReady = null;

function loadScript({ src, integrity }) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.integrity = integrity;
    s.crossOrigin = "anonymous";
    s.referrerPolicy = "no-referrer";
    s.onload = resolve;
    s.onerror = () => reject(new Error("No se pudo cargar la librería de diagramas."));
    document.head.appendChild(s);
  });
}

function loadMermaid() {
  mermaidReady ||= loadScript(MERMAID).then(() => {
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      flowchart: { htmlLabels: false, curve: "basis" },
      themeVariables: {
        darkMode: true,
        background: "#161a1f",
        mainBkg: "#1c2128",
        nodeBorder: "#14b8a6",
        clusterBkg: "#13232a",
        edgeLabelBackground: "#161a1f",
        textColor: "#e6eaef",
        primaryColor: "#1c2128",
        primaryTextColor: "#e6eaef",
        primaryBorderColor: "#14b8a6",
        lineColor: "#6b7683",
        secondaryColor: "#13232a",
        tertiaryColor: "#161a1f",
      },
    });
    return window.mermaid;
  }).catch((err) => { mermaidReady = null; throw err; });
  return mermaidReady;
}

let diagramSeq = 0;

export async function renderMermaid(container) {
  const blocks = [...container.querySelectorAll("pre > code.language-mermaid")];
  if (!blocks.length) return;

  let mermaid;
  try { mermaid = await loadMermaid(); } catch (err) {
    blocks.forEach((code) => markFailed(code.parentElement, err.message));
    return;
  }

  for (const code of blocks) {
    const pre = code.parentElement;
    if (!pre.isConnected) continue;
    const id = `mmd-${++diagramSeq}`;
    try {
      const { svg } = await mermaid.render(id, code.textContent);
      const wrap = document.createElement("figure");
      wrap.className = "mermaid-wrap";
      wrap.innerHTML = svg;
      pre.replaceWith(wrap);
    } catch {
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
      markFailed(pre, "No se pudo dibujar este diagrama; se muestra el código.");
    }
  }
}

function markFailed(pre, message) {
  if (pre.previousElementSibling?.classList.contains("diagram-note")) return;
  const note = document.createElement("p");
  note.className = "diagram-note no-speech";
  note.textContent = message;
  pre.before(note);
}
