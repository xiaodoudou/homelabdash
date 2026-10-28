import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import { execFile, spawn } from 'node:child_process'
import WebSocket from 'ws'
import ssh2 from 'ssh2'
import { writeFileAtomic } from '../util.js'

/**
 * Network helpers handed to plugins as ctx.http, ctx.ws, ctx.ssh, ctx.tcp, ctx.ping, ctx.dns, ctx.exec.
 * With `fixtures`, every helper answers from recorded data instead of the network.
 *
 * @typedef {object} IOOptions
 * @property {Record<string, any> | null} [fixtures]
 * @property {((key: string, entry: any) => void) | null} [onCapture]
 * @property {string} [dataDir] where ssh host keys are pinned
 * @property {string} [configDir] base for relative privateKeyPath
 * @property {(level: string, msg: string) => void} [log]
 */

export class HttpError extends Error {
  /** @param {string} message @param {number} status @param {unknown} body */
  constructor (message, status, body) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.body = body
  }
}

export class FixtureMissingError extends Error {
  /** @param {string} key */
  constructor (key) {
    super(`no fixture for "${key}": add it to the plugin's fixtures/*.json`)
    this.name = 'FixtureMissingError'
  }
}

/**
 * @param {string} pluginDir
 * @returns {Record<string, any>}
 */
export function loadFixtures (pluginDir) {
  const dir = path.join(pluginDir, 'fixtures')
  if (!fs.existsSync(dir)) return {}
  /** @type {Record<string, any>} */
  const out = {}
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    Object.assign(out, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
  }
  return out
}

/** Calls answered so far per fixture list, so `[first, second, ...]` replays in order (the last one repeats). */
const served = new WeakMap()

/** @param {any} entry */
function nextOf (entry) {
  if (!Array.isArray(entry)) return entry
  const i = served.get(entry) ?? 0
  served.set(entry, i + 1)
  return entry[Math.min(i, entry.length - 1)]
}

/**
 * @param {Record<string, any>} fixtures
 * @param {string} kind e.g. "GET", "WS", "SSH"
 * @param {string} target URL, command, host...
 * @param {{ operationName?: string }} [extra]
 */
export function findFixture (fixtures, kind, target, extra = {}) {
  return nextOf(matchFixture(fixtures, kind, target, extra))
}

/**
 * @param {Record<string, any>} fixtures
 * @param {string} kind
 * @param {string} target
 * @param {{ operationName?: string }} extra
 */
function matchFixture (fixtures, kind, target, extra) {
  if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|WS|STREAM)$/.test(kind)) {
    const key = `${kind} ${target}`
    if (key in fixtures) return fixtures[key]
    throw new FixtureMissingError(key)
  }
  let reqPath = target
  let reqQuery = new URLSearchParams()
  try {
    const u = new URL(target)
    reqPath = u.pathname
    reqQuery = u.searchParams
  } catch {}
  let best = null
  let bestLen = -1
  for (const key of Object.keys(fixtures)) {
    const m = /^(\S+)\s+([^?#]*)(?:\?([^#]*))?(?:#(.+))?$/.exec(key)
    if (!m || m[1] !== kind) continue
    const [, , fPath, fQuery, fOp] = m
    if (!reqPath.endsWith(fPath)) continue
    if (fOp && fOp !== extra.operationName) continue
    if (fQuery && [...new URLSearchParams(fQuery)].some(([k, v]) => reqQuery.get(k) !== v)) continue
    const len = fPath.length + (fQuery ? fQuery.length : 0) + (fOp ? 1000 : 0)
    if (len > bestLen) { best = fixtures[key]; bestLen = len }
  }
  if (best === null) throw new FixtureMissingError(`${kind} ${reqPath}${extra.operationName ? '#' + extra.operationName : ''}`)
  return best
}

/** @param {IOOptions} opts */
export function createIO (opts = {}) {
  const fixtures = opts.fixtures ?? null
  const log = opts.log ?? (() => {})
  const sshPool = new SshPool(opts, log)

  /**
   * @param {AbortSignal} [defaultSignal]
   */
  return function bind (defaultSignal) {
    return {
      http: createHttp(fixtures, opts.onCapture ?? null, defaultSignal),
      ws: createWs(fixtures, defaultSignal),
      ssh: createSsh(fixtures, sshPool, defaultSignal),
      tcp: createTcp(fixtures),
      ping: createPing(fixtures),
      dns: createDns(fixtures),
      exec: createExec(fixtures, defaultSignal)
    }
  }
}

/** @param {AbortSignal | undefined} a @param {AbortSignal | undefined} b */
function anySignal (a, b) {
  const list = /** @type {AbortSignal[]} */ ([a, b].filter(Boolean))
  return list.length > 1 ? AbortSignal.any(list) : list[0]
}

/** @param {string} url */
function safeUrl (url) {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    return url
  }
}

