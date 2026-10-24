// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { linuxLlamaRelease, linuxLlamaLocks, validateLinuxLlamaArtifacts } from '../scripts/linux-llama.mjs'

const artifacts = () => linuxLlamaLocks.map(pin => ({ ...pin, source: pin.url,
  checks: { distribution: 'byte-identical', native: 'not-retested', gpu: 'not-tested' } }))

test('Linux llama mirrors include exactly the three fixed binaries, upstream source and CUDA terms', () => {
  validateLinuxLlamaArtifacts(artifacts())
  assert.equal(linuxLlamaLocks.length, 5)
  assert.ok(linuxLlamaLocks.every(pin => pin.release === linuxLlamaRelease))
  assert.deepEqual(linuxLlamaLocks.filter(pin => pin.target === 'linux-x64').map(pin => `${pin.id}-${pin.backend}`).sort(),
    ['cuda-cuda', 'translator-cuda', 'translator-vulkan'])
  assert.ok(linuxLlamaLocks.some(pin => pin.id === 'sources' && pin.url.endsWith('/43fe9c64281ef735046adc025e9e7559a1f659a5')))
  assert.ok(linuxLlamaLocks.some(pin => pin.id === 'license' && pin.url.includes('/12.8.1/')))
})

test('Linux llama publication rejects missing, extra, changed or misattributed artifacts and invented GPU checks', () => {
  assert.throws(() => validateLinuxLlamaArtifacts(artifacts().slice(1)))
  assert.throws(() => validateLinuxLlamaArtifacts([...artifacts(), { ...artifacts()[0], name: 'extra.tar.gz' }]))
  for (const [field, value] of [['sha256', '0'.repeat(64)], ['bytes', 1], ['release', 'llama-b11435-r1'],
    ['target', 'win32-x64'], ['backend', 'cpu'], ['source', 'https://example.invalid/changed'],
    ['checks', { distribution: 'byte-identical', native: 'passed', gpu: 'passed' }]]) {
    const changed = artifacts(); changed[0][field] = value
    assert.throws(() => validateLinuxLlamaArtifacts(changed), field)
  }
})
