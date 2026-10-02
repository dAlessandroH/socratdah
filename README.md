# SocraTDAH

Plataforma de estudio de medicina pensada para TDAH. Funciona 100 % en el navegador (sin servidor) y usa tu propia API key de Anthropic.

- **1. Esquema Rápido**: pega texto o adjunta fotos de apuntes, diapositivas o un PDF. Devuelve un esquema jerárquico con tabla comparativa, diagrama de flujo (Mermaid) y 5 preguntas de active recall. Se puede escuchar en voz alta, copiar, descargar en `.md` o guardar como PDF.
- **2. Tutor Socrático**: casos clínicos de una pregunta a la vez. Cada respuesta se califica (✓ correcta, ◐ parcial, ✗ incorrecta). "Cerrar caso" genera un resumen y guarda tus lagunas para repasarlas.
- **3. Historial**: esquemas, casos y lagunas, con buscador. Todo queda guardado solo en tu navegador.
- **Extras**: Pomodoro con racha diaria, dictado por voz (opcional), contador de tokens y costo, límite de gasto diario, elección de modelo e instalación como app.

## Publicar en GitHub Pages

1. Crea un repositorio y sube **todo el contenido de esta carpeta** (incluye `js/`, `icons/`, `sw.js` y `manifest.webmanifest`).
2. Ve a **Settings → Pages → Build and deployment → Deploy from a branch**, elige `main` y la carpeta `/ (root)`.
3. Abre la URL que te da GitHub (`https://<usuario>.github.io/<repo>/`). No necesita compilarse.

Para probarla en tu computadora, sírvela con `python3 -m http.server` y abre `http://localhost:8000`. Con doble clic sobre `index.html` no funciona, porque los módulos de JavaScript requieren un servidor.

## Seguridad de tu cuenta

- **Política de seguridad (CSP)**: la página solo ejecuta su propio código y 3 archivos exactos del CDN, y solo puede conectarse a `api.anthropic.com`. Aunque algo intentara leer la clave, no podría enviarla a otro sitio.
- **SRI**: marked, DOMPurify y Mermaid llevan su hash. Si alguien modifica esos archivos en el CDN, el navegador se niega a ejecutarlos.
- **Sin Tailwind por CDN**: los estilos son un archivo propio (`styles.css`).
- **El contenido del modelo se sanea** con DOMPurify antes de mostrarse.
- **Límite diario** configurable en Ajustes (2 USD por defecto).
- La opción **"Recordar en este dispositivo"** se puede desmarcar para que la clave se borre al cerrar la pestaña.
- Se rechazan las Admin keys (`sk-ant-admin…`).

Recomendado, desde la [consola de Anthropic](https://console.anthropic.com):

1. Crea una API key **exclusiva** para esta app.
2. Pon un **límite de gasto mensual** (Settings → Limits). Es el único tope que nadie puede saltarse, ni siquiera con tu clave.
3. Si crees que la clave se filtró, revócala y pega una nueva en la app.

## Estructura

```
index.html            Interfaz y CSP
styles.css            Estilos (tema oscuro)
manifest.webmanifest  PWA
sw.js                 Service worker (modo sin conexión)
icons/                Íconos de la app
js/
  config.js     Modelos, precios y prompts (edítalo para cambiar el comportamiento)
  api.js        Llamadas a la API (streaming, caché, reintentos y límite de gasto)
  store.js      localStorage + IndexedDB
  esquema.js    Módulo 1
  tutor.js      Módulo 2
  history.js    Historial
  voice.js      Lectura en voz alta y dictado
  pomodoro.js   Temporizador y racha
  settings.js   Ajustes, API key y uso
  markdown.js   Markdown y diagramas
  ui.js         Utilidades
  main.js       Arranque
```

Con conexión, la app siempre descarga la última versión. Si cambias archivos, sube también `VERSION` en `sw.js` (por ejemplo `socratdah-v3`) para renovar la copia sin conexión.
