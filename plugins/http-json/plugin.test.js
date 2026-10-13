import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPlugin } from 'homelabdash/testing'

test('merges two requests into one source', async () => {
  const r = await runPlugin(import.meta.dirname, {
    config: {
      requests: {
        movies: { url: 'http://media.example/radarr/api/v3/wanted/missing', query: { pageSize: 1 }, auth: { header: 'X-Api-Key', value: 'k1' } },
        episodes: { url: 'http://media.example/sonarr/api/v3/wanted/missing', query: { pageSize: 1 }, auth: { header: 'X-Api-Key', value: 'k2' } }
      }
    },
    tiles: [
      { id: 'movies', options: { items: [{ label: 'Missing', value: 'movies.totalRecords', format: 'number' }] } },
      { id: 'total', options: { items: [{ label: 'All', value: 'movies.totalRecords + episodes.totalRecords' }] } }
    ]
  })
  assert.equal(r.views.movies.view?.items[0].value, 42)
  assert.equal(r.views.total.view?.items[0].value, 359)
})

test('reads a response header (subscription quota)', async () => {
  const r = await runPlugin(import.meta.dirname, {
    config: {
      url: 'http://vpn.example/sub',
      response: true,
      transform: '( $kv := $split(headers."subscription-userinfo", "; ") ~> $map(function($p){ $split($p, "=") }); { "used": $number($kv[0][1]) + $number($kv[1][1]), "total": $number($kv[2][1]) } )'
    },
    options: { progress: [{ label: 'Quota', value: 'used', max: 'total', format: 'bytes' }] }
  })
  assert.equal(r.view?.type, 'progress')
  assert.equal(r.view.items[0].value, 1073741824 + 53687091200)
  assert.equal(r.view.items[0].max, 214748364800)
})

test('list rows and alerts from expressions', async () => {
  const r = await runPlugin(import.meta.dirname, {
    config: {
      url: 'http://dl.example/api/queue',
      alerts: 'paused ? [{ "id": "paused", "message": "Queue is paused", "severity": "warning" }] : []'
    },
    options: { list: { items: 'slots', title: 'name', subtitle: 'status', value: 'percentage', format: 'percent', badge: 'status' } }
  })
  assert.equal(r.view?.items.length, 2)
  assert.equal(r.view.items[0].title, 'Some.Linux.ISO')
  assert.equal(r.view.items[0].badge.text, 'Downloading')
  assert.deepEqual(r.alerts, [])
})

test('needs url or requests', async () => {
  await assert.rejects(runPlugin(import.meta.dirname, { config: {} }), /invalid config/)
})