/** @param {string} text */
function parseAuto (text) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * @param {Record<string, any> | null} fixtures
 * @param {((key: string, entry: any) => void) | null} onCapture
 * @param {AbortSignal} [defaultSignal]
 */
function createHttp (fixtures, onCapture, defaultSignal) {
  /**
   * @param {string} url
   * @param {import('../../sdk/index.js').HttpOptions} [o]
   * @returns {Promise<import('../../sdk/index.js').HttpResponse>}
   */
  async function request (url, o = {}) {
    const method = (o.method ?? (o.json !== undefined || o.form ? 'POST' : 'GET')).toUpperCase()
    const u = new URL(url)
    for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined && v !== null) u.searchParams.set(k, String(v))
    /** @type {Record<string, string>} */
    const headers = {}
    for (const [k, v] of Object.entries(o.headers ?? {})) headers[k.toLowerCase()] = String(v)
    let body = o.body
    if (o.json !== undefined) {
      body = JSON.stringify(o.json)
      headers['content-type'] ??= 'application/json'
    } else if (o.form) {
      body = new URLSearchParams(o.form).toString()
      headers['content-type'] ??= 'application/x-www-form-urlencoded'
    }
    if (o.auth?.bearer) headers.authorization = `Bearer ${o.auth.bearer}`
    if (o.auth?.basic) headers.authorization = 'Basic ' + Buffer.from(`${o.auth.basic.username}:${o.auth.basic.password}`).toString('base64')
    if (o.auth?.header) headers[o.auth.header.toLowerCase()] = String(o.auth.value)
    const parse = o.parse ?? 'auto'
    const target = u.toString()

    if (fixtures) {
      const operationName = o.json && typeof o.json === 'object' ? /** @type {any} */ (o.json).operationName : undefined
      const f = findFixture(fixtures, method, target, { operationName })
      const status = f.status ?? 200
      // A fixture body is the decoded value; only `parse: 'text'` turns it back into a string.
      const text = typeof f.body === 'string' ? f.body : JSON.stringify(f.body ?? null)
      const res = { status, ok: status < 400, headers: lower(f.headers ?? {}), body: parse === 'text' ? text : f.body, url: target }
      if (!res.ok && o.throwOnError !== false) throw new HttpError(`${method} ${safeUrl(target)} returned ${status}`, status, res.body)
      return res
    }

    const retries = o.retries ?? (method === 'GET' ? 1 : 0)
    const timeout = o.timeout ?? 10_000
    let lastErr
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, 300 * attempt))
      const signal = anySignal(anySignal(o.signal, defaultSignal), AbortSignal.timeout(timeout))
      try {
        const r = o.socketPath
          ? await unixRequest(o.socketPath, u, method, headers, body, signal)
          : await fetchRequest(target, method, headers, body, signal, o.insecure)
        const ct = r.headers['content-type'] ?? ''
        const value = parse === 'text' ? r.text : parse === 'json' ? JSON.parse(r.text || 'null') : (ct.includes('json') ? parseAuto(r.text) : r.text)
        const res = { status: r.status, ok: r.status < 400, headers: r.headers, body: value, url: target }
        if (onCapture) {
          const operationName = o.json && typeof o.json === 'object' ? /** @type {any} */ (o.json).operationName : undefined
          onCapture(`${method} ${u.pathname}${operationName ? '#' + operationName : ''}`, { status: r.status, headers: ct ? { 'content-type': ct } : undefined, body: value })
        }
        if (r.status >= 500 && attempt < retries) { lastErr = new HttpError(`${method} ${safeUrl(target)} returned ${r.status}`, r.status, value); continue }
        if (!res.ok && o.throwOnError !== false) {
          const excerpt = typeof value === 'string' ? value.slice(0, 200) : JSON.stringify(value)?.slice(0, 200)
          throw new HttpError(`${method} ${safeUrl(target)} returned ${r.status}${excerpt ? ': ' + excerpt : ''}`, r.status, value)
        }
        return res
      } catch (err) {
        if (err instanceof HttpError) throw err
        lastErr = err
        if (signal?.aborted && !(defaultSignal?.aborted || o.signal?.aborted)) {
          lastErr = new Error(`${method} ${safeUrl(target)} timed out after ${timeout}ms`)
        }
        if (defaultSignal?.aborted || o.signal?.aborted) break
      }
    }
    const cause = /** @type {any} */ (lastErr)?.cause?.code ?? /** @type {any} */ (lastErr)?.code
    throw new Error(`${method} ${safeUrl(target)} failed: ${/** @type {Error} */ (lastErr)?.message ?? lastErr}${cause ? ` (${cause})` : ''}`)
  }

  return {
    request,
    /** @param {string} url @param {import('../../sdk/index.js').HttpOptions} [o] */
    json: async (url, o = {}) => (await request(url, { ...o, parse: 'json' })).body,
    /** @param {string} url @param {import('../../sdk/index.js').HttpOptions} [o] */
    text: async (url, o = {}) => (await request(url, { ...o, parse: 'text' })).body,
    /**
     * Yields one item per line of a streamed response (JSON-parsed when possible).
     * @param {string} url
     * @param {import('../../sdk/index.js').HttpOptions} [o]
     */
    async * stream (url, o = {}) {
      const u = new URL(url)
      for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined && v !== null) u.searchParams.set(k, String(v))
      if (fixtures) {
        const f = findFixture(fixtures, 'STREAM', u.toString())
        for (const line of f.lines ?? []) yield line
        return
      }
      /** @type {Record<string, string>} */
      const headers = {}
      for (const [k, v] of Object.entries(o.headers ?? {})) headers[k.toLowerCase()] = String(v)
      if (o.auth?.bearer) headers.authorization = `Bearer ${o.auth.bearer}`
      if (o.auth?.basic) headers.authorization = 'Basic ' + Buffer.from(`${o.auth.basic.username}:${o.auth.basic.password}`).toString('base64')
      if (o.auth?.header) headers[o.auth.header.toLowerCase()] = String(o.auth.value)
      const signal = anySignal(o.signal, defaultSignal)
      const chunks = o.socketPath ? unixStream(o.socketPath, u, headers, signal) : fetchStream(u.toString(), headers, signal)
      let buf = ''
      for await (const chunk of chunks) {
        buf += chunk
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim()
          buf = buf.slice(i + 1)
          if (line) yield o.parse === 'text' ? line : parseAuto(line)
        }
      }
      if (buf.trim()) yield o.parse === 'text' ? buf.trim() : parseAuto(buf.trim())
    }
  }
}

