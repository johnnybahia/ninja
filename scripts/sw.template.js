/* Kage service worker. The build (pwa plugin in vite.config.ts) fills in VERSION and FILES and
 * writes the result to dist/sw.js: every file of the game, with a content hash, is stored on the
 * first visit so the game opens without a connection. A new build only downloads what changed.
 * The new version waits until the player taps "Atualizar" (see src/pwa.ts), so a run is never
 * swapped from under them. */
const VERSION = '__VERSION__';
const FILES = __FILES__; // path relative to the scope -> content hash
const CACHE = 'kage-assets';
const FONTS = 'kage-fonts';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const SCOPE = self.registration.scope;
const scopePath = new URL(SCOPE).pathname;
const rels = Object.keys(FILES);
const keyOf = (rel) => new URL(`${rel}?__h=${FILES[rel]}`, SCOPE).href; // one cache entry per file version

const tell = async (msg) => {
  for (const c of await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })) c.postMessage(msg);
};

async function precache() {
  const cache = await caches.open(CACHE);
  const have = new Set((await cache.keys()).map((r) => r.url));
  const todo = rels.filter((rel) => !have.has(keyOf(rel)));
  const fresh = !self.registration.active; // first install (an update runs behind the scenes)
  let done = rels.length - todo.length;
  let last = 0;
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const rel = todo[i++];
      // no-cache: revalidate (a 304 costs no download), so a stale HTTP-cached copy never gets stored
      const res = await fetch(new URL(rel, SCOPE), { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${rel}: ${res.status}`);
      await cache.put(keyOf(rel), res);
      done++;
      const now = Date.now();
      if (now - last > 250) {
        last = now;
        tell({ type: 'progress', done, total: rels.length, fresh });
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  tell({ type: 'progress', done: rels.length, total: rels.length, fresh });
}

self.addEventListener('install', (e) => e.waitUntil(precache()));

self.addEventListener('activate', (e) =>
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const keep = new Set(rels.map(keyOf));
      for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
      await self.clients.claim();
      tell({ type: 'ready', version: VERSION });
    })()
  )
);

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'SKIP_WAITING') self.skipWaiting();
  if (d.type === 'STATUS') {
    e.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE);
        const have = new Set((await cache.keys()).map((r) => r.url));
        const missing = rels.filter((rel) => !have.has(keyOf(rel))).length;
        e.source.postMessage({ type: 'status', version: VERSION, total: rels.length, missing });
      })()
    );
  }
});

async function font(req) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(req);
  const net = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (FONT_HOSTS.includes(url.hostname)) return void e.respondWith(font(req));
  if (url.origin !== self.location.origin || !url.pathname.startsWith(scopePath)) return;
  let rel = url.pathname.slice(scopePath.length);
  if (req.mode === 'navigate' || rel === '') rel = 'index.html';
  if (!Object.prototype.hasOwnProperty.call(FILES, rel)) return; // not part of the game: the network decides
  e.respondWith(
    caches.open(CACHE).then(async (cache) => (await cache.match(keyOf(rel))) || fetch(req)) // not stored yet: network
  );
});
