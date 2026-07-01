export const APP_VERSION = "1.2.2-sw-recovery";

const VERSION_MESSAGE = "DAGGERHEART_GET_SW_VERSION";
const VERSION_RESPONSE = "DAGGERHEART_SW_VERSION";
const RECOVERY_STORAGE_KEY = `daggerheart-sw-recovery-${APP_VERSION}`;
const SERVER_VERSION_URL = "/app-version.json";

function shouldDeleteCache(cacheName) {
  const normalized = cacheName.toLowerCase();

  if (normalized.includes(APP_VERSION.toLowerCase())) {
    return false;
  }

  return (
    normalized.startsWith("workbox-") ||
    normalized.includes("workbox-precache") ||
    normalized.includes("precache") ||
    normalized.includes("runtime") ||
    normalized.startsWith("daggerheart-")
  );
}

function getReloadUrl(reason) {
  const url = new URL(window.location.href);
  url.searchParams.set("sw-reset", APP_VERSION);
  url.searchParams.set("sw-reset-reason", reason);
  url.searchParams.set("t", String(Date.now()));
  return url.toString();
}

async function clearKnownAppCaches() {
  if (!("caches" in window)) {
    return;
  }

  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames.filter(shouldDeleteCache).map((cacheName) => caches.delete(cacheName)),
  );
}

async function unregisterAllServiceWorkers() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
}

function readControllerVersion(controller) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeoutId = window.setTimeout(() => resolve(null), 900);

    channel.port1.onmessage = (event) => {
      window.clearTimeout(timeoutId);

      if (event.data?.type === VERSION_RESPONSE) {
        resolve(event.data.version ?? null);
        return;
      }

      resolve(null);
    };

    controller.postMessage({ type: VERSION_MESSAGE }, [channel.port2]);
  });
}

async function resetServiceWorkerState(reason) {
  if (sessionStorage.getItem(RECOVERY_STORAGE_KEY) === reason) {
    return false;
  }

  sessionStorage.setItem(RECOVERY_STORAGE_KEY, reason);

  await unregisterAllServiceWorkers();
  await clearKnownAppCaches();

  try {
    await fetch(`/sw.js?sw-reset=${Date.now()}`, { cache: "reload" });
  } catch {
    // Ignore network/cache errors. The following reload will try again.
  }

  window.location.replace(getReloadUrl(reason));
  return true;
}

export async function recoverFromLegacyServiceWorker() {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
    return false;
  }

  if (!navigator.onLine) {
    return false;
  }

  const activeVersion = await readControllerVersion(navigator.serviceWorker.controller);

  if (activeVersion === APP_VERSION) {
    return false;
  }

  const reason = activeVersion ? "version-mismatch" : "legacy-sw";
  return resetServiceWorkerState(reason);
}

export async function checkForServerVersionUpdate() {
  if (!("serviceWorker" in navigator) || !navigator.onLine) {
    return false;
  }

  try {
    const response = await fetch(`${SERVER_VERSION_URL}?t=${Date.now()}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return false;
    }

    const payload = await response.json();

    if (payload?.buildId && payload.buildId !== APP_VERSION) {
      return resetServiceWorkerState("server-version-mismatch");
    }
  } catch {
    return false;
  }

  return false;
}