/** @param {Record<string, any>} h */
function lower (h) {
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v)]))
}

/**
 * @param {string} url @param {string} method @param {Record<string,string>} headers
 * @param {any} body @param {AbortSignal | undefined} signal @param {boolean} [insecure]
 */
async function fetchRequest (url, method, headers, body, signal, insecure) {
  if (insecure && url.startsWith('https:')) {
    return await nodeRequest(url, method, headers, body, signal, true)
  }
  const r = await fetch(url, { method, headers, body, signal, redirect: 'follow' })
  const text = await r.text()
  return { status: r.status, headers: Object.fromEntries(r.headers), text }
}

/**
 * node:https with certificate checks off, for self-signed homelab services.
 * @param {string} url @param {string} method @param {Record<string,string>} headers
 * @param {any} body @param {AbortSignal | undefined} signal @param {boolean} insecure
 * @returns {Promise<{ status: number, headers: Record<string, string>, text: string }>}
 */
async function nodeRequest (url, method, headers, body, signal, insecure) {
  const https = await import('node:https')
  return await new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, signal, rejectUnauthorized: !insecure }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', d => { text += d })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: flatHeaders(res.headers), text }))
      res.on('error', reject)
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

/** @param {import('node:http').IncomingHttpHeaders} h @returns {Record<string, string>} */
function flatHeaders (h) {
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v ?? '')]))
}

