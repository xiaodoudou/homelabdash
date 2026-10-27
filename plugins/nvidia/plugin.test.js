import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPlugin } from 'homelabdash/testing'
import { QUERY } from './index.js'

const ssh = { host: 'gpu.example', username: 'monitor', privateKeyPath: 'ssh/gpu_ed25519' }

test('one GPU as numbers, over SSH', async () => {
  const r = await runPlugin(import.meta.dirname, { config: ssh, options: { gpu: 1 } })
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => [i.label, i.value]), [['Load', 0], ['VRAM', (404 / 24576) * 100], ['Used', 404 * 1024 * 1024], ['Power', 22.1], ['Temp', 41]])
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
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => i.value), [5, (100 / 15360) * 100, 100 * 1024 * 1024, null, 50])
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
