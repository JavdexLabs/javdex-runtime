// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildMacAiRuntime, refreshAiBundleInventory, aiRuntimeSources } from './mac-ai-build.mjs'
import { descriptor, downloadPinned } from './distribution.mjs'
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', timeout: 180000, ...options })
const target = `${process.platform}-${process.arch}`, dist = path.resolve('dist')
await fs.mkdir(dist, { recursive: true })
assert.equal(process.platform, 'darwin')
const bundle = await buildMacAiRuntime()
for (const [id, names] of Object.entries({ whisper: ['whisper-cli'], ffmpeg: ['ffmpeg', 'ffprobe'] })) {
  for (const name of names) {
    run('codesign', ['--force', '--sign', '-', '--timestamp=none', path.join(bundle, id, name)])
    run('codesign', ['--verify', '--strict', path.join(bundle, id, name)])
  }
}
await refreshAiBundleInventory(bundle, process.arch)
// Native audio conversion and actual fixed Kotoba/VAD CPU inference, not GPU evidence.
const scratch = path.resolve('out/mac-smoke'); await fs.mkdir(scratch, { recursive: true })
const ffmpeg = path.join(bundle, 'ffmpeg/ffmpeg'), ffprobe = path.join(bundle, 'ffmpeg/ffprobe')
const source = path.resolve('out/ai-runtime-build/sources', aiRuntimeSources.whisper.filename)
run('tar', ['-xf', source, '-C', scratch, '--strip-components=2', 'whisper.cpp-927cfce34f31707e17f2bff35c349632fb9e2c3a/samples/jfk.wav'])
run(ffmpeg, ['-nostdin', '-v', 'error', '-i', path.join(scratch, 'jfk.wav'), '-t', '3', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', path.join(scratch, 'speech.wav')])
const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', path.join(scratch, 'speech.wav')], { encoding: 'utf8' }))
assert.equal(probe.streams[0].codec_name, 'pcm_s16le'); assert.equal(probe.streams[0].sample_rate, '16000')
const fixtures = JSON.parse(await fs.readFile('runtimes/whisper/fixtures.lock.json', 'utf8'))
for (const a of fixtures) await downloadPinned(a, scratch)
for (const vad of [false, true]) {
  const output = path.join(scratch, vad ? 'vad' : 'cpu')
  run(path.join(bundle, 'whisper/whisper-cli'), ['-m', path.join(scratch, 'kotoba.bin'), '-f', path.join(scratch, 'speech.wav'), '-l', 'ja', '-t', '2', '-mc', '0', '-ac', '256', '-ojf', '-of', output, '--no-gpu', ...(vad ? ['--vad', '--vad-model', path.join(scratch, 'vad.bin')] : [])])
  assert.ok(Array.isArray(JSON.parse(await fs.readFile(output + '.json', 'utf8')).transcription))
}
const artifacts = []
for (const id of ['whisper', 'ffmpeg']) {
  const release = id === 'whisper' ? 'whisper-b5130-r2' : 'ffmpeg-8.1.3-r1'
  const prefix = `${release}-${target}`, stage = path.resolve('out/package', prefix)
  await fs.mkdir(path.dirname(stage), { recursive: true }); await fs.cp(path.join(bundle, id), stage, { recursive: true, errorOnExist: true, force: false })
  const provenance = { repository: 'JavdexLabs/javdex-runtime', commit: process.env.GITHUB_SHA, runId: Number(process.env.GITHUB_RUN_ID), sources: aiRuntimeSources, checks: { cli: 'passed', ...(id === 'whisper' ? { kotoba: 'passed', vad: 'passed', gpu: 'not-tested' } : { audio: 'passed' }) } }
  await fs.writeFile(path.join(stage, 'SOURCE.json'), JSON.stringify(provenance, null, 2) + '\n')
  const file = path.join(dist, prefix + '.tar.gz'); run('tar', ['-czf', file, '-C', path.dirname(stage), prefix])
  artifacts.push(await descriptor(file, { release, id, target, backend: id === 'whisper' ? 'metal' : 'common', archivePrefix: prefix, source: aiRuntimeSources[id].url, checks: provenance.checks }))
}
// Preserve the exact upstream archives and complete self-contained build recipe.
const materials = path.resolve('out/mac-materials'); await fs.mkdir(materials, { recursive: true })
for (const file of ['scripts/mac-ai-build.mjs', 'scripts/package-ai.mjs', 'scripts/distribution.mjs', 'runtimes/distributions/mac-sources.lock.json', 'runtimes/distributions/assets.lock.json', 'runtimes/whisper/fixtures.lock.json', 'LICENSE']) {
  await fs.mkdir(path.dirname(path.join(materials, file)), { recursive: true }); await fs.copyFile(file, path.join(materials, file))
}
await fs.cp('out/ai-runtime-build/sources', path.join(materials, 'out/ai-runtime-build/sources'), { recursive: true })
for (const release of ['whisper-b5130-r2', 'ffmpeg-8.1.3-r1']) {
  const file = path.join(dist, `${release}-${target}-sources.tar.gz`); run('tar', ['-czf', file, '-C', materials, '.'])
  artifacts.push(await descriptor(file, { release, id: 'sources', target, checks: { sources: 'archived' } }))
}
await fs.writeFile(path.join(dist, `mac-${process.arch}.json`), JSON.stringify(artifacts, null, 2) + '\n')
