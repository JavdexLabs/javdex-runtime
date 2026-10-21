// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs/promises'
import { locks, downloadPinned, validateArtifacts } from './distribution.mjs'
validateArtifacts(locks)
const artifacts = []
const materials = JSON.parse(await fs.readFile('runtimes/distributions/mirror-materials.lock.json', 'utf8'))
for (const asset of [...locks, ...materials]) {
  await downloadPinned(asset, 'dist')
  artifacts.push({ ...asset, source: asset.url, checks: { distribution: 'byte-identical', native: 'not-retested', gpu: 'not-tested' } })
  console.log('Verified original:', asset.name)
}
await fs.writeFile('dist/mirrors.json', JSON.stringify(artifacts, null, 2) + '\n')
