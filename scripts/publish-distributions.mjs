// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { repository, validateArtifacts, hashFile } from './distribution.mjs'
import { verifiedBuildRun } from './build-evidence.mjs'
const releases = ['ffmpeg-8.1.3-r1', 'whisper-b5130-r2', 'llama-b11435-r1', 'silero-v6.2-r1', 'playback-0.41.0-9.0.2-r1']
const gh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 ** 2 })
const api = endpoint => JSON.parse(gh(['api', '/repos/' + repository + '/' + endpoint]))
const draftByTag = tag => {
  const listing = api('releases?per_page=100'); assert.ok(listing.length < 100)
  const matches = listing.filter(r => r.tag_name === tag); assert.equal(matches.length, 1)
  return matches[0]
}
const mode = process.argv[2], commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
assert.match(commit, /^[a-f0-9]{40}$/)
if (mode === 'stage') {
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch'); assert.equal(process.env.GITHUB_REPOSITORY, repository)
  assert.equal(process.env.GITHUB_SHA, commit)
  const runId = Number(process.env.GITHUB_RUN_ID); assert.ok(Number.isSafeInteger(runId) && runId > 0)
  const nativeBuild = process.env.JAVDEX_BUILD_RUN ? verifiedBuildRun(process.env.JAVDEX_BUILD_RUN, commit, api) : { commit, runId }
  const artifacts = []
  for (const name of await fs.readdir('dist')) if (/^(mirrors|mac-.+|ffmpeg-.+|playback-.+)\.json$/.test(name)) artifacts.push(...JSON.parse(await fs.readFile(path.join('dist', name), 'utf8')))
  const expected = { 'ffmpeg-8.1.3-r1': 10, 'whisper-b5130-r2': 10, 'llama-b11435-r1': 10, 'silero-v6.2-r1': 2, 'playback-0.41.0-9.0.2-r1': 5 }
  assert.ok(artifacts.every(a => releases.includes(a.release)))
  for (const tag of releases) {
    const entries = artifacts.filter(a => a.release === tag); validateArtifacts(entries); assert.equal(entries.length, expected[tag], `Incomplete ${tag}`)
    if (tag.startsWith('ffmpeg')) assert.deepEqual(entries.filter(a => a.id === 'ffmpeg').map(a => a.target).sort(), ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'])
    if (tag.startsWith('playback')) assert.deepEqual(entries.filter(a => a.id === 'playback').map(a => a.target).sort(), ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'])
    const listing = api('releases?per_page=100'); assert.ok(listing.length < 100); assert.ok(!listing.some(r => r.tag_name === tag), 'Release already exists')
    const ref = spawnSync('gh', ['api', `/repos/${repository}/git/ref/tags/${tag}`], { encoding: 'utf8' })
    assert.notEqual(ref.status, 0, 'Tag already exists'); assert.equal(Number(JSON.parse(ref.stdout).status), 404)
    const output = path.resolve('out/publish', tag); await fs.mkdir(output, { recursive: true })
    for (const a of entries) { assert.equal((await fs.stat(path.join('dist', a.name))).size, a.bytes); assert.equal(await hashFile(path.join('dist', a.name)), a.sha256) }
    const manifest = { formatVersion: 1, version: tag, repository, commit, runId, nativeBuild, artifacts: entries.map(a => ({ ...a, url: `https://github.com/${repository}/releases/download/${tag}/${a.name}` })), retention: 'No automatic deletion. Maintainer controls end of support; preserve all consumer-pinned releases.' }
    await fs.writeFile(path.join(output, 'release.json'), JSON.stringify(manifest, null, 2) + '\n')
    await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), entries.map(a => `${a.sha256}  ${a.name}\n`).join(''))
    const body = path.join(output, 'notes.txt')
    await fs.writeFile(body, `${tag}\n\nFixed distribution for Javdex. Publication source: ${commit}\nNative build source: ${nativeBuild.commit}\nNative build run: ${nativeBuild.runId}\nCI: https://github.com/${repository}/actions/runs/${runId}\n\nSee release.json for per-artifact source, digests and verification scope. Original mirrors are byte-identical; native execution is not re-tested for mirrors or historical playback archives. New FFmpeg builds passed native CLI and WAV conversion; macOS Whisper passed native Kotoba/VAD CPU smoke. GPU inference: NOT TESTED. macOS CLI signing is ad-hoc, not Developer ID notarization.\n\nThird-party licenses remain their own. CUDA binaries retain NVIDIA terms; engine MIT licensing does not cover NVIDIA components. Models other than the small VAD auxiliary are not distributed. No automatic cleanup.\n`)
    gh(['release', 'create', tag, '--repo', repository, '--target', commit, '--draft', '--title', tag, '--notes-file', body])
    for (const file of [...entries.map(a => path.resolve('dist', a.name)), path.join(output, 'release.json'), path.join(output, 'SHA256SUMS.txt')]) gh(['release', 'upload', tag, file, '--repo', repository])
    const draft = draftByTag(tag)
    assert.equal(draft.draft, true); assert.equal(draft.target_commitish, commit)
    assert.deepEqual(draft.assets.map(a => a.name).sort(), [...entries.map(a => a.name), 'release.json', 'SHA256SUMS.txt'].sort())
    for (const a of entries) { const file = draft.assets.find(f => f.name === a.name); assert.equal(file.size, a.bytes); assert.equal(file.digest, 'sha256:' + a.sha256) }
    console.log('Verified draft:', tag)
  }
} else {
  assert.equal(mode, 'finalize'); const runId = process.argv[3]; assert.match(runId || '', /^[1-9][0-9]+$/)
  const run = api('actions/runs/' + runId)
  assert.equal(run.event, 'workflow_dispatch'); assert.equal(run.head_sha, commit); assert.equal(run.status, 'completed'); assert.equal(run.conclusion, 'success')
  assert.equal(run.path, '.github/workflows/distributions.yml')
  const jobs = api(`actions/runs/${runId}/jobs?per_page=100`); assert.ok(jobs.total_count >= 2 && jobs.total_count < 100)
  for (const name of ['contracts', 'stage']) assert.equal(jobs.jobs.find(j => j.name === name)?.conclusion, 'success')
  assert.equal(api('immutable-releases').enabled, true)
  // Check all drafts before making any public mutation.
  const drafts = []; let nativeBuild
  for (const tag of releases) {
    const draft = draftByTag(tag); assert.equal(draft.draft, true); assert.equal(draft.target_commitish, commit)
    const file = draft.assets.find(a => a.name === 'release.json'); assert.ok(file)
    const manifest = JSON.parse(gh(['api', `/repos/${repository}/releases/assets/${file.id}`, '-H', 'Accept: application/octet-stream']))
    assert.equal(manifest.commit, commit); assert.equal(manifest.runId, Number(runId)); assert.equal(manifest.version, tag); validateArtifacts(manifest.artifacts)
    if (nativeBuild) assert.deepEqual(nativeBuild, manifest.nativeBuild)
    nativeBuild = manifest.nativeBuild
    const expected = [...manifest.artifacts, { name: 'release.json' }, { name: 'SHA256SUMS.txt' }]
    assert.deepEqual(draft.assets.map(a => a.name).sort(), expected.map(a => a.name).sort())
    for (const a of manifest.artifacts) { const f = draft.assets.find(f => f.name === a.name); assert.equal(f.size, a.bytes); assert.equal(f.digest, 'sha256:' + a.sha256) }
    drafts.push(draft)
  }
  if (nativeBuild.runId !== Number(runId)) {
    assert.deepEqual(verifiedBuildRun(nativeBuild.runId, commit, api), nativeBuild)
    assert.ok(jobs.jobs.filter(j => !['contracts', 'stage'].includes(j.name)).every(j => j.conclusion === 'skipped'))
  } else { assert.ok(jobs.total_count >= 10); assert.ok(jobs.jobs.every(j => j.conclusion === 'success')) }
  for (const draft of drafts) {
    const current = api('releases/' + draft.id); assert.equal(current.draft, true)
    assert.deepEqual(current.assets.map(a => [a.id, a.name, a.size, a.digest]), draft.assets.map(a => [a.id, a.name, a.size, a.digest]))
    const reference = spawnSync('gh', ['api', `/repos/${repository}/git/ref/tags/${draft.tag_name}`], { encoding: 'utf8' })
    if (reference.status === 0) { const ref = JSON.parse(reference.stdout); assert.equal(ref.object.type, 'commit'); assert.equal(ref.object.sha, commit) }
    else assert.equal(Number(JSON.parse(reference.stdout).status), 404)
    gh(['api', `/repos/${repository}/releases/${draft.id}`, '--method', 'PATCH', '-F', 'draft=false', '-f', 'make_latest=false'])
    assert.equal(api('releases/' + draft.id).immutable, true); assert.equal(api('git/ref/tags/' + draft.tag_name).object.sha, commit); console.log('Published immutable:', `https://github.com/${repository}/releases/tag/${draft.tag_name}`)
  }
}
