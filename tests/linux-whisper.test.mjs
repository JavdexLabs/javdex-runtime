// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyRelease, tag } from '../scripts/verify-linux-whisper.mjs'
const commit = 'a'.repeat(40), pins = [{ name: 'test.tar.gz', bytes: 12, sha256: 'b'.repeat(64) }]
const make = () => ({ tag_name: tag, target_commitish: commit, draft: true, assets: [
  { name: 'test.tar.gz', size: 12, digest: 'sha256:' + 'b'.repeat(64) }, { name: 'release.json' }, { name: 'SHA256SUMS.txt' }
] })
test('Linux publication requires exact Draft source and artifact identities', () => {
  verifyRelease(make(), commit, pins)
  for (const change of [r => r.draft = false, r => r.target_commitish = 'c'.repeat(40),
    r => r.assets[0].size++, r => r.assets[0].digest = 'sha256:' + 'c'.repeat(64), r => r.assets.push({name:'extra'})]) {
    const release = make(); change(release); assert.throws(() => verifyRelease(release, commit, pins))
  }
})
