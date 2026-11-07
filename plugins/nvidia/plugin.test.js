import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPlugin } from 'homelabdash/testing'
import { QUERY } from './index.js'

const ssh = { host: 'gpu.example', username: 'monitor', privateKeyPath: 'ssh/gpu_ed25519' }

test('one GPU as numbers, over SSH', async () => {
  const r = await runPlugin(import.meta.dirname, { config: ssh, options: { gpu: 1 } })
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => [i.label, i.value]), [['Load', 0], ['VRAM', (404 / 24576) * 100], ['Power', 22.1], ['Temp', 41]])
  assert.equal(r.view.items[1].detail, '0.4 / 24.0 GB')
})

test('without a host it runs nvidia-smi in the container', async () => {
  const r = await runPlugin(import.meta.dirname, { config: {}, options: { view: 'list' } })
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => [i.title, i.value, i.subtitle]), [
    ['GPU0 RTX 3090', 84, '12.4 / 24.0 GB, 341 W, 87°C, fan 98%'],
    ['GPU1 RTX 3090', 0, '0.4 / 24.0 GB, 22 W, 41°C, fan 30%']
  ])
})

test('what a card does not report stays empty instead of failing', async () => {
  const fixtures = { [`SSH ${QUERY}`]: { stdout: '0, Tesla T4, 5, 100, 15360, [N/A], [N/A], 50, [Not Supported], P0\n' } }
  const r = await runPlugin(import.meta.dirname, { config: ssh, fixtures })
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => i.value), [5, (100 / 15360) * 100, null, 50])
})

test('each card turns yellow and red by its own limits, from the readings and nvidia-smi -q in one command', async () => {
  const r = await runPlugin(import.meta.dirname, { config: ssh })
  assert.deepEqual(r.view.items.at(-1), { label: 'Temp', value: 87, format: 'temperature', warn: 88, crit: 93 })
  const local = await runPlugin(import.meta.dirname, { config: {}, options: { gpu: 1 } })
  assert.deepEqual([local.view.items.at(-1).warn, local.view.items.at(-1).crit], [88, 93])

  // a workstation card that runs hotter, with a slowdown but no max operating temperature reported
  const csv = '0, NVIDIA RTX A4000, 0, 200, 16376, 52.80, 140.00, 96, 100, P2\n'
  const q = '==============NVSMI LOG==============\nGPU 00000000:01:00.0\n    Temperature\n        GPU Shutdown Temp : 103 C\n        GPU Slowdown Temp : 100 C\n        GPU Max Operating Temp : N/A\n'
  const hot = await runPlugin(import.meta.dirname, { config: ssh, fixtures: { [`SSH ${QUERY}`]: { stdout: csv + q } }, options: { view: 'list' } })
  assert.equal(hot.view.items[0].tone, 'warning')
})

test('a key still locked to the readings alone keeps 80 and 90', async () => {
  const fixtures = { [`SSH ${QUERY}`]: { stdout: '0, NVIDIA GeForce RTX 3090, 84, 12666, 24576, 341.39, 350.00, 91, 98, P2\n' } }
  const r = await runPlugin(import.meta.dirname, { config: ssh, fixtures, options: { view: 'list' } })
  assert.equal(r.view.items[0].tone, 'error')
})

test('a GPU that does not exist, and nvidia-smi failing, are explained', async () => {
  const r = await runPlugin(import.meta.dirname, { config: ssh, options: { gpu: 4 } })
  assert.equal(r.view.type, 'text')
  assert.match(r.view.text, /No GPU 4 \(nvidia-smi shows 0, 1\)/)
  const fixtures = { [`SSH ${QUERY}`]: { stdout: '', stderr: 'NVIDIA-SMI has failed because it could not communicate with the NVIDIA driver', code: 9 } }
  await assert.rejects(runPlugin(import.meta.dirname, { config: ssh, fixtures }), /nvidia-smi failed \(9\): NVIDIA-SMI has failed/)
})

test('a temperature alert per GPU, only when asked for', async () => {
  assert.deepEqual((await runPlugin(import.meta.dirname, { config: ssh })).alerts, [])
  const r = await runPlugin(import.meta.dirname, { config: { ...ssh, tempAlert: 85 } })
  assert.deepEqual(r.alerts.map(a => [a.id, a.severity, a.title]), [['temp:0', 'warning', 'GPU0 at 87°C']])
})