/**
 * @param {string} socketPath @param {URL} u @param {string} method
 * @param {Record<string,string>} headers @param {any} body @param {AbortSignal | undefined} signal
 * @returns {Promise<{ status: number, headers: Record<string, string>, text: string }>}
 */
function unixRequest (socketPath, u, method, headers, body, signal) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: u.pathname + u.search, method, headers: { host: 'localhost', ...headers }, signal }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', d => { text += d })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: flatHeaders(res.headers), text }))
      res.on('error', reject)
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

/** @param {string} url @param {Record<string,string>} headers @param {AbortSignal | undefined} signal */
async function * fetchStream (url, headers, signal) {
  const r = await fetch(url, { headers, signal })
  if (!r.ok || !r.body) throw new HttpError(`GET ${safeUrl(url)} returned ${r.status}`, r.status, await r.text())
  const decoder = new TextDecoder()
  for await (const chunk of /** @type {AsyncIterable<Uint8Array>} */ (/** @type {unknown} */ (r.body))) yield decoder.decode(chunk, { stream: true })
}

/** @param {string} socketPath @param {URL} u @param {Record<string,string>} headers @param {AbortSignal | undefined} signal */
async function * unixStream (socketPath, u, headers, signal) {
  /** @type {import('node:http').IncomingMessage} */
  const res = await new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: u.pathname + u.search, headers: { host: 'localhost', ...headers }, signal }, resolve)
    req.on('error', reject)
    req.end()
  })
  if ((res.statusCode ?? 0) >= 400) throw new HttpError(`GET ${u.pathname} returned ${res.statusCode}`, res.statusCode ?? 0, null)
  res.setEncoding('utf8')
  for await (const chunk of res) yield chunk
}

/** @param {Record<string, any> | null} fixtures @param {AbortSignal} [defaultSignal] */
function createWs (fixtures, defaultSignal) {
  return {
    /**
     * Opens a WebSocket. Iterate it with `for await` to read messages (JSON-parsed when possible); the loop ends when the socket closes.
     * @param {string} url
     * @param {{ headers?: Record<string, string>, protocols?: string[], signal?: AbortSignal, parse?: 'auto'|'text', insecure?: boolean }} [o]
     */
    connect (url, o = {}) {
      if (fixtures) {
        const f = findFixture(fixtures, 'WS', url)
        const messages = [...(f.messages ?? [])]
        return {
          send () {},
          close () {},
          async * [Symbol.asyncIterator] () { for (const m of messages) yield m }
        }
      }
      const socket = new WebSocket(url, o.protocols, { headers: o.headers, rejectUnauthorized: !o.insecure })
      /** @type {any[]} */
      const queue = []
      /** @type {((v?: unknown) => void) | null} */
      let wake = null
      let done = false
      /** @type {Error | null} */
      let failure = null
      const signal = anySignal(o.signal, defaultSignal)
      const onAbort = () => socket.close()
      signal?.addEventListener('abort', onAbort, { once: true })
      socket.on('message', (data, isBinary) => {
        const text = isBinary ? data : data.toString()
        queue.push(o.parse === 'text' || isBinary ? text : parseAuto(/** @type {string} */ (text)))
        wake?.()
      })
      socket.on('close', () => { done = true; wake?.() })
      socket.on('error', err => { failure = err; done = true; wake?.() })
      const opened = new Promise((resolve, reject) => {
        socket.once('open', resolve)
        socket.once('error', reject)
      })
      opened.catch(() => {})
      return {
        opened,
        /** @param {unknown} data */
        async send (data) {
          await opened
          socket.send(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data))
        },
        close () { socket.close() },
        async * [Symbol.asyncIterator] () {
          try {
            while (true) {
              if (queue.length) { yield queue.shift(); continue }
              if (done) break
              await new Promise(resolve => { wake = resolve })
              wake = null
            }
            if (failure) throw failure
          } finally {
            signal?.removeEventListener('abort', onAbort)
            if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.terminate()
          }
        }
      }
    }
  }
}

