#!/usr/bin/env node
// Fails when a file about to be published contains something that identifies a home network or an
// account: private IPv4 addresses, key-looking values, private keys, and every pattern listed in the
// gitignored .privacy-denylist (one literal per line, or /regex/). Also flags typographic dashes and
// middle dots, which the project avoids in its text.
//   node scripts/privacy-check.js            tracked + untracked (not ignored) files
//   node scripts/privacy-check.js --staged   what `git commit` is about to record
// A line containing "privacy-check: ignore" is skipped.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const staged = process.argv.includes('--staged')

/** @type {{ name: string, re: RegExp, allow?: (m: RegExpExecArray, line: string) => boolean }[]} */
const RULES = [
  {
    name: 'private IPv4 address',
    re: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b(?:\/\d{1,2})?/g,
    // The three private ranges as a whole (in allow-lists) name nobody's network.
    allow: m => ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'].includes(m[0])
  },
  {
    name: 'private key',
    re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g
  },
  {
    name: 'key-looking value',
    re: /\b(?:api[_-]?key|apikey|token|secret|passw(?:or)?d|bearer)["']?\s*[:=]\s*["']?([A-Za-z0-9_\-+/]{20,})/gi,
    // ${secret:SOME_NAME} references and ALL_CAPS names are not values.
    allow: (m, line) => /^(demo|test|example|changeme|your)/i.test(m[1]) || /^[A-Z0-9_]+$/.test(m[1]) || line.slice(Math.max(0, m.index - 2), m.index) === '${'
  },
  {
    name: 'hex key in a URL',
    re: /[?&](?:apikey|api_key|token|key)=([0-9a-f]{24,})/gi
  },
  {
    name: 'typographic dash or middle dot (use - , ; : or parentheses)',
    re: /[\u2013\u2014\u00b7]/g
  }
]

const denyFile = path.join(ROOT, '.privacy-denylist')
if (fs.existsSync(denyFile)) {
  for (const raw of fs.readFileSync(denyFile, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^\/(.+)\/([a-z]*)$/.exec(line)
    RULES.push({
      name: 'denylisted',
      re: m ? new RegExp(m[1], m[2].includes('g') ? m[2] : m[2] + 'g') : new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    })
  }
}

/** @param {string[]} args */
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

/** @returns {{ file: string, read: () => string }[]} */
function files () {
  if (!fs.existsSync(path.join(ROOT, '.git'))) {
    throw new Error('not a git checkout; run inside the repository')
  }
  if (staged) {
    return git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').split('\0').filter(Boolean)
      .map(file => ({ file, read: () => git('show', `:${file}`) }))
  }
  return git('ls-files', '-co', '--exclude-standard', '-z').split('\0').filter(Boolean)
    .filter(f => fs.existsSync(path.join(ROOT, f)))
    .map(file => ({ file, read: () => fs.readFileSync(path.join(ROOT, file), 'utf8') }))
}

let findings = 0
for (const { file, read } of files()) {
  if (file === '.privacy-denylist' || file === 'package-lock.json') continue
  let text
  try {
    text = read()
  } catch {
    continue
  }
  if (text.length > 2_000_000 || text.includes('\0')) continue
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (line.includes('privacy-check: ignore')) return
    for (const rule of RULES) {
      rule.re.lastIndex = 0
      let m
      while ((m = rule.re.exec(line))) {
        if (rule.allow?.(m, line)) continue
        findings++
        const at = Math.max(0, m.index - 20)
        process.stdout.write(`${file}:${i + 1}: ${rule.name}: ...${line.slice(at, m.index + m[0].length + 20).trim()}...\n`)
      }
    }
  })
}

if (findings) {
  process.stdout.write(`\n${findings} finding(s). Replace real hosts with *.example names and 192.0.2.x, move secrets to secrets.yaml.\n`)
  process.exitCode = 1
} else {
  process.stdout.write('privacy check: clean\n')
}
