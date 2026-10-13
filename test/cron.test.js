import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSchedule, nextRun } from '../src/runtime/cron.js'

const at = (/** @type {string} */ s) => new Date(s)
const next = (/** @type {string} */ expr, /** @type {string} */ from) => {
  const d = nextRun(parseSchedule(expr), at(from))
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

test('steps and ranges', () => {
  assert.equal(next('*/5 * * * *', '2026-03-10T10:02:30'), '2026-03-10 10:05')
  assert.equal(next('*/5 * * * *', '2026-03-10T10:05:00'), '2026-03-10 10:10')
  assert.equal(next('0 9-17/4 * * *', '2026-03-10T10:00:00'), '2026-03-10 13:00')
  assert.equal(next('30 4 * * *', '2026-03-10T05:00:00'), '2026-03-11 04:30')
})

test('macros and month rollover', () => {
  assert.equal(next('@hourly', '2026-03-10T10:59:59'), '2026-03-10 11:00')
  assert.equal(next('@monthly', '2026-12-15T00:00:00'), '2027-01-01 00:00')
})

test('day of month OR day of week when both are set, like cron', () => {
  // 2026-03-10 is a Tuesday: next is Friday 13th (dom) or Sunday 15th (dow 0), whichever comes first.
  assert.equal(next('0 0 13 * 0', '2026-03-10T12:00:00'), '2026-03-13 00:00')
  assert.equal(next('0 0 * * 7', '2026-03-10T12:00:00'), '2026-03-15 00:00')
})

test('durations', () => {
  const s = parseSchedule('10m')
  assert.equal(s.kind, 'every')
  assert.equal(nextRun(s, at('2026-03-10T10:00:00')).getTime() - at('2026-03-10T10:00:00').getTime(), 600_000)
  assert.throws(() => parseSchedule('500ms'), /minimum is 1s/)
})

test('invalid expressions explain themselves', () => {
  assert.throws(() => parseSchedule('* * *'), /5 cron fields/)
  assert.throws(() => parseSchedule('61 * * * *'), /out of range 0-59/)
  assert.throws(() => parseSchedule('a * * * *'), /cannot read "a"/)
})
