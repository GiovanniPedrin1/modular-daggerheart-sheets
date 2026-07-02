import { APP_VERSION, BUILD_CHANNEL, CACHE_VERSION } from './config/appVersion';

function activateWaitingWorker(registration) {
  if (registration.waiting) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
}

function watchForUpdates(registration) {
  registration.addEventListener('updatefound', () => {
    const installingWorker = registration.installing;

    if (!installingWorker) {
      return;
    }

    installingWorker.addEventListener('statechange', () => {
      if (installingWorker.state === 'installed') {
        activateWaitingWorker(registration);
      }
    });
  });
}

export function registerAppServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshPending = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || refreshPending) {
      return;
    }

    refreshPending = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      });

      window.__DAGGERHEART_APP_VERSION__ = APP_VERSION;
      window.__DAGGERHEART_BUILD_CHANNEL__ = BUILD_CHANNEL;
      window.__DAGGERHEART_CACHE_VERSION__ = CACHE_VERSION;

      watchForUpdates(registration);
      activateWaitingWorker(registration);
      await registration.update();
      activateWaitingWorker(registration);
    } catch (error) {
      console.warn('Não foi possível registrar o service worker.', error);
    }
  });
}
