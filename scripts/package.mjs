// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { recipe, hashFile, sealRuntimeDirectory, verifyRuntimeDirectory } from './runtime.mjs'
import { verifyWindowsVulkanBundle } from '../runtimes/whisper/build.mjs'

assert.equal(process.platform, 'win32', 'Create this native package on Windows')
const execute = promisify(execFile), root = process.cwd()
const bundle = path.join(root, 'out/ai-runtime/win32-x64-vulkan')
const build = await verifyWindowsVulkanBundle(bundle)
const checks = JSON.parse(await fs.readFile(path.join(root, 'out/smoke.json'), 'utf8'))
const stage = await fs.mkdtemp(path.join(root, 'out/package-'))
for (const entry of build.assets.whisper.files) await fs.copyFile(path.join(bundle, 'whisper', entry.name), path.join(stage, entry.name), 1)
await fs.writeFile(path.join(stage, 'SOURCE.json'), JSON.stringify({
  upstream: { version: recipe.upstreamVersion, commit: recipe.upstreamCommit, archive: recipe.source },
  buildTools: recipe.buildTools, recipe: 'runtimes/whisper/build.mjs',
  repository: 'https://github.com/JavdexLabs/javdex-runtime', commit: process.env.GITHUB_SHA,
  originalRecipe: 'https://github.com/JavdexLabs/Javdex/blob/bb843322112d536380ec7587c8569cc80680e733/scripts/windows-vulkan-runtime.mjs'
}, null, 2) + '\n')
await sealRuntimeDirectory(stage, { commit: process.env.GITHUB_SHA, runId: Number(process.env.GITHUB_RUN_ID), toolchain: build.toolchain, checks })
const manifest = await verifyRuntimeDirectory(stage)
for (const name of ['whisper-cli.exe', 'vulkan-1.dll']) {
  const bytes = await fs.readFile(path.join(stage, name))
  assert.equal(bytes.toString('ascii', 0, 2), 'MZ')
  const pe = bytes.readUInt32LE(0x3c)
  assert.ok(pe >= 64 && pe + 26 <= bytes.length)
  assert.equal(bytes.readUInt32LE(pe), 0x00004550)
  assert.equal(bytes.readUInt16LE(pe + 4), 0x8664)
  assert.equal(bytes.readUInt16LE(pe + 24), 0x20b)
  assert.equal(!!(bytes.readUInt16LE(pe + 22) & 0x2000), name.endsWith('.dll'))
}
const output = path.join(root, 'dist')
await fs.mkdir(output, { recursive: true })
const name = recipe.release + '-win32-x64-vulkan.zip', archive = path.join(output, name)
await assert.rejects(fs.stat(archive), { code: 'ENOENT' })
await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  'Compress-Archive -Path (Join-Path $env:RUNTIME_STAGE "*") -DestinationPath $env:RUNTIME_ARCHIVE -CompressionLevel Optimal'],
{ env: { ...process.env, RUNTIME_STAGE: stage, RUNTIME_ARCHIVE: archive }, timeout: 180000, windowsHide: true })
const extracted = await fs.mkdtemp(path.join(root, 'out/roundtrip-'))
await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  'Expand-Archive -LiteralPath $env:RUNTIME_ARCHIVE -DestinationPath $env:RUNTIME_EXTRACTED'],
{ env: { ...process.env, RUNTIME_ARCHIVE: archive, RUNTIME_EXTRACTED: extracted }, timeout: 180000, windowsHide: true })
await verifyRuntimeDirectory(extracted)
const bytes = (await fs.stat(archive)).size, sha256 = await hashFile(archive)
assert.ok(bytes > 0 && bytes <= 128 * 1024 ** 2, 'Compressed runtime exceeds limit')
const release = { formatVersion: 1, id: recipe.id, version: recipe.release, target: recipe.target, interface: recipe.interface,
  repository: 'JavdexLabs/javdex-runtime', commit: process.env.GITHUB_SHA, runId: Number(process.env.GITHUB_RUN_ID),
  artifacts: [{ name, bytes, sha256, expandedBytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0) + 1024 * 1024,
    url: 'https://github.com/JavdexLabs/javdex-runtime/releases/download/' + recipe.release + '/' + name }],
  checks }
await fs.writeFile(path.join(output, 'release.json'), JSON.stringify(release, null, 2) + '\n', { flag: 'wx' })
await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), sha256 + '  ' + name + '\n', { flag: 'wx' })
console.log(JSON.stringify(release, null, 2))
