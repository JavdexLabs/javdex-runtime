// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
export const repository = 'JavdexLabs/javdex-runtime'
export const locks = JSON.parse(await fs.readFile(new URL('../runtimes/distributions/assets.lock.json', import.meta.url), 'utf8'))
export const safeName = name => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) && !name.endsWith('.')
export async function hashFile(file) {
  const h = createHash('sha256'); for await (const chunk of createReadStream(file)) h.update(chunk); return h.digest('hex')
}
export async function downloadPinned(asset, directory, fetcher = fetch) {
  assert.ok(safeName(asset.name)); assert.match(asset.sha256, /^[a-f0-9]{64}$/)
  assert.ok(Number.isSafeInteger(asset.bytes) && asset.bytes > 0)
  await fs.mkdir(directory, { recursive: true })
  const file = path.join(directory, asset.name), partial = file + '.part'
  try { if ((await fs.stat(file)).size === asset.bytes && await hashFile(file) === asset.sha256) return file } catch { /* Download absent cache. */ }
  const retainedSource = path.resolve('runtimes/distributions/source-cache', asset.name)
  try {
    if ((await fs.stat(retainedSource)).size === asset.bytes && await hashFile(retainedSource) === asset.sha256) {
      await fs.copyFile(retainedSource, partial); await fs.rename(partial, file); return file
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const response = await fetcher(asset.url, { signal: AbortSignal.timeout(600000) })
  assert.ok(response.ok && response.body, `Download failed: ${asset.name} HTTP ${response.status}`)
  const output = await fs.open(partial, 'w'); let bytes = 0
  try {
    for await (const chunk of response.body) { bytes += chunk.byteLength; assert.ok(bytes <= asset.bytes, 'Download exceeds pinned size'); await output.write(chunk) }
  } finally { await output.close() }
  assert.equal(bytes, asset.bytes); assert.equal(await hashFile(partial), asset.sha256)
  await fs.rename(partial, file); return file
}
export async function descriptor(file, metadata) {
  const name = path.basename(file); assert.ok(safeName(name))
  return { ...metadata, name, bytes: (await fs.stat(file)).size, sha256: await hashFile(file) }
}
export function validateArtifacts(artifacts) {
  assert.ok(artifacts.length > 0)
  const names = new Set()
  for (const a of artifacts) {
    assert.ok(safeName(a.name) && !names.has(a.name.toLowerCase()), 'Unsafe or duplicate asset')
    names.add(a.name.toLowerCase()); assert.match(a.sha256, /^[a-f0-9]{64}$/)
    assert.ok(Number.isSafeInteger(a.bytes) && a.bytes > 0)
    assert.ok(safeName(a.release))
  }
}
