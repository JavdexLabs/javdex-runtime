// SPDX-License-Identifier: GPL-3.0-or-later
// Offline build entry point. Dependencies must already exist; never installs system packages.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
const [backend, sourceDirectory, buildDirectory] = process.argv.slice(2)
assert.ok(process.platform === 'linux' && process.arch === 'x64')
assert.ok(['cuda', 'vulkan'].includes(backend) && sourceDirectory && buildDirectory,
  'Usage: node scripts/build-linux-whisper-runtime.mjs <cuda|vulkan> <source> <new-build>')
const lock = JSON.parse(fs.readFileSync('runtimes/whisper/linux/sources.lock.json'))
const source = path.resolve(sourceDirectory), build = path.resolve(buildDirectory)
assert.ok(!fs.existsSync(build), 'Use a new build directory to preserve previous builds')
const archive = path.join(path.dirname(source), lock.source.filename)
assert.equal(createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), lock.source.sha256)
for (const name of ['CC', 'CXX', 'JAVDEX_CMAKE', 'JAVDEX_NINJA']) assert.ok(process.env[name], `${name} is required`)
const run = args => {
  const result = spawnSync(process.env.JAVDEX_CMAKE, args, { stdio: 'inherit', env: {
    ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(source)
  } })
  assert.equal(result.status, 0, result.error?.message || 'CMake failed')
}
const args = ['-S', source, '-B', build, '-G', 'Ninja',
  `-DCMAKE_MAKE_PROGRAM=${process.env.JAVDEX_NINJA}`, '-DCMAKE_BUILD_TYPE=Release',
  '-DBUILD_SHARED_LIBS=OFF', '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_FFMPEG=OFF',
  '-DGGML_NATIVE=OFF', '-DGGML_AVX=OFF', '-DGGML_AVX2=OFF', '-DGGML_FMA=OFF',
  '-DGGML_F16C=OFF', '-DGGML_BMI2=OFF', '-DGGML_SSE42=OFF',
  `-DGGML_CUDA=${backend === 'cuda' ? 'ON' : 'OFF'}`,
  `-DGGML_VULKAN=${backend === 'vulkan' ? 'ON' : 'OFF'}`]
if (backend === 'cuda') {
  assert.ok(process.env.CUDAToolkit_ROOT, 'Pinned CUDA toolkit required')
  args.push(`-DCUDAToolkit_ROOT=${process.env.CUDAToolkit_ROOT}`,
    `-DCMAKE_CUDA_COMPILER=${process.env.CUDAToolkit_ROOT}/bin/nvcc`,
    `-DCMAKE_CUDA_HOST_COMPILER=${process.env.CXX}`, '-DGGML_CUDA_NCCL=OFF',
    `-DCMAKE_CUDA_ARCHITECTURES=${lock.cudaArchitectures.join(';')}`)
} else {
  for (const name of ['Vulkan_INCLUDE_DIR', 'Vulkan_LIBRARY', 'Vulkan_GLSLC_EXECUTABLE', 'SPIRV_HEADERS_INCLUDE']) {
    assert.ok(process.env[name], `${name} required`)
  }
  for (const name of ['Vulkan_INCLUDE_DIR', 'Vulkan_LIBRARY', 'Vulkan_GLSLC_EXECUTABLE']) args.push(`-D${name}=${process.env[name]}`)
  args.push(`-DCMAKE_CXX_FLAGS=-I${process.env.SPIRV_HEADERS_INCLUDE}`)
}
run(args)
run(['--build', build, '--target', 'whisper-cli', '--parallel', process.env.JAVDEX_BUILD_JOBS || '4'])
