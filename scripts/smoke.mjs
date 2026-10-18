// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { hashFile, recipe } from './runtime.mjs'

const execute = promisify(execFile)
assert.equal(process.platform, 'win32', 'Run the native smoke on Windows')
assert.equal(process.arch, 'x64')
const root = process.cwd(), scratch = await fs.mkdtemp(path.join(root, 'out/smoke-'))
const executable = path.join(root, 'out/ai-runtime/win32-x64-vulkan/whisper/whisper-cli.exe')
const systemRoot = process.env.SystemRoot || 'C:/Windows'
const env = { SystemRoot: systemRoot, WINDIR: systemRoot, PATH: path.join(systemRoot, 'System32'),
  TEMP: scratch, TMP: scratch, USERPROFILE: process.env.USERPROFILE }
const help = await execute(executable, ['--help'], { cwd: scratch, env, timeout: 30000, maxBuffer: 2 ** 20, windowsHide: true })
for (const option of ['--vad', '--vad-model', '--device', '--no-gpu', '--output-json-full']) {
  assert.ok((help.stdout + help.stderr).includes(option), 'Missing CLI capability: ' + option)
}
const models = JSON.parse(await fs.readFile(new URL('../runtimes/whisper/fixtures.lock.json', import.meta.url), 'utf8'))
for (const asset of models) assert.match(asset.sha256, /^[a-f0-9]{64}$/)
for (const asset of models) {
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(600000) })
  assert.ok(response.ok && response.body, 'Model fixture download failed: ' + asset.name)
  const file = await fs.open(path.join(scratch, asset.name), 'wx')
  let received = 0
  try { for await (const chunk of response.body) {
    received += chunk.length; assert.ok(received <= asset.bytes, 'Model fixture too large'); await file.write(chunk)
  } } finally { await file.close() }
  assert.equal(received, asset.bytes); assert.equal(await hashFile(path.join(scratch, asset.name)), asset.sha256)
}
const samples = 8000, wav = Buffer.alloc(44 + samples * 2)
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40)
for (let index = 0; index < samples; index++) wav.writeInt16LE(Math.round(200 * Math.sin(index * Math.PI / 40)), 44 + index * 2)
const input = path.join(scratch, 'probe.wav')
await fs.writeFile(input, wav)
// The pinned upstream archive also contains a real speech fixture for the VAD path.
// It stays in the CI scratch directory, never in the distributed runtime.
const sourceArchive = path.join(root, 'out/ai-runtime-build/windows-vulkan-tools/sources', recipe.source.filename)
assert.equal(await hashFile(sourceArchive), recipe.source.sha256)
await execute('tar.exe', ['-xf', sourceArchive, '-C', scratch, '--strip-components=2',
  'whisper.cpp-' + recipe.upstreamCommit + '/samples/jfk.wav'], { cwd: scratch, env, timeout: 30000, windowsHide: true })
const speech = await fs.readFile(path.join(scratch, 'jfk.wav'))
assert.equal(speech.toString('ascii', 0, 4), 'RIFF'); assert.equal(speech.toString('ascii', 8, 12), 'WAVE')
let pcm, format
for (let offset = 12; offset + 8 <= speech.length;) {
  const length = speech.readUInt32LE(offset + 4), start = offset + 8
  assert.ok(start + length <= speech.length, 'Invalid fixed speech fixture')
  const id = speech.toString('ascii', offset, offset + 4)
  if (id === 'fmt ') format = speech.subarray(start, start + length)
  if (id === 'data') pcm = speech.subarray(start, start + Math.min(length, 16000 * 2 * 3))
  offset = start + length + (length % 2)
}
assert.ok(format && pcm && pcm.length > 0)
assert.equal(format.readUInt16LE(0), 1); assert.equal(format.readUInt16LE(2), 1)
assert.equal(format.readUInt32LE(4), 16000); assert.equal(format.readUInt16LE(14), 16)
const voiced = Buffer.alloc(44 + pcm.length)
wav.copy(voiced, 0, 0, 44); pcm.copy(voiced, 44)
voiced.writeUInt32LE(voiced.length - 8, 4); voiced.writeUInt32LE(pcm.length, 40)
await fs.writeFile(path.join(scratch, 'speech-short.wav'), voiced)
for (const vad of [false, true]) {
  const output = path.join(scratch, vad ? 'with-vad' : 'without-vad')
  const args = ['-m', path.join(scratch, 'kotoba.bin'), '-f', vad ? path.join(scratch, 'speech-short.wav') : input,
    '-l', 'ja', '-t', '2', '-mc', '0', '-ojf', '-of', output, '--no-gpu']
  if (vad) args.push('--vad', '--vad-model', path.join(scratch, 'vad.bin'))
  await execute(executable, args, { cwd: scratch, env, timeout: 180000, maxBuffer: 4 * 2 ** 20, windowsHide: true })
  const json = JSON.parse(await fs.readFile(output + '.json', 'utf8'))
  assert.ok(Array.isArray(json.transcription), 'Expected full transcription JSON')
}
await fs.writeFile(path.join(root, 'out/smoke.json'), JSON.stringify({
  cli: 'passed', kotoba: 'passed', vad: 'passed', gpu: 'not-tested',
  scope: 'Native Windows CLI, actual pinned Kotoba/VAD, synthetic local audio, forced CPU; no physical GPU acceptance'
}, null, 2) + '\n')
console.log('Native CLI and pinned Kotoba/VAD smoke passed; physical GPU inference NOT tested.')
await fs.rm(scratch, { recursive: true, force: true })
