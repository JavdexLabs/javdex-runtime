// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { validateArtifacts } from './distribution.mjs'

export const linuxLlamaRelease = 'llama-b11435-linux-gpu-r1'
export const linuxLlamaLocks = JSON.parse(await fs.readFile(new URL('../runtimes/distributions/linux-llama.lock.json', import.meta.url), 'utf8'))
export function validateLinuxLlamaArtifacts(artifacts) {
  validateArtifacts(artifacts)
  assert.equal(artifacts.length, linuxLlamaLocks.length)
  for (const pin of linuxLlamaLocks) {
    const artifact = artifacts.find(item => item.name === pin.name)
    assert.ok(artifact, `Missing pinned asset: ${pin.name}`)
    for (const field of ['release', 'id', 'target', 'backend', 'bytes', 'sha256']) assert.equal(artifact[field], pin[field])
    assert.equal(artifact.source, pin.url)
    assert.deepEqual(artifact.checks, { distribution: 'byte-identical', native: 'not-retested', gpu: 'not-tested' })
  }
}
