import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPlugin } from 'homelabdash/testing'

const config = {
  host: 'router.example',
  username: 'monitor',
  password: 'x',
  commands: {
    conntrack: { run: 'cat /proc/sys/net/netfilter/nf_conntrack_count', parse: 'number', alert: { above: 50000 } },
    mem: { run: "awk '/MemTotal|MemAvailable/ {print $1 $2*1024}' /proc/meminfo", parse: 'kv' }
  },
  follow: { command: 'logread -f', lines: 10 }
}

test('commands become stats, kv fields included', async () => {
  const r = await runPlugin(import.meta.dirname, {
    config,
    options: { view: 'stats', items: [{ command: 'conntrack', label: 'Conns' }, { command: 'mem', field: 'MemAvailable', label: 'Free', format: 'bytes' }] }
  })
  assert.deepEqual(r.view?.items.map(i => i.value), [61234, 312475648])
  assert.equal(r.alerts[0]?.id, 'cmd:conntrack')
})

test('follow streams the log with error lines highlighted', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { view: 'log' }, stream: { timeout: 2000 } })
  const view = /** @type {any} */ (r.updates.at(-1)?.derived.views.tile.view)
  assert.equal(view.lines.length, 3)
  assert.deepEqual(view.lines.map((/** @type {any} */ l) => l.tone), [undefined, 'warning', 'error'])
})

test('a missing fixture fails loudly', async () => {
  await assert.rejects(
    runPlugin(import.meta.dirname, { config: { ...config, commands: { x: { run: 'not-recorded' } } }, options: { view: 'text' } }),
    /no fixture for "SSH not-recorded"/
  )
})
