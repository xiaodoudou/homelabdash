const RANK = /** @type {Record<string, number>} */ ({ error: 0, warning: 1, info: 2 })
const ALERTS_SHOWN = 6

/**
 * @typedef {object} Alert
 * @property {string} id
 * @property {'info'|'warning'|'error'} severity
 * @property {string} [title]
 * @property {string} [message]
 * @property {string} [href]
 * @property {string | number} [time]
 * @property {{ name: string, title: string, input?: any }[]} actions
 */

/**
 * Merges the alerts every source reports into one list. Dismissals are kept server-side
 * and forgotten once the alert stops firing, so a recurring alert shows up again.
 */
export class Alerts {
  /** @param {import('./store.js').Store} store */
  constructor (store) {
    this.store = store
    /** @type {Map<string, { name: string, alerts: Alert[] }>} */
    this.bySource = new Map()
    /** @type {Set<string>} */
    this.dismissed = new Set(store.get('alerts', { dismissed: [] }).dismissed)
  }

  /**
   * @param {string} sourceId
   * @param {string} name
   * @param {Alert[] | null} alerts null when the source failed: keep what it reported before
   */
  set (sourceId, name, alerts) {
    if (alerts === null) return false
    const before = JSON.stringify(this.bySource.get(sourceId) ?? null)
    this.bySource.set(sourceId, { name, alerts })
    const live = new Set(alerts.map(a => `${sourceId}:${a.id}`))
    let pruned = false
    for (const key of this.dismissed) {
      if (key.startsWith(`${sourceId}:`) && !live.has(key)) { this.dismissed.delete(key); pruned = true }
    }
    if (pruned) this.save()
    return before !== JSON.stringify(this.bySource.get(sourceId))
  }

  /** @param {string} sourceId */
  remove (sourceId) {
    return this.bySource.delete(sourceId)
  }

  /** @param {string} key "<source>:<alert id>" */
  dismiss (key) {
    if (!this.find(key)) return false
    this.dismissed.add(key)
    this.save()
    return true
  }

  /** @param {string} key */
  find (key) {
    const i = key.indexOf(':')
    const sourceId = key.slice(0, i)
    const alert = this.bySource.get(sourceId)?.alerts.find(a => a.id === key.slice(i + 1))
    return alert ? { sourceId, alert } : null
  }

  save () {
    this.store.set('alerts', { dismissed: [...this.dismissed] })
  }

  active () {
    /** @type {(Alert & { key: string, source: string, sourceName: string })[]} */
    const out = []
    for (const [sourceId, { name, alerts }] of this.bySource) {
      for (const a of alerts) {
        const key = `${sourceId}:${a.id}`
        if (!this.dismissed.has(key)) out.push({ ...a, key, source: sourceId, sourceName: name })
      }
    }
    return out.sort((a, b) => (RANK[a.severity] - RANK[b.severity]) || (timeOf(b.time) - timeOf(a.time)))
  }

  view () {
    const items = this.active().map(a => ({
      key: a.key,
      title: a.title ?? a.message,
      subtitle: [a.sourceName, a.title ? a.message : null].filter(Boolean).join(' - '),
      href: a.href,
      time: a.time,
      tone: a.severity,
      actions: [
        ...a.actions.map(x => ({ action: 'run', title: x.title, input: { key: a.key, name: x.name, input: x.input } })),
        { action: 'dismiss', title: 'Dismiss', input: { key: a.key } }
      ]
    }))
    return { type: 'list', items, limit: ALERTS_SHOWN }
  }
}

/** @param {string | number | undefined} t */
function timeOf (t) {
  if (t === undefined) return 0
  return typeof t === 'number' ? t : Date.parse(t) || 0
}
