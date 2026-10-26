import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LoginThrottle } from '../src/server/throttle.js'

test('an address is refused after too many failed logins, until its window is over', () => {
  const t = new LoginThrottle({ limit: 3, windowMs: 1000 })
  for (let i = 0; i < 2; i++) t.fail('192.0.2.1', 0)
  assert.equal(t.blocked('192.0.2.1', 10), false)
  t.fail('192.0.2.1', 20)
  assert.equal(t.blocked('192.0.2.1', 30), true)
  assert.equal(t.blocked('192.0.2.2', 30), false, 'other addresses are not affected')
  assert.equal(t.blocked('192.0.2.1', 1000), false, 'the window runs from the first failure')
  t.fail('192.0.2.1', 1001)
  assert.equal(t.blocked('192.0.2.1', 1002), false, 'a new window starts from zero')
})

test('the number of tracked addresses stays bounded', () => {
  const t = new LoginThrottle({ limit: 1, windowMs: 1000, maxAddresses: 3 })
  t.fail('192.0.2.1', 0)
  for (const a of ['192.0.2.2', '192.0.2.3', '192.0.2.4']) t.fail(a, 2000)
  assert.equal(t.fails.size, 3)
  assert.equal(t.blocked('192.0.2.1', 2000), false, 'the expired address went first')
  t.fail('192.0.2.5', 2000)
  assert.equal(t.fails.size, 3)
  assert.equal(t.blocked('192.0.2.2', 2000), false, 'then the oldest')
  assert.equal(t.blocked('192.0.2.5', 2000), true)
})
