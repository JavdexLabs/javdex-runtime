// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { aiRuntimeSources, macAiBuildCommands, refreshAiBundleInventory, verifyAiBundle } from '../scripts/mac-ai-build.mjs'
test('macOS AI recipe preserves both target architectures, static tools, embedded Metal and minimal FFmpeg', () => {
  for (const source of [aiRuntimeSources.whisper, aiRuntimeSources.ffmpeg]) { assert.match(source.sha256, /^[a-f0-9]{64}$/); assert.ok(source.bytes > 0) }
  for (const arch of ['arm64', 'x64']) {
    const commands = macAiBuildCommands(arch, '/build')
    assert.ok(commands[0][1].includes(`-DCMAKE_OSX_ARCHITECTURES=${arch === 'x64' ? 'x86_64' : 'arm64'}`))
    for (const flag of ['-DBUILD_SHARED_LIBS=OFF', '-DGGML_METAL_EMBED_LIBRARY=ON']) assert.ok(commands[0][1].includes(flag))
    for (const flag of ['--disable-autodetect', '--disable-gpl', '--disable-nonfree']) assert.ok(commands[2][1].includes(flag))
  }
  assert.throws(() => macAiBuildCommands('universal', '/build'))
})
test('macOS inventory refuses a different target, mutated bytes and missing mandatory tools', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'javdex-mac-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  for (const [id, names] of Object.entries({ whisper: ['whisper-cli', 'LICENSE'], ffmpeg: ['ffmpeg', 'ffprobe', 'COPYING.LGPLv2.1'] })) {
    await fs.mkdir(path.join(root, id)); for (const name of names) await fs.writeFile(path.join(root, id, name), name, { mode: 0o755 })
  }
  await refreshAiBundleInventory(root, 'arm64'); await verifyAiBundle(root, 'arm64', true)
  await assert.rejects(verifyAiBundle(root, 'x64'))
  await fs.appendFile(path.join(root, 'whisper/whisper-cli'), 'changed'); await assert.rejects(verifyAiBundle(root, 'arm64'))
  await fs.rm(path.join(root, 'ffmpeg/ffprobe')); await assert.rejects(refreshAiBundleInventory(root, 'arm64'))
})

test('macOS inventory rejects a non-executable CLI on POSIX', { skip: process.platform === 'win32' ? 'POSIX execution bits are unavailable' : false }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'javdex-mac-mode-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  for (const [id, names] of Object.entries({ whisper: ['whisper-cli'], ffmpeg: ['ffmpeg', 'ffprobe'] })) {
    await fs.mkdir(path.join(root, id)); for (const name of names) await fs.writeFile(path.join(root, id, name), name, { mode: 0o755 })
  }
  await refreshAiBundleInventory(root, 'arm64')
  await fs.chmod(path.join(root, 'whisper/whisper-cli'), 0o644)
  await assert.rejects(verifyAiBundle(root, 'arm64'), /not executable/)
})
