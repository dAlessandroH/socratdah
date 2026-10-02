// Punto de entrada: conecta los módulos.
import { apiKey, ls } from "./store.js";
import { setTab } from "./ui.js";
import { initTtsBar } from "./voice.js";
import { initPomodoro } from "./pomodoro.js";
import { initSettings, openKeyModal, handleApiError } from "./settings.js";
import { initEsquema } from "./esquema.js";
import { initTutor, startCase } from "./tutor.js";
import { initHistory } from "./history.js";

document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

initTtsBar();
initSettings();
initPomodoro();
initHistory();

await Promise.all([
  initEsquema({
    onError: handleApiError,
    // Del esquema al caso: el tutor recibe el esquema como contexto para que el caso se base en lo estudiado.
    onPractice: (rec) => {
      setTab("tutor");
      startCase(
        `Quiero practicar un caso clínico sobre **${rec.title}**. Basa el caso en lo que acabo de estudiar:\n\n<esquema_estudiado>\n${rec.markdown}\n</esquema_estudiado>`,
        { display: `Practicar caso: ${rec.title}`, title: rec.title },
      );
    },
  }),
  initTutor({ onError: handleApiError }),
]);

setTab(ls.get("tab", "esquema"));
if (!apiKey.get()) openKeyModal();

// PWA: solo en https o localhost
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
