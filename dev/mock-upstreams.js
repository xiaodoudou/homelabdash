// Serves every builtin plugin's fixtures so the example config runs with no real services:
//   HTTP  http://127.0.0.1:4100/<plugin>/<fixture path>   (GET/POST fixtures, STREAM fixtures kept open)
//   SSH   127.0.0.1:4122, any user/password, answers "SSH <command>" fixtures; "lines" fixtures repeat slowly
//   TCP   127.0.0.1:4135, answers apcupsd's status fixture
// Docker containers change state every 20s, and CPU, memory, traffic, connections and stream bandwidth move, so graphs and live updates are visible.
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ssh2 from 'ssh2'
import { loadFixtures, findFixture } from '../src/plugins/io.js'

const PLUGINS = fileURLToPath(new URL('../plugins/', import.meta.url))

/** @param {{ httpPort?: number, sshPort?: number, tcpPort?: number, quiet?: boolean, hostKeyFile?: string }} [o] */
export async function startMocks (o = {}) {
  /** @type {Record<string, Record<string, any>>} */
  const fixtures = {}
  for (const id of fs.readdirSync(PLUGINS)) fixtures[id] = loadFixtures(path.join(PLUGINS, id))

  const containers = structuredClone(fixtures.docker['GET /containers/json'].body)
  /** @type {Set<http.ServerResponse>} */
  const eventStreams = new Set()
  const flip = setInterval(() => {
    const c = containers.find((/** @type {any} */ x) => x.Names[0] === '/backup')
    const running = c.State === 'running'
    c.State = running ? 'exited' : 'running'
    c.Status = running ? 'Exited (1) 1 second ago' : 'Up 1 second'
    const line = JSON.stringify({ Type: 'container', Action: running ? 'die' : 'start', Actor: { Attributes: { name: 'backup' } }, time: Math.floor(Date.now() / 1000) }) + '\n'
    for (const res of eventStreams) res.write(line)
  }, 20_000)

  /** @param {number} base @param {number} spread */
  const jitter = (base, spread) => Math.round((base + (Math.random() - 0.5) * spread) * 10) / 10
  // WAN byte counters that keep growing, so the router's rates are never flat
  const wan = { rx: 512e9, tx: 64e9, at: Date.now() }
  const grow = () => {
    const s = (Date.now() - wan.at) / 1000
    wan.at = Date.now()
    wan.rx += Math.round(s * Math.max(0, jitter(3e6, 5e6)))
    wan.tx += Math.round(s * Math.max(0, jitter(6e5, 1e6)))
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://mock')
    const [, plugin, ...rest] = u.pathname.split('/')
    // /arr/sonarr/... is a second arr instance with its own numbers, so a Radarr and a Sonarr tile differ
    const second = plugin === 'arr' && rest[0] === 'sonarr'
    const sub = '/' + rest.slice(second ? 1 : 0).join('/')
    let body = ''
    for await (const chunk of req) body += chunk
    /** @type {string | undefined} */
    let operationName
    try { operationName = JSON.parse(body).operationName } catch {}
    const fx = fixtures[plugin]
    if (!fx) return send(res, 404, { error: `no plugin ${plugin}` })

    if (plugin === 'docker' && sub === '/containers/json') return send(res, 200, containers)
    if (plugin === 'docker' && sub === '/events') {
      res.writeHead(200, { 'content-type': 'application/json' })
      eventStreams.add(res)
      req.on('close', () => eventStreams.delete(res))
      return
    }
    // A STREAM fixture stays open and sends one line a second, its numbers moving like live traffic
    const stream = req.method === 'GET' && fx[`STREAM ${sub}`]
    if (stream) {
      res.writeHead(200, { 'content-type': 'application/json' })
      const [base] = stream.lines
      const tick = setInterval(() => {
        const line = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, typeof v === 'number' && !/Total$/.test(k) ? Math.max(0, Math.round(jitter(v, v * 1.6))) : v]))
        res.write(JSON.stringify(line) + '\n')
      }, 1000)
      req.on('close', () => clearInterval(tick))
      return
    }
    try {
      const f = findFixture(fx, /** @type {string} */ (req.method), `http://mock${sub}${u.search}`, { operationName })
      let out = f.body
      if (plugin === 'glances' && sub.endsWith('/cpu')) out = { ...out, total: jitter(25, 30) }
      if (plugin === 'glances' && sub.endsWith('/gpu')) out = out.map((/** @type {any} */ g) => ({ ...g, proc: Math.max(0, jitter(40, 60)), temperature: jitter(75, 20) }))
      if (plugin === 'glances' && sub.endsWith('/mem')) out = { ...out, percent: jitter(40, 6) }
      if (plugin === 'unraid' && operationName === 'Dashboard') {
        out = structuredClone(out)
        out.data.metrics.cpu.percentTotal = Math.max(1, jitter(12, 16))
        out.data.metrics.memory.percentTotal = jitter(26, 3)
      }
      if (plugin === 'openwrt' && u.search.includes('network.device.status')) {
        grow()
        out = structuredClone(out)
        Object.assign(out.result[1].statistics, { rx_bytes: wan.rx, tx_bytes: wan.tx })
      }
      if (plugin === 'openwrt' && u.search.includes('nf_conntrack_count')) out = { ...out, result: [0, { data: `${Math.round(jitter(3200, 900))}\n` }] }
      if (second) out = JSON.parse(JSON.stringify(out).replaceAll('Radarr', 'Sonarr'))
      if (second && sub.includes('/wanted/missing')) out = { ...out, totalRecords: 317 }
      if (plugin === 'tautulli') {
        out = structuredClone(out)
        out.response.data.total_bandwidth = Math.round(Math.max(2000, jitter(15000, 9000)))
      }
      send(res, f.status ?? 200, out, f.headers)
    } catch (err) {
      send(res, 404, { error: /** @type {Error} */ (err).message })
    }
  })

  // A stable key in dev, so the dashboard's host key pinning does not refuse the next run.
  let hostKey
  if (o.hostKeyFile && fs.existsSync(o.hostKeyFile)) {
    hostKey = fs.readFileSync(o.hostKeyFile, 'utf8')
  } else {
    hostKey = ssh2.utils.generateKeyPairSync('ed25519').private
    if (o.hostKeyFile) {
      fs.mkdirSync(path.dirname(o.hostKeyFile), { recursive: true })
      fs.writeFileSync(o.hostKeyFile, hostKey)
    }
  }
  /** @type {Set<NodeJS.Timeout>} */
  const ticks = new Set()
  // Every plugin that runs commands over SSH (ssh, nvidia) is answered by this one server.
  const sshFixtures = Object.assign({}, ...Object.values(fixtures))
  const sshServer = new ssh2.Server({ hostKeys: [hostKey] }, client => {
    client.on('authentication', ctx => ctx.accept())
    client.on('ready', () => {
      client.on('session', accept => {
        const session = accept()
        session.on('exec', (acceptExec, _reject, info) => {
          const stream = acceptExec()
          let f
          try {
            f = findFixture(sshFixtures, 'SSH', info.command)
          } catch (err) {
            stream.stderr.write(/** @type {Error} */ (err).message + '\n')
            stream.exit(127)
            return stream.end()
          }
          if (f.lines) {
            let i = 0
            const tick = () => {
              if (stream.destroyed) return clearInterval(timer)
              stream.write(`${new Date().toISOString()} ${f.lines[i++ % f.lines.length].replace(/^\w{3} \w{3}\s+\d+ [\d:]+ \d{4} /, '')}\n`)
            }
            const timer = setInterval(tick, 2500)
            ticks.add(timer)
            tick()
            // A client that drops without closing the channel never fires 'close'; the connection end does.
            const stop = () => { clearInterval(timer); ticks.delete(timer) }
            stream.on('close', stop)
            client.on('close', stop)
            return
          }
          stream.write(f.stdout ?? '')
          if (f.stderr) stream.stderr.write(f.stderr)
          stream.exit(f.code ?? 0)
          stream.end()
        })
      })
    })
    client.on('error', () => {})
  })

  // apcupsd has its own framing over TCP; the fixture holds the server's whole reply, sent back to any request
  const ups = Object.entries(fixtures.apcupsd ?? {}).find(([k]) => k.startsWith('TCP '))?.[1]
  const tcpServer = net.createServer(socket => {
    socket.on('data', () => socket.end(Buffer.from(ups?.base64 ?? '', 'base64')))
    socket.on('error', () => {})
  })

  await new Promise(resolve => server.listen(o.httpPort ?? 4100, '127.0.0.1', () => resolve(undefined)))
  await new Promise(resolve => sshServer.listen(o.sshPort ?? 4122, '127.0.0.1', () => resolve(undefined)))
  await new Promise(resolve => tcpServer.listen(o.tcpPort ?? (o.httpPort === 0 ? 0 : 4135), '127.0.0.1', () => resolve(undefined)))
  const httpPort = /** @type {any} */ (server.address()).port
  const sshPort = /** @type {any} */ (sshServer.address()).port
  const tcpPort = /** @type {any} */ (tcpServer.address()).port
  if (!o.quiet) console.log(`mock upstreams: http://127.0.0.1:${httpPort}/<plugin>/..., ssh 127.0.0.1:${sshPort}, apcupsd 127.0.0.1:${tcpPort}`)
  return {
    httpPort,
    sshPort,
    tcpPort,
    async close () {
      clearInterval(flip)
      for (const t of ticks) clearInterval(t)
      for (const r of eventStreams) r.end()
      server.closeAllConnections()
      await new Promise(resolve => server.close(() => resolve(undefined)))
      await new Promise(resolve => sshServer.close(() => resolve(undefined)))
      await new Promise(resolve => tcpServer.close(() => resolve(undefined)))
    }
  }
}

/** @param {http.ServerResponse} res @param {number} status @param {unknown} body @param {Record<string, string>} [headers] */
function send (res, status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json', ...headers })
  res.end(text)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await startMocks({ hostKeyFile: '.dev-data/mock-ssh-host-key' })
}
