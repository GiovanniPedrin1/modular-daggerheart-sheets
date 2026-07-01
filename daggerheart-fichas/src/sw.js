import { clientsClaim, setCacheNameDetails } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

const APP_VERSION = '1.2.2-sw-recovery';
const APP_SHELL_CACHE = `daggerheart-app-shell-${APP_VERSION}`;
const VERSION_MESSAGE = 'DAGGERHEART_GET_SW_VERSION';
const VERSION_RESPONSE = 'DAGGERHEART_SW_VERSION';
const INDEX_URL = '/index.html';

setCacheNameDetails({
  prefix: 'daggerheart',
  suffix: APP_VERSION,
});

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

function shouldDeleteLegacyCache(cacheName) {
  const normalized = cacheName.toLowerCase();

  if (normalized.includes(APP_VERSION.toLowerCase())) {
    return false;
  }

  return (
    normalized.startsWith('workbox-') ||
    normalized.includes('workbox-precache') ||
    normalized.includes('precache') ||
    normalized.includes('runtime') ||
    normalized.startsWith('daggerheart-')
  );
}

async function deleteLegacyCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter(shouldDeleteLegacyCache)
      .map((cacheName) => caches.delete(cacheName)),
  );
}

self.addEventListener('message', (event) => {
  if (event.data?.type === VERSION_MESSAGE) {
    event.ports?.[0]?.postMessage({
      type: VERSION_RESPONSE,
      version: APP_VERSION,
    });
  }

  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(deleteLegacyCaches());
});

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