/**
 * One SSH connection per host/user, shared by every command of a worker and closed after a minute idle.
 */
class SshPool {
  /** @param {IOOptions} opts @param {(level: string, msg: string) => void} log */
  constructor (opts, log) {
    this.opts = opts
    this.log = log
    /** @type {Map<string, { conn: Promise<import('ssh2').Client>, users: number, timer: NodeJS.Timeout | null }>} */
    this.entries = new Map()
  }

  /** @param {import('../../sdk/index.js').SshTarget} t */
  key (t) { return `${t.username}@${t.host}:${t.port ?? 22}` }

  /** @param {import('../../sdk/index.js').SshTarget} t */
  async acquire (t) {
    const key = this.key(t)
    let e = this.entries.get(key)
    if (!e) {
      e = { conn: this.connect(t, key), users: 0, timer: null }
      this.entries.set(key, e)
      e.conn.catch(() => this.entries.delete(key))
    }
    e.users++
    if (e.timer) { clearTimeout(e.timer); e.timer = null }
    const entry = e
    try {
      const conn = await e.conn
      return {
        conn,
        release: () => {
          entry.users--
          if (entry.users === 0) {
            entry.timer = setTimeout(() => {
              this.entries.delete(key)
              conn.end()
            }, 60_000)
            entry.timer.unref()
          }
        }
      }
    } catch (err) {
      entry.users--
      throw err
    }
  }

  /** @param {import('../../sdk/index.js').SshTarget} t @param {string} key @returns {Promise<import('ssh2').Client>} */
  connect (t, key) {
    const hostKey = `${t.host}:${t.port ?? 22}`
    const knownFile = this.opts.dataDir ? path.join(this.opts.dataDir, 'ssh_known_hosts.json') : null
    let privateKey = t.privateKey
    if (!privateKey && t.privateKeyPath) privateKey = fs.readFileSync(path.resolve(this.opts.configDir ?? '.', t.privateKeyPath), 'utf8')
    return new Promise((resolve, reject) => {
      const conn = new ssh2.Client()
      let hostError = ''
      conn.on('ready', () => resolve(conn))
      conn.on('error', err => reject(new Error(`ssh ${key}: ${hostError || err.message}`)))
      conn.on('close', () => this.entries.delete(key))
      conn.connect({
        host: t.host,
        port: t.port ?? 22,
        username: t.username,
        password: t.password,
        privateKey,
        passphrase: t.passphrase,
        readyTimeout: t.timeout ?? 10_000,
        keepaliveInterval: 15_000,
        hostVerifier: (/** @type {Buffer} */ keyBuf) => {
          const fp = 'SHA256:' + crypto.createHash('sha256').update(keyBuf).digest('base64').replace(/=+$/, '')
          if (t.hostFingerprint) {
            const want = t.hostFingerprint.startsWith('SHA256:') ? t.hostFingerprint : `SHA256:${t.hostFingerprint}`
            if (want.replace(/=+$/, '') !== fp) { hostError = `host key ${fp} does not match hostFingerprint`; return false }
            return true
          }
          if (!knownFile) return true
          /** @type {Record<string, string>} */
          let known = {}
          try { known = JSON.parse(fs.readFileSync(knownFile, 'utf8')) } catch {}
          if (!known[hostKey]) {
            known[hostKey] = fp
            writeFileAtomic(knownFile, JSON.stringify(known, null, 2))
            this.log('warn', `ssh ${hostKey}: trusting host key ${fp} on first use (pin it with hostFingerprint)`)
            return true
          }
          if (known[hostKey] !== fp) {
            hostError = `host key changed (expected ${known[hostKey]}, got ${fp}); if this is expected, remove ${hostKey} from ssh_known_hosts.json`
            return false
          }
          return true
        }
      })
    })
  }
}

