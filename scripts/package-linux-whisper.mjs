// SPDX-License-Identifier: GPL-3.0-or-later
// Package a locally built, pinned Whisper helper; never uploads or publishes.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const [backend, buildDirectory, cudaDirectory, outputDirectory] = process.argv.slice(2)
assert.ok(['cuda', 'vulkan'].includes(backend) && buildDirectory && outputDirectory,
  'Usage: node scripts/package-linux-whisper-runtime.mjs <cuda|vulkan> <build> <CUDA-runtime-directory|-> <new-output>')
const lock = JSON.parse(fs.readFileSync('runtimes/whisper/linux/sources.lock.json'))
const output = path.resolve(outputDirectory), build = path.resolve(buildDirectory)
assert.ok(!fs.existsSync(output), 'Preserve previous runtime output')
fs.mkdirSync(output, { recursive: true })
const prefix = `whisper-${lock.version}-linux-x64-${backend}`, staged = path.join(output, prefix)
fs.mkdirSync(staged)
const sha = async file => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 8 * 1024 ** 2 })
  assert.equal(result.status, 0, result.error?.message || result.stderr); return result.stdout
}
const cache = fs.readFileSync(path.join(build, 'CMakeCache.txt'), 'utf8')
const source = cache.match(/^whisper\.cpp_SOURCE_DIR:STATIC=(.+)$/m)?.[1]
assert.ok(source, 'Missing source location')
const archive = path.join(path.dirname(source), 'whisper-b5130.tar.gz')
assert.equal(await sha(archive), lock.source.sha256)
assert.match(cache, new RegExp(`GGML_${backend.toUpperCase()}:BOOL=ON`))
assert.match(cache, /GGML_NATIVE:BOOL=OFF/)
fs.copyFileSync(path.join(build, 'bin/whisper-cli'), path.join(staged, 'whisper-cli'))
const patcher = process.env.JAVDEX_PATCHELF || 'patchelf'
run(patcher, ['--set-rpath', '$ORIGIN', path.join(staged, 'whisper-cli')])
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(staged, 'LICENSE-Whisper.txt'))
if (backend === 'vulkan') {
  const license = process.env.JAVDEX_VULKAN_LICENSE
  assert.ok(license, 'Vulkan Headers license required')
  assert.equal(await sha(license), lock.vulkanHeaders.licenseSha256)
  fs.copyFileSync(license, path.join(staged, 'LICENSE-Vulkan-Headers.txt'))
}
if (backend === 'cuda') {
  for (const name of ['libcudart.so.12', 'libcublas.so.12', 'libcublasLt.so.12']) fs.copyFileSync(path.join(cudaDirectory, name), path.join(staged, name))
  const license = process.env.JAVDEX_CUDA_LICENSE
  assert.ok(license && fs.statSync(license).size > 0, 'CUDA redistribution license required')
  fs.copyFileSync(license, path.join(staged, 'LICENSE-NVIDIA.txt'))
}
const allowed = /^(libc\.so\.6|libm\.so\.6|libgcc_s\.so\.1|libstdc\+\+\.so\.6|libgomp\.so\.1|libpthread\.so\.0|libdl\.so\.2|librt\.so\.1|libvulkan\.so\.1|libcuda\.so\.1|ld-linux-x86-64\.so\.2)$/
const elf = {}
for (const name of fs.readdirSync(staged).filter(n => n === 'whisper-cli' || n.includes('.so.'))) {
  const file = path.join(staged, name), dynamic = run('readelf', ['-dW', file])
  const needed = [...dynamic.matchAll(/\(NEEDED\).*\[([^\]]+)\]/g)].map(m => m[1])
  assert.ok(needed.every(n => allowed.test(n) || fs.existsSync(path.join(staged, n))), `Unclosed runtime: ${name}`)
  assert.ok(!fs.existsSync(path.join(staged, 'libcuda.so.1')), 'Never ship a private driver stub')
  const versions = [...run('readelf', ['--version-info', '-W', file]).matchAll(/Name: GLIBC_(\d+)\.(\d+)/g)]
  assert.ok(versions.every(m => +m[1] < 2 || +m[1] === 2 && +m[2] <= 38), 'Linux AI glibc baseline exceeded')
  elf[name] = { sha256: await sha(file), needed }
}
fs.writeFileSync(path.join(staged, 'SOURCE-BUILD.json'), JSON.stringify({ lock, backend, elf,
  cmakeCache: cache, published: false, scope: 'Local candidate; requires inference and distribution acceptance before publication' }, null, 2))
const filename = `${prefix}.tar.gz`
run('tar', ['-czf', path.join(output, filename), '-C', output, prefix])
const asset = { id: 'whisper', label: `${backend.toUpperCase()} 语音识别运行库`, backend,
  filename, archive: true, archivePrefix: prefix, expandedBytes: 3 * 1024 ** 3,
  bytes: fs.statSync(path.join(output, filename)).size, sha256: await sha(path.join(output, filename)),
  url: `https://github.com/JavdexLabs/javdex-runtime/releases/download/whisper-b5130-linux-gpu-r1/${filename}` }
fs.writeFileSync(path.join(output, 'candidate-asset.json'), JSON.stringify({ published: false, asset }, null, 2))
console.log(JSON.stringify({ output, asset }, null, 2))
