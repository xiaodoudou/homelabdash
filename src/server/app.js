import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { WebSocketServer } from 'ws'
import { HttpStatusError } from '../runtime/runtime.js'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
// The page built by `npm run build` from web/; its assets carry a content hash in their names.
const DIST_DIR = path.join(ROOT, 'dist')

/**
 * HTTP API, static frontend and the /api/ws WebSocket that pushes tile updates to browsers.
 * @param {import('../core.js').Homelabdash} core
 */
export function createServer (core) {
  const app = express()
  app.disable('x-powered-by')

  app.get('/api/health', (_req, res) => res.json(core.health()))
  app.use((req, res, next) => checkAuth(core, req) ? next() : deny(core, res))
  app.use(express.json({ limit: '256kb' }))
  app.use('/api', (req, res, next) => {
    if (req.method !== 'POST') return next()
    if (!sameOrigin(req)) return res.status(403).json({ error: 'cross-origin request refused' })
    if (!req.is('application/json')) return res.status(415).json({ error: 'send Content-Type: application/json' })
    next()
  })

  app.get('/api/dashboard', (_req, res) => res.json(core.dashboard()))
  app.get('/api/state', (_req, res) => res.json(core.runtime.snapshot()))
  app.get('/api/tiles/:id', (req, res) => {
    const st = core.runtime.tileStates.get(req.params.id)
    if (!st) return res.status(404).json({ error: `unknown tile "${req.params.id}"` })
    res.json(st)
  })
  app.post('/api/tiles/:id/refresh', async (req, res) => res.json(await core.runtime.refreshTile(req.params.id)))
  app.post('/api/tiles/:id/actions/:action', async (req, res) => {
    res.json(await core.runtime.runAction(req.params.id, req.params.action, req.body?.input ?? {}))
  })
  app.post('/api/sources/:id/jobs/:job/run', async (req, res) => res.json(await core.runtime.runJobNow(req.params.id, req.params.job)))
  app.post('/api/reload', async (_req, res) => res.json(await core.reloadConfig()))
  app.get('/api/plugins', (_req, res) => res.json(core.plugins()))
  app.get('/api/debug', (req, res) => res.json(core.debugInfo({ source: str(req.query.source), data: req.query.data === '1' })))

  app.get('/icons/:set/:file', async (req, res) => {
    const { set, file } = req.params
    const m = /^(.+)\.(svg|png|webp)$/.exec(file)
    if (set === 'local') {
      const icon = core.icons.localIcon(file)
      if (icon) return res.sendFile(icon.file, { maxAge: '1h', dotfiles: 'allow' })
      const name = file.replace(/\.[a-z]+$/i, '').toLowerCase()
      const ext = (/\.(svg|png|webp)$/i.exec(file)?.[1] ?? 'png').toLowerCase()
      return res.redirect(302, `/icons/di/${encodeURIComponent(name)}.${ext}`)
    }
    if (!m) return res.status(404).end()
    if (set === 'di') {
      const icon = await core.icons.dashboardIcon(m[1], m[2])
      return icon ? res.sendFile(icon.file, { maxAge: '7d', dotfiles: 'allow' }) : res.status(404).end()
    }
    const svg = core.icons.svg(set, m[1], str(req.query.color))
    if (!svg) return res.status(404).end()
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=604800').send(svg)
  })

  app.get(['/custom.css', '/custom.js'], (req, res) => {
    const file = path.join(core.configDir, path.basename(req.path))
    res.set('Cache-Control', 'no-cache')
    if (fs.existsSync(file)) return res.sendFile(file, { dotfiles: 'allow' })
    res.type(req.path.endsWith('.css') ? 'text/css' : 'text/javascript').send('')
  })
  app.get('/plugins/:id/widget.js', (req, res) => {
    const entry = core.registry.get(req.params.id)
    if (!entry?.widget) return res.status(404).end()
    res.set('Cache-Control', 'no-cache').sendFile(path.join(entry.dir, 'widget.js'), { dotfiles: 'allow' })
  })

  app.use('/assets', express.static(path.join(DIST_DIR, 'assets'), { immutable: true, maxAge: '1y', index: false }))
  app.use(express.static(DIST_DIR, { index: 'index.html', setHeaders: res => res.set('Cache-Control', 'no-cache') }))
  app.get('/', (_req, res) => res.status(503).type('text').send('The page is not built: run `npm run build` (npm install does it once).'))

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }))
  app.use((/** @type {any} */ err, /** @type {express.Request} */ _req, /** @type {express.Response} */ res, /** @type {express.NextFunction} */ _next) => {
    const status = err instanceof HttpStatusError ? err.status : err.status ?? 500
    if (status >= 500 && !(err instanceof HttpStatusError)) core.log.error(err.stack ?? String(err))
    res.status(status).json({ error: err.message })
  })

  const server = http.createServer(app)
  const hub = createHub(core)
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/api/ws') return socket.destroy()
    if (!sameOrigin(req) || !checkAuth(core, req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      return socket.destroy()
    }
    hub.wss.handleUpgrade(req, socket, head, ws => hub.wss.emit('connection', ws, req))
  })
  server.on('close', () => hub.close())
  return { app, server, hub }
}

