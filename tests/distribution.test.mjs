// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { locks, validateArtifacts, downloadPinned } from '../scripts/distribution.mjs'
test('source locks are unique immutable downloads with exact identities', () => {
  validateArtifacts(locks)
  for (const a of locks) { assert.ok(a.url.startsWith('https://')); assert.ok(!a.url.includes('/latest/')) }
})
test('corrupt and oversized downloads never replace a verified cache entry', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'javdex-dist-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const bytes = Buffer.from('pinned'), asset = { name: 'tool.zip', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), url: 'https://example.invalid/tool.zip' }
  await assert.rejects(downloadPinned(asset, root, async () => new Response('changed')))
  await assert.rejects(fs.stat(path.join(root, asset.name)))
  await downloadPinned(asset, root, async () => new Response(bytes))
  await downloadPinned(asset, root, async () => { throw new Error('cache should be reused') })
  assert.deepEqual(await fs.readFile(path.join(root, asset.name)), bytes)
})
