#!/usr/bin/env node
// npm run docs:screenshots: the pictures in docs/ui/, taken from examples/showcase against the mocked services (dev/mock-upstreams.js),
// so they show no real name, address or key. Needs Chrome, Chromium or Edge; set CHROME to pick one.
//   node scripts/screenshots.js                 starts the mocks and the showcase, lets the graphs fill, then takes every picture
//   node scripts/screenshots.js --wait 30       a shorter wait (seconds), with shorter graphs
//   node scripts/screenshots.js --url http://127.0.0.1:3000 --wait 0    a showcase already running (npm run dev:showcase)
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { build } from 'vite'
import { startMocks } from '../dev/mock-upstreams.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const OUT = path.join(root, 'docs', 'ui')

/** @type {{ file: string, width: number, scheme: 'dark' | 'light', scale?: number, mobile?: boolean, height?: number, openAlerts?: boolean }[]} */
const SHOTS = [
  { file: 'dashboard-dark.png', width: 1600, scheme: 'dark' },
  { file: 'dashboard-light.png', width: 1600, scheme: 'light' },
  { file: 'alerts-dark.png', width: 1600, height: 560, scheme: 'dark', openAlerts: true },
  { file: 'phone-dark.png', width: 390, height: 1400, scheme: 'dark', scale: 2, mobile: true }
]

const { values: args } = parseArgs({ options: { url: { type: 'string' }, wait: { type: 'string', default: '180' } } })
const sleep = (/** @type {number} */ ms) => new Promise(resolve => setTimeout(resolve, ms))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-shots-'))
/** @type {(() => Promise<void> | void)[]} */
const cleanup = []

try {
  let url = args.url
  if (!url) {
    // the server serves dist/, so the pictures show the page as it is in the source now
    await build({ configFile: path.join(root, 'vite.config.js'), logLevel: 'warn' })
    const mocks = await startMocks({ quiet: true })
    cleanup.push(() => mocks.close())
    const port = 3399
    const server = spawn(process.execPath, ['bin/homelabdash.js', 'serve', '--config-dir', 'examples/showcase', '--data-dir', path.join(temp, 'data'), '--port', String(port)], { cwd: root, stdio: 'ignore' })
    cleanup.push(() => { server.kill() })
    url = `http://127.0.0.1:${port}/`
    await until(async () => (await fetch(`${url}api/health`).catch(() => null))?.ok, 30_000, 'the showcase did not start')
  }
  // Sources poll at their own pace only while a page is connected, and the graphs need a point every 10 s to draw a line.
  const page = new WebSocket(`${url.replace(/^http/, 'ws').replace(/\/$/, '')}/api/ws`)
  cleanup.push(() => page.close())
  const wait = Number(args.wait)
  if (wait > 0) console.log(`letting the graphs fill for ${wait} s`)
  await sleep(wait * 1000)

  const chrome = await launch(browser(), path.join(temp, 'profile'))
  cleanup.push(() => chrome.close())
  fs.mkdirSync(OUT, { recursive: true })
  for (const shot of SHOTS) {
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: shot.width, height: shot.height ?? 900, deviceScaleFactor: shot.scale ?? 1, mobile: !!shot.mobile })
    await chrome.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: shot.scheme }] })
    await chrome.send('Page.navigate', { url })
    await until(async () => (await chrome.eval('document.querySelectorAll("[data-tile] .v-stat-value, [data-tile] .v-row").length')) > 10, 20_000, `${shot.file}: no data on the page`)
    await sleep(2500)
    if (shot.openAlerts) {
      await chrome.eval('document.querySelector(".top-chips .chip")?.click()')
      await sleep(500)
    }
    const height = shot.height ?? await chrome.eval('document.documentElement.scrollHeight')
    const { data } = await chrome.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: shot.width, height, scale: 1 } })
    fs.writeFileSync(path.join(OUT, shot.file), Buffer.from(data, 'base64'))
    console.log(`docs/ui/${shot.file}  ${shot.width}x${height}${shot.scale ? ` at ${shot.scale}x` : ''}`)
  }
} finally {
  for (const step of cleanup.reverse()) await step()
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5 })
  // A socket or timer of the mocks left open must not keep a finished run (and its ports) alive.
  process.exit(process.exitCode ?? 0)
}

/** @param {() => Promise<unknown>} test @param {number} ms @param {string} what */
async function until (test, ms, what) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await test()) return
    await sleep(250)
  }
  throw new Error(what)
}

function browser () {
  if (process.env.CHROME) return process.env.CHROME
  const candidates = process.platform === 'win32'
    ? [`${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`, `${process.env.LOCALAPPDATA}\\Chromium\\Application\\chrome.exe`]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']
  for (const c of candidates) {
    if (path.isAbsolute(c) ? fs.existsSync(c) : found(c)) return c
  }
  throw new Error('no Chrome, Chromium or Edge found: set CHROME to the path of one')
}

/** @param {string} name */
function found (name) {
  try { execFileSync('which', [name], { stdio: 'ignore' }); return true } catch { return false }
}

/** Starts a headless browser and talks to its first page over the DevTools protocol. @param {string} exe @param {string} profile */
async function launch (exe, profile) {
  const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })
  const portFile = path.join(profile, 'DevToolsActivePort')
  await until(async () => fs.existsSync(portFile) && fs.readFileSync(portFile, 'utf8').includes('\n'), 20_000, `${exe} did not start`)
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0]
  const targets = /** @type {any[]} */ (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  let seq = 0
  /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
  const waiting = new Map()
  ws.on('message', raw => {
    const msg = JSON.parse(String(raw))
    const w = waiting.get(msg.id)
    if (!w) return
    waiting.delete(msg.id)
    if (msg.error) w.reject(new Error(msg.error.message))
    else w.resolve(msg.result)
  })
  /** @param {string} method @param {Record<string, unknown>} [params] @returns {Promise<any>} */
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    waiting.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
  return {
    send,
    /** @param {string} expression */
    eval: async expression => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.value,
    async close () {
      ws.close()
      proc.kill()
      await new Promise(resolve => proc.once('exit', resolve))
    }
  }
}
