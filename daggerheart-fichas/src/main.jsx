import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";

import {
  APP_VERSION,
  checkForServerVersionUpdate,
  recoverFromLegacyServiceWorker,
} from "./pwaRecovery.js";

window.__DAGGERHEART_APP_VERSION__ = APP_VERSION;

async function registerAppServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });

    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }

    await registration.update();
    void checkForServerVersionUpdate();

    registration.addEventListener("updatefound", () => {
      const installingWorker = registration.installing;

      if (!installingWorker) {
        return;
      }

      installingWorker.addEventListener("statechange", () => {
        if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
          installingWorker.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });

    setInterval(() => {
      registration.update();
      void checkForServerVersionUpdate();
    }, 30 * 60 * 1000);
  } catch (error) {
    console.warn("Não foi possível registrar o service worker.", error);
  }
}

let serviceWorkerRefreshPending = false;
navigator.serviceWorker?.addEventListener("controllerchange", () => {
  if (serviceWorkerRefreshPending) {
    return;
  }

  serviceWorkerRefreshPending = true;
  window.location.reload();
});

void recoverFromLegacyServiceWorker().then((recoveryStarted) => {
  if (!recoveryStarted) {
    void registerAppServiceWorker();
  }
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
