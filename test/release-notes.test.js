import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { releaseNotes } from '../scripts/release-notes.js'

const changelog = `# Changelog

## [Unreleased]

## [0.2.0] - 2026-11-01

### Added

- **Graphs.** See [the views](docs/reference/VIEWS.md#stats), [Keep a Changelog](https://keepachangelog.com/) and [below](#fixed).

### Fixed

- A [relative](./README.md) link.

## [0.1.0] - 2026-10-13

The first public version.

[Unreleased]: https://github.com/owner/repo/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/owner/repo/releases/tag/v0.2.0
`

test('release notes are the section of the version, without its heading or the next one', () => {
  const notes = releaseNotes(changelog, '0.2.0')
  assert.ok(notes?.startsWith('### Added'))
  assert.ok(notes?.endsWith('- A [relative](./README.md) link.'))
  assert.equal(releaseNotes(changelog, '0.1.0'), 'The first public version.')
})

test('relative links point at the repository, other links stay as they are', () => {
  const notes = releaseNotes(changelog, '0.2.0', 'https://github.com/owner/repo/blob/v0.2.0/') ?? ''
  assert.match(notes, /\[the views\]\(https:\/\/github\.com\/owner\/repo\/blob\/v0\.2\.0\/docs\/reference\/VIEWS\.md#stats\)/)
  assert.match(notes, /\[relative\]\(https:\/\/github\.com\/owner\/repo\/blob\/v0\.2\.0\/README\.md\)/)
  assert.match(notes, /\[Keep a Changelog\]\(https:\/\/keepachangelog\.com\/\)/)
  assert.match(notes, /\[below\]\(#fixed\)/)
})

test('a version without a section has no notes', () => {
  assert.equal(releaseNotes(changelog, '0.3.0'), null)
  assert.equal(releaseNotes(changelog.replace(/\n/g, '\r\n'), '0.1.0'), 'The first public version.')
})

test('the current version of package.json has a section in CHANGELOG.md', () => {
  const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(releaseNotes(fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), version))
})
