// Keeps the page and the dashboard layout in the browser, so with the server down or hung the page still opens,
// shows the last tiles (saved by store.js) and says it is offline, instead of a proxy error or an endless load.
/** @type {any} */
const sw = self
const CACHE = 'homelabdash-v1'
// After this long without an answer the cached copy is shown; the real answer still refreshes the cache.
const WAIT = 4000

sw.addEventListener('install', () => sw.skipWaiting())
sw.addEventListener('activate', (/** @type {any} */ e) => e.waitUntil(sw.clients.claim()))

sw.addEventListener('fetch', (/** @type {any} */ e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== sw.location.origin) return
  if (url.pathname.startsWith('/assets/')) return e.respondWith(cacheFirst(req))
  if (req.mode === 'navigate') return e.respondWith(networkFirst(req, '/'))
  if (url.pathname === '/api/dashboard' || url.pathname.startsWith('/icons/') || url.pathname === '/favicon.svg' ||
    url.pathname === '/custom.css' || url.pathname === '/custom.js' || /^\/plugins\/[^/]+\/widget\.js$/.test(url.pathname)) {
    return e.respondWith(networkFirst(req, url.pathname.startsWith('/icons/') ? url.pathname + url.search : url.pathname))
  }
})

/** Hashed file names never change content. @param {Request} req */
async function cacheFirst (req) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) cache.put(req, res.clone())
  return res
}

/**
 * The server's answer when it comes in time, else the cached one. A 401 is passed through so the login prompt still
 * shows; a 5xx (the reverse proxy with the server down) falls back to the cache.
 * @param {Request} req @param {string} key
 */
async function networkFirst (req, key) {
  const cache = await caches.open(CACHE)
  const net = fetch(req).then(async res => {
    if (res.ok) {
      if (key === '/') await pruneAssets(cache, await res.clone().text())
      await cache.put(key, res.clone())
    }
    return res
  })
  net.catch(() => {})
  /** @type {Promise<undefined>} */
  const late = new Promise(resolve => setTimeout(resolve, WAIT))
  let res
  try {
    res = await Promise.race([net, late])
  } catch {
    return (await cache.match(key)) ?? Response.error()
  }
  if (res && res.status < 500) return res
  const hit = await cache.match(key)
  if (hit) return hit
  return res ?? net.catch(() => Response.error())
}

/** Drops page files the new index.html no longer loads, so the cache does not grow with every release. */
async function pruneAssets (/** @type {Cache} */ cache, /** @type {string} */ html) {
  for (const req of await cache.keys()) {
    const p = new URL(req.url).pathname
    if (p.startsWith('/assets/') && !html.includes(p)) await cache.delete(req)
  }
}
