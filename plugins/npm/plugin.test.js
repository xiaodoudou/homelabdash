import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPlugin } from 'homelabdash/testing'
import plugin from './index.js'

const dir = import.meta.dirname
const config = { url: 'http://proxy.example:81', email: 'admin@proxy.example', password: 'test-password' }
const DAY = 86_400_000
const at = (/** @type {number} */ days) => new Date(Date.now() + days * DAY).toISOString()
const sqlite = (/** @type {number} */ days) => at(days).slice(0, 19).replace('T', ' ')
const HOSTS = [{ id: 1, domain_names: ['media.example'], certificate_id: 2, enabled: true }]

/** @param {any[]} certificates */
const upstream = certificates => ({
  'POST /api/tokens': { body: { token: 'test-token-new', expires: at(1) } },
  'GET /api/nginx/proxy-hosts': { body: HOSTS },
  'GET /api/nginx/certificates': { body: certificates }
})

test('summary counts enabled, SSL and disabled hosts, booleans as true/false or 1/0', async () => {
  const r = await runPlugin(dir, { config })
  assert.deepEqual(r.view?.items.map(i => [i.label, i.value]), [['Hosts', 3], ['SSL', 2], ['Disabled', 2]])
  assert.equal(r.view.items[0].href, 'http://proxy.example:81/nginx/proxy')
  assert.equal(r.state.session.token, 'test-token-1')
})

test('certificates soonest first, named after nice_name or the first domain', async () => {
  const certs = [
    { id: 3, nice_name: 'Home wildcard', domain_names: ['*.home.example', 'home.example'], expires_on: sqlite(60) },
    { id: 1, nice_name: '', domain_names: ['old.example'], expires_on: sqlite(-2) },
    { id: 2, nice_name: 'media.example', domain_names: ['media.example'], expires_on: at(5) }
  ]
  const r = await runPlugin(dir, { config, options: { view: 'certificates' }, fixtures: upstream(certs) })
  assert.deepEqual(r.view?.items.map(i => [i.title, i.badge.text, i.badge.tone]), [
    ['old.example', 'expired', 'error'],
    ['media.example', 'expiring', 'warning'],
    ['Home wildcard', 'valid', 'ok']
  ])
  assert.equal(r.view.items[2].subtitle, '*.home.example, home.example')
  assert.equal(r.view.items[2].time, certs[0].expires_on.replace(' ', 'T') + '.000Z', 'SQLite dates read as UTC')
  const two = await runPlugin(dir, { config, options: { view: 'certificates', limit: 2 }, fixtures: upstream(certs) })
  assert.equal(two.view?.items.length, 2)
})

test('alerts for certificates that expired or expire within certExpiryDays', async () => {
  const certs = [
    { id: 1, nice_name: '', domain_names: ['old.example'], expires_on: sqlite(-2) },
    { id: 2, nice_name: 'media.example', domain_names: ['media.example'], expires_on: at(5) },
    { id: 3, nice_name: 'later', domain_names: ['later.example'], expires_on: at(30) }
  ]
  const r = await runPlugin(dir, { config, fixtures: upstream(certs) })
  assert.deepEqual(r.alerts.map(a => [a.id, a.severity]), [
    [`cert:1:${certs[0].expires_on}:expired`, 'error'],
    [`cert:2:${certs[1].expires_on}`, 'warning']
  ])
  assert.equal(r.alerts[1].title, 'Certificate media.example expires in 5 days')
  assert.equal(r.alerts[1].href, 'http://proxy.example:81/nginx/certificates')
  const off = await runPlugin(dir, { config: { ...config, certExpiryDays: 0 }, fixtures: upstream(certs) })
  assert.deepEqual(off.alerts.map(a => a.severity), ['error'])
})

test('a stored session is reused until a minute before it expires', async () => {
  const session = { token: 'test-token-old', expires: at(1), url: config.url, email: config.email }
  const { 'POST /api/tokens': _, ...noLogin } = upstream([])
  const reused = await runPlugin(dir, { config, state: { session }, fixtures: noLogin })
  assert.equal(reused.state.session.token, 'test-token-old')

  const ending = await runPlugin(dir, { config, state: { session: { ...session, expires: new Date(Date.now() + 30_000).toISOString() } }, fixtures: upstream([]) })
  assert.equal(ending.state.session.token, 'test-token-new')
  const otherUser = await runPlugin(dir, { config, state: { session: { ...session, email: 'someone@proxy.example' } }, fixtures: upstream([]) })
  assert.equal(otherUser.state.session.token, 'test-token-new')
})

/**
 * A ctx whose API accepts only the tokens in `valid`; records every call.
 * @param {string[]} valid
 * @param {any} [session]
 */
function fakeCtx (valid, session) {
  /** @type {string[]} */
  const calls = []
  /** @type {Map<string, any>} */
  const state = new Map(session ? [['session', session]] : [])
  const ctx = /** @type {any} */ ({
    config: { ...config, certExpiryDays: 14 },
    state: { get: (/** @type {string} */ k, /** @type {any} */ f) => state.has(k) ? state.get(k) : f, set: (/** @type {string} */ k, /** @type {any} */ v) => state.set(k, v) },
    http: {
      json: async (/** @type {string} */ url, /** @type {any} */ o) => {
        const path = new URL(url).pathname
        if (o.json) {
          calls.push(`POST ${path}`)
          return { token: 'test-token-new', expires: at(1) }
        }
        calls.push(`GET ${path} ${o.auth.bearer}`)
        if (!valid.includes(o.auth.bearer)) throw Object.assign(new Error(`GET ${url} returned 401`), { status: 401 })
        return path.endsWith('/proxy-hosts') ? HOSTS : []
      }
    }
  })
  return { ctx, calls, state }
}

test('a 401 on a stored token logs in once and retries with the new token', async () => {
  const { ctx, calls, state } = fakeCtx(['test-token-new'], { token: 'test-token-old', expires: at(1), url: config.url, email: config.email })
  const data = await plugin.fetch?.(ctx)
  assert.deepEqual(calls, [
    'GET /api/nginx/proxy-hosts test-token-old',
    'GET /api/nginx/certificates test-token-old',
    'POST /api/tokens',
    'GET /api/nginx/proxy-hosts test-token-new',
    'GET /api/nginx/certificates test-token-new'
  ])
  assert.equal(state.get('session').token, 'test-token-new')
  assert.equal(data.hosts.length, 1)
})

test('a 401 that survives a new login fails instead of looping', async () => {
  const stale = fakeCtx([], { token: 'test-token-old', expires: at(1), url: config.url, email: config.email })
  await assert.rejects(async () => plugin.fetch?.(stale.ctx), /returned 401/)
  assert.equal(stale.calls.filter(c => c.startsWith('POST')).length, 1)

  const fresh = fakeCtx([])
  await assert.rejects(async () => plugin.fetch?.(fresh.ctx), /returned 401/)
  assert.equal(fresh.calls.filter(c => c.startsWith('POST')).length, 1, 'a token from this very fetch is not retried')

  const unauthorized = { status: 401, body: { error: { code: 401, message: 'Invalid token' } } }
  await assert.rejects(runPlugin(dir, { config, fixtures: { ...upstream([]), 'GET /api/nginx/proxy-hosts': unauthorized } }), /returned 401/)
})

test('a failed login says so', async () => {
  await assert.rejects(runPlugin(dir, { config, fixtures: { ...upstream([]), 'POST /api/tokens': { status: 401, body: { error: { code: 401, message: 'Invalid email or password' } } } } }), /login failed/)
})
