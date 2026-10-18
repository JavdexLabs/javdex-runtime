// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { sealRuntimeDirectory, verifyRuntimeDirectory } from '../scripts/runtime.mjs'

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'javdex-runtime-test-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  for (const name of ['whisper-cli.exe', 'vulkan-1.dll', 'LICENSE-whisper.txt', 'LICENSE-vulkan-loader.txt']) {
    await fs.writeFile(path.join(directory, name), `fixture: ${name}`)
  }
  await fs.writeFile(path.join(directory, 'SOURCE.json'), '{"fixture":true}\n')
  return directory
}
test('a fixed runtime directory verifies its target, entry and all payload bytes', async t => {
  const directory = await fixture(t)
  const manifest = await sealRuntimeDirectory(directory, {
    commit: '1234567890123456789012345678901234567890', runId: 1,
    toolchain: { fixture: true }, checks: { cli: 'passed', kotoba: 'passed', vad: 'passed', gpu: 'not-tested' }
  })
  assert.equal(manifest.version, 'whisper-b5130-r1')
  assert.deepEqual(manifest.target, { platform: 'win32', arch: 'x64', backend: 'vulkan' })
  const result = await verifyRuntimeDirectory(directory)
  assert.equal(result.entry, 'whisper-cli.exe')
  assert.equal(result.files.length, 5)
  assert.equal(result.checks.gpu, 'not-tested')
})
test('runtime verification rejects replaced payload and unlisted executable files', async t => {
  const directory = await fixture(t)
  await sealRuntimeDirectory(directory, { commit: '1234567890123456789012345678901234567890', runId: 2,
    checks: { cli: 'passed', kotoba: 'passed', vad: 'passed', gpu: 'not-tested' } })
  await fs.appendFile(path.join(directory, 'whisper-cli.exe'), 'changed')
  await assert.rejects(verifyRuntimeDirectory(directory), /inventory/)
  await fs.writeFile(path.join(directory, 'whisper-cli.exe'), 'fixture: whisper-cli.exe')
  await fs.writeFile(path.join(directory, 'injected.exe'), 'unexpected')
  await assert.rejects(verifyRuntimeDirectory(directory), /inventory/)
})
test('a symlink and a foreign target cannot be published as this runtime', async t => {
  const directory = await fixture(t)
  await sealRuntimeDirectory(directory, { commit: '1234567890123456789012345678901234567890', runId: 3,
    checks: { cli: 'passed', kotoba: 'passed', vad: 'passed', gpu: 'not-tested' } })
  const file = path.join(directory, 'runtime.json'), manifest = JSON.parse(await fs.readFile(file, 'utf8'))
  manifest.target.arch = 'arm64'
  await fs.writeFile(file, JSON.stringify(manifest))
  await assert.rejects(verifyRuntimeDirectory(directory))
  manifest.target.arch = 'x64'
  await fs.writeFile(file, JSON.stringify(manifest))
  await fs.rm(path.join(directory, 'SOURCE.json'))
  await fs.symlink(path.join(directory, 'LICENSE-whisper.txt'), path.join(directory, 'SOURCE.json'))
  await assert.rejects(verifyRuntimeDirectory(directory), /regular files/)
})
