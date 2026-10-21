// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { downloadPinned, descriptor, hashFile } from './distribution.mjs'
const target = `${process.platform}-${process.arch}`, release = 'playback-0.41.0-9.0.2-r1'
const lock = JSON.parse(await fs.readFile('runtimes/distributions/playback.lock.json', 'utf8'))
const asset = lock.find(a => a.target === target); assert.ok(asset)
const installer = await downloadPinned(asset, path.resolve('out/playback-inputs'))
const scratch = path.resolve('out/playback-extract'); await fs.mkdir(scratch, { recursive: true }); await fs.mkdir('dist', { recursive: true })
let runtime
if (process.platform === 'darwin') {
  const mount = path.join(scratch, 'mount'); await fs.mkdir(mount)
  execFileSync('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, installer])
  try {
    const app = (await fs.readdir(mount)).filter(n => n.endsWith('.app')); assert.equal(app.length, 1)
    const source = path.join(mount, app[0], 'Contents/Resources/native-playback')
    runtime = path.join(scratch, 'native-playback'); await fs.cp(source, runtime, { recursive: true })
  } finally { execFileSync('hdiutil', ['detach', mount]) }
} else if (process.platform === 'win32') {
  execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath $env:JAVDEX_INPUT -DestinationPath $env:JAVDEX_EXPAND'], { env: { ...process.env, JAVDEX_INPUT: installer, JAVDEX_EXPAND: scratch } })
  runtime = path.join(scratch, 'resources/native-playback')
} else {
  await fs.chmod(installer, 0o755)
  execFileSync(installer, ['--appimage-extract'], { cwd: scratch, stdio: 'ignore', timeout: 120000 })
  runtime = path.join(scratch, 'squashfs-root/resources/native-playback')
}
const inventory = JSON.parse(await fs.readFile(path.join(runtime, 'runtime.json'), 'utf8'))
assert.ok(inventory)
const files = []
async function walk(directory, prefix = '') {
  for (const name of (await fs.readdir(directory)).sort()) {
    const file = path.join(directory, name), stat = await fs.lstat(file)
    assert.ok(!stat.isSymbolicLink(), 'Playback archive must not introduce links')
    if (stat.isDirectory()) await walk(file, prefix + name + '/')
    else { assert.ok(stat.isFile()); files.push({ name: prefix + name, bytes: stat.size, sha256: await hashFile(file) }) }
  }
}
await walk(runtime)
const prefix = `${release}-${target}`, stage = path.resolve('out/playback-package', prefix)
await fs.mkdir(path.dirname(stage), { recursive: true }); await fs.cp(runtime, stage, { recursive: true })
await fs.writeFile(path.join(stage, 'ARCHIVE-PROVENANCE.json'), JSON.stringify({ source: asset, repository: 'JavdexLabs/javdex-runtime', commit: process.env.GITHUB_SHA, runId: Number(process.env.GITHUB_RUN_ID), files, checks: { distribution: 'extracted-from-verified-installer', native: 'not-retested', gpu: 'not-tested' } }, null, 2) + '\n')
const file = path.resolve('dist', prefix + '.tar.gz'); execFileSync('tar', ['-czf', file, '-C', path.dirname(stage), prefix])
const artifacts = [await descriptor(file, { release, id: 'playback', target, source: asset.url, sourceSha256: asset.sha256, checks: { distribution: 'extracted-from-verified-installer', native: 'not-retested', gpu: 'not-tested' } })]
if (target === 'linux-x64') {
  const source = lock.find(a => a.target === 'sources'), sourceFile = await downloadPinned(source, path.resolve('out/playback-inputs'))
  const output = path.resolve('dist', release + '-sources.tar.gz'); await fs.copyFile(sourceFile, output)
  artifacts.push(await descriptor(output, { release, id: 'sources', target: 'all', source: source.url, sourceSha256: source.sha256, checks: { distribution: 'byte-identical' } }))
}
await fs.writeFile(`dist/playback-${target}.json`, JSON.stringify(artifacts, null, 2) + '\n')
