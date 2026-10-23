// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
export const tag = 'whisper-b5130-linux-gpu-r1'
export const repository = 'JavdexLabs/javdex-runtime'
export async function verifyFile(file, expected) {
  assert.equal((await fs.stat(file)).size, expected.bytes)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  assert.equal(hash.digest('hex'), expected.sha256)
}
export function verifyRelease(release, commit, pins) {
  assert.equal(release.tag_name, tag); assert.equal(release.target_commitish, commit)
  assert.equal(release.draft, true)
  assert.deepEqual(release.assets.map(a => a.name).sort(), [...pins.map(a => a.name), 'release.json', 'SHA256SUMS.txt'].sort())
  for (const pin of pins) {
    const asset = release.assets.find(a => a.name === pin.name)
    assert.equal(asset.size, pin.bytes); assert.equal(asset.digest, 'sha256:' + pin.sha256)
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [commit, directory] = process.argv.slice(2)
  assert.match(commit || '', /^[a-f0-9]{40}$/); assert.ok(directory)
  const pins = JSON.parse(await fs.readFile('runtimes/whisper/linux/assets.lock.json', 'utf8'))
  const gh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 ** 2 })
  const releases = JSON.parse(gh(['api', `repos/${repository}/releases?per_page=100`]))
  assert.ok(releases.length < 100)
  const release = releases.find(r => r.tag_name === tag); assert.ok(release)
  verifyRelease(release, commit, pins)
  await fs.mkdir(directory, { recursive: true })
  gh(['release', 'download', tag, '--repo', repository, '--dir', directory])
  for (const pin of pins) await verifyFile(path.join(directory, pin.name), pin)
  const descriptor = JSON.parse(await fs.readFile(path.join(directory, 'release.json'), 'utf8'))
  assert.equal(descriptor.commit, commit); assert.equal(descriptor.tag, tag)
  assert.deepEqual(descriptor.artifacts, pins)
  assert.equal(descriptor.nativeEvidence.scope, 'local-physical-gpu')
  assert.equal(descriptor.nativeEvidence.kotoba, 'passed'); assert.equal(descriptor.nativeEvidence.vad, 'passed')
  for (const pin of pins.filter(p => p.backend)) {
    const target = path.join(directory, pin.backend); await fs.mkdir(target)
    execFileSync('tar', ['-xzf', path.join(directory, pin.name), '--strip-components=1', '-C', target])
    const source = JSON.parse(await fs.readFile(path.join(target, 'SOURCE-BUILD.json'), 'utf8'))
    assert.equal(source.backend, pin.backend)
    assert.equal(source.lock.commit, '927cfce34f31707e17f2bff35c349632fb9e2c3a')
    for (const [name, entry] of Object.entries(source.elf)) {
      const file = path.join(target, name), hash = createHash('sha256')
      for await (const chunk of createReadStream(file)) hash.update(chunk)
      assert.equal(hash.digest('hex'), entry.sha256)
      const header = execFileSync('readelf', ['-h', file], { encoding: 'utf8' })
      assert.match(header, /Advanced Micro Devices X86-64/)
    }
    assert.ok(!source.elf['libcuda.so.1'])
  }
  console.log('Published-candidate bytes, source pins, ELF inventories verified; CI does not claim physical GPU inference.')
}
