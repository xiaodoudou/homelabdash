/**
 * Counts refused logins per client address. After `limit` of them within `windowMs`, the address is refused outright
 * until its window is over, so a password can be mistyped but not guessed at speed. Behind a reverse proxy every
 * visitor shares the proxy's address.
 */
export class LoginThrottle {
  /** @param {{ limit?: number, windowMs?: number, maxAddresses?: number }} [options] */
  constructor ({ limit = 20, windowMs = 60_000, maxAddresses = 10_000 } = {}) {
    this.limit = limit
    this.windowMs = windowMs
    this.maxAddresses = maxAddresses
    /** @type {Map<string, { count: number, until: number }>} */
    this.fails = new Map()
  }

  /** @param {string} address @param {number} [now] */
  blocked (address, now = Date.now()) {
    const f = this.fails.get(address)
    if (f && f.until <= now) this.fails.delete(address)
    return (this.fails.get(address)?.count ?? 0) >= this.limit
  }

  /** @param {string} address @param {number} [now] */
  fail (address, now = Date.now()) {
    const f = this.fails.get(address)
    if (f && f.until > now) {
      f.count++
      return
    }
    // many addresses at once is a scan or a flood: forget the expired ones first, then the oldest
    if (this.fails.size >= this.maxAddresses) {
      for (const [key, v] of this.fails) if (v.until <= now) this.fails.delete(key)
      for (const key of this.fails.keys()) {
        if (this.fails.size < this.maxAddresses) break
        this.fails.delete(key)
      }
    }
    this.fails.set(address, { count: 1, until: now + this.windowMs })
  }
}
