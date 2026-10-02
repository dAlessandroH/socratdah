// Cliente mínimo de la API de Anthropic (fetch directo desde el navegador).
import { API_URL, MODELS } from "./config.js";
import { apiKey, settings, usage } from "./store.js";
import { fmtCost } from "./ui.js";

export class ApiError extends Error {
  constructor(message, { status = 0, kind = "api" } = {}) {
    super(message);
    this.status = status;
    this.kind = kind; // "api" | "auth" | "budget" | "network" | "refusal"
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 529]);
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
});

function checkBudget() {
  const { dailyLimit } = settings.get();
  const spent = usage.today().cost;
  if (dailyLimit > 0 && spent >= dailyLimit) {
    throw new ApiError(
      `Alcanzaste tu límite diario (${fmtCost(spent)} de $${dailyLimit}). Puedes subirlo en Ajustes.`,
      { kind: "budget" },
    );
  }
}

async function post(body, signal) {
  const key = apiKey.get();
  if (!key) throw new ApiError("Falta la API Key.", { kind: "auth" });

  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        signal,
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          // Habilita CORS para llamadas directas desde el navegador
          // (equivale a `dangerouslyAllowBrowser: true` del SDK oficial).
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (err.name === "AbortError") throw err;
      throw new ApiError(navigator.onLine ? "No se pudo conectar con la API." : "Sin conexión a internet.", { kind: "network" });
    }

    if (res.ok) return res;

    if (RETRYABLE.has(res.status) && attempt < 2) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(retryAfter > 0 ? Math.min(retryAfter, 20) * 1000 : 1500 * 2 ** attempt, signal);
      continue;
    }

    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch {}
    const messages = {
      401: "API Key inválida o revocada.",
      403: "La API Key no tiene permiso para este modelo.",
      404: "Modelo no disponible para esta cuenta.",
      413: "La petición es demasiado grande (máx. 32 MB). Quita algún archivo.",
      429: "Límite de uso de la API alcanzado. Espera un momento y reintenta.",
      529: "La API está sobrecargada. Reintenta en unos segundos.",
    };
    const msg = res.status === 400 && detail ? `Solicitud rechazada: ${detail}` : messages[res.status] || detail || `Error ${res.status}`;
    throw new ApiError(msg, { status: res.status, kind: res.status === 401 ? "auth" : "api" });
  }
}

function buildBody({ model, system, messages, maxTokens, effort, format, stream, cache }) {
  const body = { model, max_tokens: maxTokens, system, messages };
  if (stream) body.stream = true;
  // Caché automático: el prefijo ya enviado (system + historial) se cobra a 0.1× en la siguiente petición.
  if (cache) body.cache_control = { type: "ephemeral" };
  const outputConfig = {};
  if (effort && MODELS[model]?.effort) outputConfig.effort = effort;
  if (format) outputConfig.format = format;
  if (Object.keys(outputConfig).length) body.output_config = outputConfig;
  return body;
}

/**
 * Llama a la API. Con `onText` usa streaming (SSE) y va entregando el texto acumulado.
 * Devuelve { text, stopReason, usage, cost }.
 */
export async function callClaude({ model, system, messages, maxTokens = 16000, effort, format, cache = true, signal, onText, onThinking }) {
  checkBudget();
  const stream = typeof onText === "function";
  const res = await post(buildBody({ model, system, messages, maxTokens, effort, format, stream, cache }), signal);

  if (!stream) {
    const data = await res.json();
    const cost = usage.add(model, data.usage);
    if (data.stop_reason === "refusal") throw new ApiError("El modelo declinó responder esta solicitud.", { kind: "refusal" });
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    return { text, stopReason: data.stop_reason, usage: data.usage, cost };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", text = "", stopReason = null, u = null, aborted = false, cost = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const data = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
        if (!data) continue;
        let evt;
        try { evt = JSON.parse(data); } catch { continue; }

        switch (evt.type) {
          case "message_start":
            u = { ...evt.message?.usage };
            break;
          case "content_block_start":
            if (evt.content_block?.type === "thinking") onThinking?.();
            break;
          case "content_block_delta":
            if (evt.delta?.type === "text_delta") { text += evt.delta.text; onText(text); }
            break;
          case "message_delta":
            if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
            if (evt.usage) u = { ...u, ...Object.fromEntries(Object.entries(evt.usage).filter(([, v]) => v != null)) };
            break;
          case "error":
            throw new ApiError(evt.error?.message || "Error durante la respuesta.", { kind: "api" });
        }
      }
    }
  } catch (err) {
    aborted = err.name === "AbortError";
    throw err;
  } finally {
    // Registra el gasto aunque la respuesta se haya detenido a medias.
    if (u) {
      if (aborted && !stopReason) u.output_tokens = Math.max(u.output_tokens || 0, Math.round(text.length / 3.5));
      cost = usage.add(model, u);
    }
  }

  if (stopReason === "refusal") throw new ApiError("El modelo declinó responder esta solicitud. Reformúlala e inténtalo de nuevo.", { kind: "refusal" });
  return { text, stopReason, usage: u, cost };
}
