import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

const APP_VERSION = '1.2.1-cache-hotfix';
const APP_SHELL_CACHE = `daggerheart-app-shell-${APP_VERSION}`;
const INDEX_URL = '/index.html';

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

const precacheManifest = self.__WB_MANIFEST.filter(
  (entry) => !entry.url.endsWith('index.html'),
);

precacheAndRoute(precacheManifest);

async function fetchFreshIndex(request) {
  const networkResponse = await fetch(request, { cache: 'no-store' });

  if (networkResponse.ok) {
    return networkResponse;
  }

  const fallbackResponse = await fetch(INDEX_URL, { cache: 'no-store' });
  return fallbackResponse;
}

async function cacheIndex(response) {
  if (!response || !response.ok) {
    return;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return;
  }

  const cache = await caches.open(APP_SHELL_CACHE);
  await cache.put(INDEX_URL, response.clone());
}

async function getCachedIndex() {
  const versionedCache = await caches.open(APP_SHELL_CACHE);
  const versionedIndex = await versionedCache.match(INDEX_URL);

  if (versionedIndex) {
    return versionedIndex;
  }

  const legacyIndex = await caches.match(INDEX_URL);
  if (legacyIndex) {
    return legacyIndex;
  }

  return Response.error();
}

registerRoute(
  ({ request }) => request.mode === 'navigate',
  async ({ request }) => {
    try {
      const response = await fetchFreshIndex(request);
      await cacheIndex(response);
      return response;
    } catch {
      return getCachedIndex();
    }
  },
);

registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: `daggerheart-images-${APP_VERSION}`,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 60 * 60 * 24 * 30,
      }),
    ],
  }),
);

registerRoute(
  ({ request }) => request.destination === 'manifest',
  new StaleWhileRevalidate({
    cacheName: `daggerheart-manifest-${APP_VERSION}`,
  }),
);
