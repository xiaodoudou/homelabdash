import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPlugin } from 'homelabdash/testing'
import plugin from './index.js'

const dir = import.meta.dirname
const config = { host: 'ups.example' }
const ONLINE = ['UPSNAME  : rack-ups', 'STATUS   : ONLINE ', 'LOADPCT  : 20.0 Percent', 'BCHARGE  : 100.0 Percent', 'TIMELEFT : 30.8 Minutes']

/** NIS framing: 2-byte big-endian length + text per record, then a zero-length record. */
function reply (/** @type {string[]} */ lines, { end = true } = {}) {
  const parts = lines.flatMap(line => {
    const body = Buffer.from(line + '\n', 'latin1')
    const head = Buffer.alloc(2)
    head.writeUInt16BE(body.length)
    return [head, body]
  })
  if (end) parts.push(Buffer.alloc(2))
  return Buffer.concat(parts)
}

const tcp = (/** @type {Buffer} */ buf) => ({ 'TCP ups.example:3551': { base64: buf.toString('base64') } })

test('summary tile from the recorded reply', async () => {
  const r = await runPlugin(dir, { config })
  assert.deepEqual(r.view?.items.map(i => i.value), ['online', 20, 100, 1848])
  assert.deepEqual(r.view.items[2], { label: 'Battery', value: 100, format: 'percent', warn: 50, crit: 25, invert: true })
  assert.deepEqual(r.alerts, [])
})

test('power tile computes watts from LOADPCT and NOMPOWER', async () => {
  const r = await runPlugin(dir, { config, options: { view: 'power' } })
  assert.deepEqual(r.view?.items.map(i => i.value), [96, 230, 13.6, 'Back-UPS XS 950U'])
  const bare = await runPlugin(dir, { config, options: { view: 'power' }, fixtures: tcp(reply(ONLINE)) })
  assert.equal(bare.view?.items[0].value, null, 'no NOMPOWER, no watts')
})

test('details lists every record, values keep their colons', async () => {
  const r = await runPlugin(dir, { config, options: { view: 'details' } })
  assert.equal(r.view?.items.length, 38)
  assert.deepEqual(r.view.items.find(i => i.title === 'STATUS'), { key: 'STATUS', title: 'STATUS', subtitle: 'ONLINE' })
  assert.equal(r.view.items.find(i => i.title === 'END APC').subtitle, '2026-10-12 09:30:14 +0000')
})

test('records longer than 255 bytes use both length bytes', async () => {
  const r = await runPlugin(dir, { config, options: { view: 'details' }, fixtures: tcp(reply([...ONLINE, `LASTXFER : ${'x'.repeat(300)}`])) })
  assert.equal(r.view?.items.at(-1).subtitle.length, 300)
})

test('on battery: an error, plus a warning once the charge is low', async () => {
  const lines = ['UPSNAME  : rack-ups', 'STATUS   : ONBATT ', 'BCHARGE  : 40.0 Percent', 'TIMELEFT : 12.5 Minutes']
  const r = await runPlugin(dir, { config, fixtures: tcp(reply(lines)) })
  assert.deepEqual(r.alerts.map(a => [a.id, a.severity]), [['onbatt', 'error'], ['battery-low', 'warning']])
  assert.equal(r.alerts[0].title, 'rack-ups is on battery')
  assert.equal(r.alerts[0].message, 'Battery 40%, about 13 min left')
  assert.equal(r.view?.items[0].value, 'onbatt')
  const off = await runPlugin(dir, { config: { ...config, batteryAlertPercent: 0 }, fixtures: tcp(reply(lines)) })
  assert.deepEqual(off.alerts.map(a => a.id), ['onbatt'])
})

test('a status that is neither ONLINE nor on battery is a warning keyed on the status', async () => {
  const r = await runPlugin(dir, { config, fixtures: tcp(reply(['STATUS   : COMMLOST', 'BCHARGE  : 100.0 Percent'])) })
  assert.deepEqual(r.alerts.map(a => [a.id, a.severity]), [['status:COMMLOST', 'warning'], ['flag:COMMLOST', 'error']])
  const online = await runPlugin(dir, { config, fixtures: tcp(reply(['STATUS   : ONLINE LOWBATT', 'BCHARGE  : 100.0 Percent'])) })
  assert.deepEqual(online.alerts.map(a => a.id), ['flag:LOWBATT'])
})

test('a truncated reply fails the fetch', async () => {
  await assert.rejects(runPlugin(dir, { config, fixtures: tcp(reply(ONLINE).subarray(0, 40)) }), /truncated or invalid apcupsd reply: a 19-byte record at byte 22 runs past the 40 bytes received/)
  await assert.rejects(runPlugin(dir, { config, fixtures: tcp(reply(ONLINE, { end: false })) }), /without the end-of-status record/)
  await assert.rejects(runPlugin(dir, { config, fixtures: tcp(Buffer.concat([reply(ONLINE, { end: false }), Buffer.from([0])])) }), /without the end-of-status record/)
})

test('a reply that is not an apcupsd status fails the fetch', async () => {
  const text = (/** @type {string} */ response) => ({ 'TCP ups.example:3551': { response } })
  await assert.rejects(runPlugin(dir, { config, fixtures: text('HTTP/1.1 400 Bad Request\r\n\r\n') }), /truncated or invalid apcupsd reply/)
  await assert.rejects(runPlugin(dir, { config, fixtures: text('') }), /without replying/)
  await assert.rejects(runPlugin(dir, { config, fixtures: tcp(reply(['Not available'])) }), /no STATUS record \(got "Not available"\)/)
})

test('sends the framed status command and reads up to the end record', async () => {
  /** @type {any[][]} */
  const calls = []
  const ctx = /** @type {any} */ ({ config: { host: 'ups.example', port: 3551 }, tcp: { request: async (/** @type {any[]} */ ...args) => { calls.push(args); return reply(ONLINE) } } })
  const data = await plugin.fetch?.(ctx)
  assert.deepEqual(calls[0].slice(0, 2), ['ups.example', 3551])
  assert.deepEqual([...calls[0][2]], [0, 6, ...Buffer.from('status')])
  assert.equal(calls[0][3].until, '\x00\x00')
  assert.equal(data.timeLeft, 1848)
})

test('status flags: regulation is normal, replace-battery and overload alert', () => {
  const ctx = /** @type {any} */ ({ config: { batteryAlertPercent: 50 } })
  const ids = (/** @type {string} */ status) => /** @type {any} */ (plugin).alerts({ status, battery: 100, timeLeft: 1800, name: 'UPS' }, ctx).map((/** @type {any} */ a) => a.id)
  assert.deepEqual(ids('TRIM ONLINE'), [])
  assert.deepEqual(ids('ONLINE REPLACEBATT'), ['flag:REPLACEBATT'])
  assert.deepEqual(ids('ONLINE OVERLOAD'), ['flag:OVERLOAD'])
  assert.deepEqual(ids('COMMLOST'), ['status:COMMLOST', 'flag:COMMLOST'])
  assert.deepEqual(ids('ONBATT LOWBATT'), ['onbatt', 'flag:LOWBATT'])
})