/** @param {Record<string, any> | null} fixtures @param {SshPool} pool @param {AbortSignal} [defaultSignal] */
function createSsh (fixtures, pool, defaultSignal) {
  return {
    /**
     * Runs a command and waits for it to exit.
     * @param {import('../../sdk/index.js').SshTarget} target
     * @param {string} command
     * @param {{ timeout?: number, signal?: AbortSignal }} [o]
     * @returns {Promise<{ stdout: string, stderr: string, code: number | null }>}
     */
    async exec (target, command, o = {}) {
      if (fixtures) {
        const f = findFixture(fixtures, 'SSH', command)
        return { stdout: f.stdout ?? (f.lines ?? []).join('\n'), stderr: f.stderr ?? '', code: f.code ?? 0 }
      }
      const { conn, release } = await pool.acquire(target)
      const signal = anySignal(anySignal(o.signal, defaultSignal), o.timeout ? AbortSignal.timeout(o.timeout) : undefined)
      try {
        return await new Promise((resolve, reject) => {
          conn.exec(command, (err, stream) => {
            if (err) return reject(err)
            let stdout = ''
            let stderr = ''
            const onAbort = () => { stream.close(); reject(new Error(`ssh command aborted: ${command}`)) }
            signal?.addEventListener('abort', onAbort, { once: true })
            stream.on('data', (/** @type {Buffer} */ d) => { stdout += d })
            stream.stderr.on('data', (/** @type {Buffer} */ d) => { stderr += d })
            stream.on('close', (/** @type {number | null} */ code) => {
              signal?.removeEventListener('abort', onAbort)
              resolve({ stdout, stderr, code })
            })
          })
        })
      } finally {
        release()
      }
    },
    /**
     * Runs a long-lived command (e.g. `tail -F /var/log/syslog`) and yields stdout line by line until it exits or the signal aborts.
     * @param {import('../../sdk/index.js').SshTarget} target
     * @param {string} command
     * @param {{ signal?: AbortSignal }} [o]
     */
    async * lines (target, command, o = {}) {
      if (fixtures) {
        const f = findFixture(fixtures, 'SSH', command)
        for (const line of f.lines ?? String(f.stdout ?? '').split('\n').filter(Boolean)) yield line
        return
      }
      const { conn, release } = await pool.acquire(target)
      const signal = anySignal(o.signal, defaultSignal)
      try {
        /** @type {import('ssh2').ClientChannel} */
        const stream = await new Promise((resolve, reject) => conn.exec(command, (err, s) => err ? reject(err) : resolve(s)))
        const onAbort = () => stream.close()
        signal?.addEventListener('abort', onAbort, { once: true })
        stream.setEncoding('utf8')
        let buf = ''
        try {
          for await (const chunk of stream) {
            buf += chunk
            let i
            while ((i = buf.indexOf('\n')) >= 0) {
              yield buf.slice(0, i).replace(/\r$/, '')
              buf = buf.slice(i + 1)
            }
          }
          if (buf) yield buf
        } finally {
          signal?.removeEventListener('abort', onAbort)
          stream.close()
        }
      } finally {
        release()
      }
    }
  }
}

