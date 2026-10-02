// Configuración central: modelos, precios, prompts y librerías externas.

export const API_URL = "https://api.anthropic.com/v1/messages";

// Precios en USD por millón de tokens. Caché: escritura 1.25× entrada, lectura 0.1× entrada.
export const MODELS = {
  "claude-sonnet-5": { label: "Sonnet 5", hint: "más profundo", input: 2, output: 10, effort: true, maxPdfPages: 600 },
  "claude-haiku-4-5": { label: "Haiku 4.5", hint: "rápido y barato", input: 1, output: 5, effort: false, maxPdfPages: 100 },
};

export const CACHE_WRITE_MULT = 1.25;
export const CACHE_READ_MULT = 0.1;

export const DEFAULT_SETTINGS = {
  modelEsquema: "claude-sonnet-5",
  modelTutor: "claude-haiku-4-5",
  dailyLimit: 2,            // USD por día; 0 = sin límite
  voiceLang: (navigator.language || "").toLowerCase().startsWith("es") ? navigator.language : "es-MX",
  voiceRate: 1,
  autoRead: false,          // leer en voz alta las respuestas del tutor sin pulsar nada
  focusMin: 25,
  breakMin: 5,
};

// Librerías cargadas bajo demanda (con hash SRI; la CSP del index.html solo permite estas URLs exactas).
export const MERMAID = {
  src: "https://cdn.jsdelivr.net/npm/mermaid@12.1.0/dist/mermaid.min.js",
  integrity: "sha384-EbBpjO7rlR6eqZEcG7GaPpyk9H9WrMyPWX4d3KvPYltgt8Z8l0z6R56B1qP40pR4",
};

// Límite práctico del cuerpo de la petición (la API acepta hasta 32 MB).
export const MAX_REQUEST_BYTES = 30 * 1024 * 1024;

// ---------------------------------------------------------------------------
//  Prompts
// ---------------------------------------------------------------------------

export const SYSTEM_ESQUEMA = [
  "Eres un tutor de medicina de alto rendimiento especializado en estudiantes con TDAH.",
  "Tu objetivo es convertir el texto ingresado (y los archivos adjuntos, si los hay: fotos de apuntes, diapositivas o PDF) en un documento de texto ultra estructurado.",
  "REGLAS OBLIGATORIAS:",
  "1. NUNCA uses párrafos de más de 4 líneas.",
  "2. Usa viñetas cortas, negritas estratégicas y listas jerárquicas.",
  "3. Incluye OBLIGATORIAMENTE al menos una tabla comparativa en Markdown para diagnósticos diferenciales, clínica o tratamiento.",
  "4. Cero texto introductorio o de relleno.",
  "5. Puntos clave del tema.",
  "6. Incluye 5 preguntas de active recall al finalizar.",
  "7. Incluye al menos un diagrama de flujo Mermaid para el algoritmo diagnóstico/terapéutico o la fisiopatología, dentro de un bloque ```mermaid que empiece con `flowchart TD`.",
  "   En Mermaid: etiquetas cortas y SIEMPRE entre comillas dobles, por ejemplo A[\"Dolor torácico\"] --> B{\"¿Elevación ST?\"} y B -->|\"Sí\"| C[\"IAMCEST\"]. No uses comillas dobles dentro de una etiqueta.",
  "Empieza el documento con un título de nivel 1 (# Tema).",
].join("\n");

export const SYSTEM_TUTOR = [
  "Eres un profesor socrático de medicina. Planteas un caso clínico corto a la vez con 1 pregunta concreta.",
  "Esperas la respuesta del estudiante, evalúas de forma breve su razonamiento (destacando lo acertado y corrigiendo lagunas) y formulas la siguiente pregunta progresiva.",
  "Mantén tus respuestas directas y concisas.",
  "",
  "FORMATO DE EVALUACIÓN: cada vez que evalúes una respuesta del estudiante, la PRIMERA línea de tu mensaje debe ser exactamente una de estas etiquetas:",
  "[[EVAL:correcta]]  [[EVAL:parcial]]  [[EVAL:incorrecta]]",
  "No uses la etiqueta en el mensaje que abre el caso, ni cuando el estudiante solo hace una pregunta sin responder, ni en ningún otro lugar del texto.",
].join("\n");

export const CLOSE_CASE_PROMPT =
  "Cierra el caso aquí. Resume mi desempeño en todo el caso y enumera las lagunas de conocimiento concretas que mostré, " +
  "para que pueda repasarlas después. Si no hubo lagunas, deja la lista vacía.";

export const CLOSE_CASE_FORMAT = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      diagnostico: { type: "string", description: "Diagnóstico final del caso." },
      resumen: { type: "string", description: "Resumen del desempeño en 2 o 3 frases." },
      aciertos: { type: "array", items: { type: "string" }, description: "Lo que el estudiante razonó bien." },
      lagunas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tema: { type: "string", description: "Concepto concreto a repasar (máx. 8 palabras)." },
            explicacion: { type: "string", description: "Qué faltó y la idea correcta, en 1 o 2 frases." },
          },
          required: ["tema", "explicacion"],
          additionalProperties: false,
        },
      },
    },
    required: ["diagnostico", "resumen", "aciertos", "lagunas"],
    additionalProperties: false,
  },
};
