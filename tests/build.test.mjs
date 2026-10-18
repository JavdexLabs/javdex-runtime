// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { zstdCompressSync } from 'node:zlib'
import { extractWindowsVulkanTool, windowsVulkanCommands } from '../runtimes/whisper/build.mjs'

test('pinned build materials are completely decoded before tar and extraction errors propagate', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-extract-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  await fs.mkdir(path.join(directory, 'input')); await fs.mkdir(path.join(directory, 'output'))
  await fs.writeFile(path.join(directory, 'input', 'header.h'), 'fixed header\n')
  const tar = path.join(directory, 'input.tar'), archive = path.join(directory, 'input.pkg.tar.zst')
  assert.equal(spawnSync('tar', ['-cf', tar, '-C', path.join(directory, 'input'), 'header.h']).status, 0)
  const decoded = await fs.readFile(tar)
  await fs.writeFile(archive, zstdCompressSync(decoded))
  let temporary
  await extractWindowsVulkanTool(archive, path.join(directory, 'output'), directory, async (_command, args) => {
    temporary = args[1]
    assert.deepEqual(await fs.readFile(temporary), decoded)
    assert.equal(spawnSync('tar', args).status, 0)
  })
  assert.equal(await fs.readFile(path.join(directory, 'output/header.h'), 'utf8'), 'fixed header\n')
  await assert.rejects(fs.stat(temporary), { code: 'ENOENT' })
  await assert.rejects(extractWindowsVulkanTool(archive, directory, directory, async (_command, args) => {
    temporary = args[1]; throw new Error('native tar failed')
  }), /native tar failed/)
  await assert.rejects(fs.stat(temporary), { code: 'ENOENT' })
})
test('build recipe keeps Vulkan and baseline CPU fallback without CUDA or development DLLs', () => {
  const configure = windowsVulkanCommands('/source', '/build', '/sdk', 'Visual Studio 17 2022')[0]
  for (const flag of ['-DGGML_VULKAN=ON', '-DGGML_CUDA=OFF', '-DBUILD_SHARED_LIBS=OFF', '-DGGML_NATIVE=OFF', '-DGGML_AVX2=OFF', '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded']) assert.ok(configure.includes(flag))
})