/** @param {Record<string, any> | null} fixtures */
function createTcp (fixtures) {
  return {
    /**
     * Checks that a TCP port accepts connections.
     * @param {string} host @param {number} port @param {{ timeout?: number }} [o]
     * @returns {Promise<{ ok: boolean, ms: number, error?: string }>}
     */
    check (host, port, o = {}) {
      if (fixtures) return Promise.resolve(findFixture(fixtures, 'TCP', `${host}:${port}`))
      const started = performance.now()
      return new Promise(resolve => {
        const socket = net.connect({ host, port, timeout: o.timeout ?? 3000 })
        const done = (/** @type {string} */ error) => {
          socket.destroy()
          resolve(error ? { ok: false, ms: Math.round(performance.now() - started), error } : { ok: true, ms: Math.round(performance.now() - started) })
        }
        socket.once('connect', () => done(''))
        socket.once('timeout', () => done('timeout'))
        socket.once('error', err => done(/** @type {any} */ (err).code ?? err.message))
      })
    },
    /**
     * Sends bytes and collects the reply until the peer closes, `until` matches, or the timeout hits.
     * @param {string} host @param {number} port @param {string | Buffer} payload
     * @param {{ timeout?: number, until?: string | RegExp, maxBytes?: number }} [o]
     * @returns {Promise<Buffer>}
     */
    request (host, port, payload, o = {}) {
      if (fixtures) {
        const f = findFixture(fixtures, 'TCP', `${host}:${port}`)
        return Promise.resolve(f.base64 ? Buffer.from(f.base64, 'base64') : Buffer.from(f.response ?? ''))
      }
      return new Promise((resolve, reject) => {
        /** @type {Buffer[]} */
        const chunks = []
        let size = 0
        const socket = net.connect({ host, port, timeout: o.timeout ?? 5000 }, () => socket.write(payload))
        const finish = () => { socket.destroy(); resolve(Buffer.concat(chunks)) }
        socket.on('data', d => {
          const b = typeof d === 'string' ? Buffer.from(d) : d
          chunks.push(b)
          size += b.length
          const text = o.until ? Buffer.concat(chunks).toString('latin1') : ''
          if ((o.maxBytes && size >= o.maxBytes) || (typeof o.until === 'string' && text.includes(o.until)) || (o.until instanceof RegExp && o.until.test(text))) finish()
        })
        socket.on('end', finish)
        socket.on('timeout', () => chunks.length ? finish() : (socket.destroy(), reject(new Error(`tcp ${host}:${port} timed out`))))
        socket.on('error', err => reject(new Error(`tcp ${host}:${port}: ${/** @type {any} */ (err).code ?? err.message}`)))
      })
    }
  }
}

/** @param {Record<string, any> | null} fixtures */
function createPing (fixtures) {
  /**
   * ICMP ping through the system `ping` binary.
   * @param {string} host @param {{ timeout?: number }} [o]
   * @returns {Promise<{ ok: boolean, ms: number | null }>}
   */
  return function ping (host, o = {}) {
    if (fixtures) return Promise.resolve(findFixture(fixtures, 'PING', host))
    if (!/^[A-Za-z0-9.:_-]+$/.test(host)) return Promise.reject(new Error(`invalid host "${host}"`))
    const timeout = o.timeout ?? 2000
    const args = process.platform === 'win32'
      ? ['-n', '1', '-w', String(timeout), host]
      : ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeout / 1000))), host]
    return new Promise(resolve => {
      execFile('ping', args, { timeout: timeout + 1000 }, (err, stdout) => {
        const m = /time[=<]\s*([\d.]+)\s*ms/i.exec(stdout ?? '')
        resolve({ ok: !err && !!m, ms: m ? Number(m[1]) : null })
      })
    })
  }
}

/** @param {Record<string, any> | null} fixtures */
function createDns (fixtures) {
  return {
    /** @param {string} name @param {string} [type] */
    resolve: async (name, type = 'A') => fixtures ? findFixture(fixtures, 'DNS', `${type} ${name}`) : await dns.resolve(name, /** @type {any} */ (type)),
    /** @param {string} ip */
    reverse: async (ip) => fixtures ? findFixture(fixtures, 'DNS', `PTR ${ip}`) : await dns.reverse(ip)
  }
}

/** @param {Record<string, any> | null} fixtures @param {AbortSignal} [defaultSignal] */
function createExec (fixtures, defaultSignal) {
  /**
   * Runs a local program inside the container (no shell).
   * @param {string} command @param {string[]} [args]
   * @param {{ timeout?: number, cwd?: string, env?: Record<string, string>, input?: string }} [o]
   * @returns {Promise<{ stdout: string, stderr: string, code: number | null }>}
   */
  return function exec (command, args = [], o = {}) {
    if (fixtures) {
      const f = findFixture(fixtures, 'EXEC', [command, ...args].join(' '))
      return Promise.resolve({ stdout: f.stdout ?? '', stderr: f.stderr ?? '', code: f.code ?? 0 })
    }
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: o.cwd, env: o.env ? { ...process.env, ...o.env } : process.env, signal: defaultSignal, timeout: o.timeout ?? 30_000 })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', d => { stdout += d })
      child.stderr.on('data', d => { stderr += d })
      child.on('error', reject)
      child.on('close', code => resolve({ stdout, stderr, code }))
      if (o.input) child.stdin.end(o.input)
      else child.stdin.end()
    })
  }
}
