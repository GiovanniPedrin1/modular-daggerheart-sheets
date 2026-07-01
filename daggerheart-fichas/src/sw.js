import { clientsClaim, setCacheNameDetails } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

const APP_VERSION = '1.2.3-stable-pwa';
const APP_SHELL_CACHE = `daggerheart-app-shell-${APP_VERSION}`;
const IMAGE_CACHE = `daggerheart-images-${APP_VERSION}`;
const MANIFEST_CACHE = `daggerheart-manifest-${APP_VERSION}`;
const INDEX_URL = '/index.html';

setCacheNameDetails({
  prefix: 'daggerheart',
  suffix: APP_VERSION,
});

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function shouldDeleteCache(cacheName) {
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

async function deleteOldAppCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter(shouldDeleteCache)
      .map((cacheName) => caches.delete(cacheName)),
  );
}

function isHtmlResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  return response.ok && contentType.includes('text/html');
}

async function putIndexInCache(response) {
  if (!isHtmlResponse(response)) {
    return;
  }

  const cache = await caches.open(APP_SHELL_CACHE);
  await cache.put(INDEX_URL, response.clone());
}

async function cacheIndexFromNetwork() {
  const response = await fetch(INDEX_URL, { cache: 'reload' });
  await putIndexInCache(response);
}

async function getCachedIndex() {
  const cache = await caches.open(APP_SHELL_CACHE);
  const cachedIndex = await cache.match(INDEX_URL);

  if (cachedIndex) {
    return cachedIndex;
  }

  return new Response(
    '<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Daggerheart Fichas</title></head><body><p>O app ainda não está disponível offline. Abra o app online uma vez e tente novamente.</p></body></html>',
    {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    },
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheIndexFromNetwork().catch(() => undefined));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(deleteOldAppCaches());
});

const precacheManifest = self.__WB_MANIFEST.filter((entry) => {
  const url = entry.url || '';

  return (
    !url.endsWith('.html') &&
    url !== '/' &&
    !url.endsWith('/index.html') &&
    !url.endsWith('/sw.js')
  );
});

precacheAndRoute(precacheManifest);

registerRoute(
  ({ request }) => request.mode === 'navigate',
  async ({ request }) => {
    try {
      const networkResponse = await fetch(request, { cache: 'reload' });

      if (isHtmlResponse(networkResponse)) {
        await putIndexInCache(networkResponse);
      }

      return networkResponse;
    } catch {
      return getCachedIndex();
    }
  },
);

registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: IMAGE_CACHE,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 80,
        maxAgeSeconds: 60 * 60 * 24 * 30,
      }),
    ],
  }),
);

registerRoute(
  ({ request }) => request.destination === 'manifest',
  new StaleWhileRevalidate({
    cacheName: MANIFEST_CACHE,
  }),
);
