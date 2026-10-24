// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs/promises'
import { locks, downloadPinned, validateArtifacts } from './distribution.mjs'
import { linuxLlamaLocks, validateLinuxLlamaArtifacts } from './linux-llama.mjs'
validateArtifacts(locks)
const artifacts = []
const materials = JSON.parse(await fs.readFile('runtimes/distributions/mirror-materials.lock.json', 'utf8'))
const selected = process.argv.includes('--linux-llama') ? linuxLlamaLocks : [...locks, ...materials]
for (const asset of selected) {
  await downloadPinned(asset, 'dist')
  artifacts.push({ ...asset, source: asset.url, checks: { distribution: 'byte-identical', native: 'not-retested', gpu: 'not-tested' } })
  console.log('Verified original:', asset.name)
}
if (process.argv.includes('--linux-llama')) validateLinuxLlamaArtifacts(artifacts)
await fs.writeFile('dist/mirrors.json', JSON.stringify(artifacts, null, 2) + '\n')
