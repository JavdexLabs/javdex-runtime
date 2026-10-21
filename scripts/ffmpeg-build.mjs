// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { descriptor, downloadPinned } from './distribution.mjs'
const lock = JSON.parse(await fs.readFile('runtimes/distributions/mac-sources.lock.json', 'utf8')).ffmpeg
const root = process.cwd(), target = `${process.platform}-${process.arch}`, release = 'ffmpeg-8.1.3-r1'
assert.ok(['win32-x64', 'linux-x64', 'linux-arm64'].includes(target))
const source = await downloadPinned({ ...lock, name: lock.filename }, path.resolve('out/ffmpeg-sources'))
const work = path.resolve('out/ffmpeg-build'), prefix = `${release}-${target}`, stage = path.resolve('out/package', prefix)
await fs.mkdir(work, { recursive: true }); await fs.mkdir(stage, { recursive: true }); await fs.mkdir('dist', { recursive: true })
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'"
const posix = s => s.replaceAll('\\', '/').replace(/^([A-Za-z]):\//, (_, d) => '/' + d.toLowerCase() + '/')
function run(command, args, cwd = work, capture = false) {
  const windows = process.platform === 'win32'
  return execFileSync(windows ? 'bash.exe' : command, windows ? ['--noprofile', '--norc', '-c', [command, ...args].map(s => quote(posix(s))).join(' ')] : args,
    { cwd, stdio: capture ? 'pipe' : 'inherit', encoding: capture ? 'utf8' : undefined, timeout: 1200000 })
}
run('tar', ['-xf', source, '-C', work, '--strip-components=1'])
const configure = ['--disable-autodetect', '--disable-gpl', '--disable-nonfree', '--disable-shared', '--enable-static', '--disable-doc', '--disable-debug', '--disable-x86asm', '--disable-avdevice', '--disable-encoders', '--enable-encoder=pcm_s16le', '--disable-muxers', '--enable-muxer=wav', ...(process.platform === 'win32' ? ['--target-os=mingw32', '--arch=x86_64', '--extra-ldflags=-static', '--enable-schannel'] : [])]
run('./configure', configure); run('make', ['-j', '4', 'ffmpeg', 'ffprobe'])
const bin = process.platform === 'linux' ? path.join(stage, 'bin') : stage
await fs.mkdir(bin, { recursive: true })
for (const name of ['ffmpeg', 'ffprobe']) {
  const filename = name + (process.platform === 'win32' ? '.exe' : '')
  await fs.copyFile(path.join(work, filename), path.join(bin, filename)); await fs.chmod(path.join(bin, filename), 0o755)
  run(path.join(bin, filename), ['-version'], root)
  if (process.platform === 'win32') {
    const imports = run('objdump', ['-p', path.join(bin, filename)], root, true)
    for (const match of imports.matchAll(/DLL Name:\s*(\S+)/g)) assert.ok(!/(?:libgcc|libstdc|libwinpthread)/i.test(match[1]), `Non-system DLL: ${match[1]}`)
  }
}
const wav = Buffer.alloc(44 + 16000 * 2); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(32000, 40)
const input = path.join(work, 'probe.wav'), output = path.join(work, 'output.wav'); await fs.writeFile(input, wav)
const ext = process.platform === 'win32' ? '.exe' : ''
run(path.join(bin, 'ffmpeg' + ext), ['-nostdin', '-v', 'error', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', output])
const streams = JSON.parse(run(path.join(bin, 'ffprobe' + ext), ['-v', 'error', '-show_streams', '-of', 'json', output], root, true)).streams
assert.equal(streams[0].codec_name, 'pcm_s16le'); assert.equal(streams[0].sample_rate, '16000')
await fs.copyFile(path.join(work, 'COPYING.LGPLv2.1'), path.join(stage, 'COPYING.LGPLv2.1'))
await fs.writeFile(path.join(stage, 'SOURCE.json'), JSON.stringify({ repository: 'JavdexLabs/javdex-runtime', commit: process.env.GITHUB_SHA, runId: Number(process.env.GITHUB_RUN_ID), source: lock, configure, compiler: run(process.platform === 'win32' ? 'gcc' : 'cc', ['--version'], work, true), checks: { cli: 'passed', audio: 'passed' } }, null, 2) + '\n')
const file = path.resolve('dist', prefix + (process.platform === 'win32' ? '.zip' : '.tar.gz'))
if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Compress-Archive -Path $env:JAVDEX_STAGE -DestinationPath $env:JAVDEX_ZIP'], { env: { ...process.env, JAVDEX_STAGE: stage, JAVDEX_ZIP: file } })
else execFileSync('tar', ['-czf', file, '-C', path.dirname(stage), prefix])
const artifacts = [await descriptor(file, { release, id: 'ffmpeg', target, backend: 'common', archivePrefix: prefix, source: lock.url, checks: { cli: 'passed', audio: 'passed' } })]
const materials = path.resolve('out/ffmpeg-materials'); await fs.mkdir(materials, { recursive: true })
for (const name of ['scripts/ffmpeg-build.mjs', 'scripts/distribution.mjs', 'runtimes/distributions/mac-sources.lock.json', 'runtimes/distributions/assets.lock.json', 'LICENSE']) {
  await fs.mkdir(path.dirname(path.join(materials, name)), { recursive: true }); await fs.copyFile(name, path.join(materials, name))
}
await fs.cp('out/ffmpeg-sources', path.join(materials, 'out/ffmpeg-sources'), { recursive: true })
const src = path.resolve('dist', `${release}-${target}-sources.tar.gz`); run('tar', ['-czf', src, '-C', materials, '.'], root)
artifacts.push(await descriptor(src, { release, id: 'sources', target, checks: { sources: 'archived' } }))
await fs.writeFile(`dist/ffmpeg-${target}.json`, JSON.stringify(artifacts, null, 2) + '\n')