/**
 * @param {import('../core.js').Homelabdash} core
 */
function createHub (core) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 })
  /** @type {Map<string, any>} */
  let pending = new Map()
  /** @type {NodeJS.Timeout | null} */
  let flushTimer = null
  const alive = new WeakSet()

  /** @param {any} msg */
  const broadcast = (msg) => {
    const text = JSON.stringify(msg)
    for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(text)
  }
  const flush = () => {
    flushTimer = null
    if (!pending.size) return
    const tiles = [...pending.values()]
    pending = new Map()
    broadcast({ type: 'tiles', tiles })
  }
  core.runtime.on('tile', (st) => {
    pending.set(st.id, st)
    flushTimer ??= setTimeout(flush, 40)
  })
  const updateActive = () => core.runtime.setActive(wss.clients.size > 0)

  wss.on('connection', (ws) => {
    alive.add(ws)
    ws.on('pong', () => alive.add(ws))
    const graphed = Object.values(core.config?.tiles ?? {}).filter(t => t.graph).map(t => t.id)
    ws.send(JSON.stringify({ type: 'hello', version: core.version, tiles: core.runtime.snapshot(), history: core.runtime.history.dump(graphed), configErrors: core.configErrors }))
    updateActive()
    ws.on('close', updateActive)
    ws.on('message', async (raw) => {
      /** @type {any} */
      let msg
      try { msg = JSON.parse(String(raw)) } catch { return }
      const reply = (/** @type {any} */ body) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: 'result', id: msg.id, ...body }))
      try {
        if (msg.type === 'action') reply({ ok: true, value: await core.runtime.runAction(String(msg.tile), String(msg.action), msg.input ?? {}) })
        else if (msg.type === 'refresh') reply({ ok: true, value: await core.runtime.refreshTile(String(msg.tile)) })
        else if (msg.type === 'ping') reply({ ok: true, value: 'pong' })
      } catch (err) {
        reply({ ok: false, error: /** @type {Error} */ (err).message })
      }
    })
  })

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) { ws.terminate(); continue }
      alive.delete(ws)
      ws.ping()
    }
  }, 30_000)
  heartbeat.unref()

  return {
    wss,
    broadcast,
    get clients () { return wss.clients.size },
    close () {
      clearInterval(heartbeat)
      for (const ws of wss.clients) ws.terminate()
      wss.close()
    }
  }
}

/** @param {Pick<http.IncomingMessage, 'headers'>} req */
export function sameOrigin (req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const o = new URL(origin)
    const forwarded = String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim()
    return [req.headers.host, forwarded].some(h => {
      if (!h) return false
      const u = new URL(`${o.protocol}//${h}`)
      // nginx forwards Host as $host, without the port, so a portless Host matches on the hostname.
      return u.host === o.host || (!u.port && u.hostname === o.hostname)
    })
  } catch {
    return false
  }
}

/** @param {import('../core.js').Homelabdash} core @param {http.IncomingMessage} req */
function checkAuth (core, req) {
  const auth = core.config?.settings.auth ?? core.lastAuth
  if (!auth || auth.type === 'none') return true
  if (auth.type === 'header') return !!req.headers[auth.header.toLowerCase()]
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '')
  if (!m) return false
  const given = Buffer.from(m[1], 'base64')
  const want = Buffer.from(`${auth.username}:${auth.password}`)
  return given.length === want.length && crypto.timingSafeEqual(given, want)
}

/** @param {import('../core.js').Homelabdash} core @param {express.Response} res */
function deny (core, res) {
  const auth = core.config?.settings.auth ?? core.lastAuth
  if (auth?.type === 'basic') res.set('WWW-Authenticate', 'Basic realm="homelabdash", charset="UTF-8"')
  res.status(401).json({ error: 'authentication required' })
}

/** @param {unknown} v */
function str (v) {
  return typeof v === 'string' ? v : undefined
}
