// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

export const recipe = JSON.parse(await fs.readFile(new URL('../runtimes/whisper/sources.lock.json', import.meta.url), 'utf8'))
export const payloadLimit = 256 * 1024 ** 2
const required = ['whisper-cli.exe', 'vulkan-1.dll', 'LICENSE-whisper.txt', 'LICENSE-vulkan-loader.txt', 'SOURCE.json']
const safeName = name => typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) && !name.endsWith('.')
export async function hashFile(filename) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  return hash.digest('hex')
}
async function payload(directory) {
  const result = [], names = new Set()
  let bytes = 0
  for (const name of (await fs.readdir(directory)).sort()) {
    if (name === 'runtime.json') continue
    assert.ok(safeName(name) && !names.has(name.toLowerCase()), 'Unsafe or duplicate payload name')
    names.add(name.toLowerCase())
    const filename = path.join(directory, name), stat = await fs.lstat(filename)
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Runtime payload must contain only regular files')
    bytes += stat.size
    assert.ok(bytes <= payloadLimit && result.length < 100, 'Runtime payload exceeds limits')
    result.push({ name, bytes: stat.size, sha256: await hashFile(filename) })
  }
  for (const name of required) assert.ok(result.some(file => file.name === name), `Missing runtime file: ${name}`)
  return result
}
export async function sealRuntimeDirectory(directory, provenance) {
  assert.match(provenance.commit, /^[a-f0-9]{40}$/, 'Expected full repository commit')
  assert.ok(Number.isSafeInteger(provenance.runId) && provenance.runId > 0, 'Expected actual CI run ID')
  for (const check of ['cli', 'kotoba', 'vad']) assert.equal(provenance.checks?.[check], 'passed', `Missing ${check} check`)
  assert.ok(['passed', 'not-tested'].includes(provenance.checks.gpu), 'GPU evidence must be explicit')
  const manifest = {
    formatVersion: 1, id: recipe.id, version: recipe.release, target: recipe.target, interface: recipe.interface,
    entry: 'whisper-cli.exe', upstreamVersion: recipe.upstreamVersion, upstreamCommit: recipe.upstreamCommit,
    provenance: { repository: 'JavdexLabs/javdex-runtime', commit: provenance.commit, runId: provenance.runId, toolchain: provenance.toolchain },
    checks: provenance.checks, files: await payload(directory)
  }
  await fs.writeFile(path.join(directory, 'runtime.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  return manifest
}
export async function verifyRuntimeDirectory(directory) {
  const filename = path.join(directory, 'runtime.json'), stat = await fs.lstat(filename)
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 256 * 1024, 'Invalid runtime manifest')
  const manifest = JSON.parse(await fs.readFile(filename, 'utf8'))
  assert.equal(manifest.formatVersion, 1)
  assert.equal(manifest.id, recipe.id); assert.equal(manifest.version, recipe.release)
  assert.deepEqual(manifest.target, recipe.target); assert.deepEqual(manifest.interface, recipe.interface)
  assert.equal(manifest.entry, 'whisper-cli.exe')
  assert.equal(manifest.upstreamCommit, recipe.upstreamCommit)
  assert.equal(manifest.upstreamVersion, recipe.upstreamVersion)
  assert.equal(manifest.provenance?.repository, 'JavdexLabs/javdex-runtime')
  assert.match(manifest.provenance.commit, /^[a-f0-9]{40}$/)
  assert.ok(Number.isSafeInteger(manifest.provenance.runId) && manifest.provenance.runId > 0)
  for (const check of ['cli', 'kotoba', 'vad']) assert.equal(manifest.checks?.[check], 'passed')
  assert.ok(['passed', 'not-tested'].includes(manifest.checks.gpu))
  assert.deepEqual(manifest.files, await payload(directory), 'Runtime payload differs from inventory')
  return manifest
}
