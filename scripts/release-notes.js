#!/usr/bin/env node
// Prints the CHANGELOG.md section of a version, which the release workflow uses as the notes of the GitHub release:
//   node scripts/release-notes.js <version> [link base]
// Relative links are prefixed with the link base (the repository at the release tag), since a release page resolves them
// against its own URL. A version without a section exits with 1, so a release cannot go out without its changelog.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Returns the body of the `## [version]` section, or null when the changelog has none.
 * @param {string} changelog the whole CHANGELOG.md
 * @param {string} version such as 0.2.0
 * @param {string} [base] prefixed to relative links, such as https://github.com/owner/repo/blob/v0.2.0
 */
export function releaseNotes (changelog, version, base) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex(line => line.startsWith(`## [${version}]`))
  if (start === -1) return null
  // the section ends at the next version, or at the link definitions at the bottom of the file
  let end = lines.findIndex((line, i) => i > start && (line.startsWith('## ') || /^\[[^\]]+\]: /.test(line)))
  if (end === -1) end = lines.length
  const body = lines.slice(start + 1, end).join('\n').trim()
  if (!base) return body
  return body.replace(/\]\((?![a-z][a-z0-9+.-]*:|#|\/)([^)\s]+)\)/gi, (_, target) => `](${base.replace(/\/$/, '')}/${target.replace(/^\.\//, '')})`)
}

/** @param {string[]} argv */
function main (argv) {
  const [version, base] = argv
  if (!version) {
    console.error('usage: release-notes.js <version> [link base]')
    return 2
  }
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md')
  const notes = releaseNotes(fs.readFileSync(file, 'utf8'), version, base)
  if (notes === null || notes === '') {
    console.error(`CHANGELOG.md has no section for ${version}: add "## [${version}] - <date>" with what changed`)
    return 1
  }
  console.log(notes)
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) process.exit(main(process.argv.slice(2)))
