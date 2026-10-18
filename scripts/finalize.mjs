// SPDX-License-Identifier: GPL-3.0-or-later
// Runs with the operator's existing gh authentication, never a new PAT in CI.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { recipe } from './runtime.mjs'
import { repository } from './publication.mjs'

const [commit, runId] = process.argv.slice(2)
assert.match(commit || '', /^[a-f0-9]{40}$/)
assert.match(runId || '', /^[1-9][0-9]{0,15}$/)
const gh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 4 * 1024 ** 2 })
const json = endpoint => JSON.parse(gh(['api', '/repos/' + repository + '/' + endpoint]))
const run = JSON.parse(gh(['run', 'view', runId, '--repo', repository, '--json', 'headSha,status,conclusion,jobs']))
assert.equal(run.headSha, commit); assert.equal(run.status, 'completed'); assert.equal(run.conclusion, 'success')
assert.ok(run.jobs.length >= 3 && run.jobs.every(job => job.conclusion === 'success'))
assert.equal(json('immutable-releases').enabled, true, 'Enable immutable releases before publishing')
const draft = json('releases/tags/' + recipe.release)
assert.equal(draft.draft, true); assert.equal(draft.target_commitish, commit)
const names = [recipe.release + '-win32-x64-vulkan.zip', 'release.json', 'SHA256SUMS.txt']
assert.deepEqual(draft.assets.map(asset => asset.name).sort(), [...names].sort())
const descriptor = draft.assets.find(asset => asset.name === 'release.json')
const release = JSON.parse(gh(['api', '/repos/' + repository + '/releases/assets/' + descriptor.id, '-H', 'Accept: application/octet-stream']))
assert.equal(release.formatVersion, 1); assert.equal(release.commit, commit); assert.equal(release.runId, Number(runId))
assert.equal(release.version, recipe.release); assert.equal(release.id, recipe.id)
assert.deepEqual(release.target, recipe.target); assert.deepEqual(release.interface, recipe.interface)
assert.equal(release.artifacts.length, 1)
const file = release.artifacts[0], zip = draft.assets.find(asset => asset.name === names[0])
assert.equal(file.name, zip.name); assert.equal(file.bytes, zip.size); assert.equal('sha256:' + file.sha256, zip.digest)
assert.equal(file.url, 'https://github.com/' + repository + '/releases/download/' + recipe.release + '/' + file.name)
for (const check of ['cli', 'kotoba', 'vad']) assert.equal(release.checks[check], 'passed')
assert.ok(['passed', 'not-tested'].includes(release.checks.gpu))
// Recheck identity immediately before the sole public mutation.
const current = json('releases/' + draft.id)
assert.equal(current.draft, true)
assert.deepEqual(current.assets.map(asset => [asset.id, asset.name, asset.size, asset.digest]), draft.assets.map(asset => [asset.id, asset.name, asset.size, asset.digest]))
const { spawnSync } = await import('node:child_process')
const reference = spawnSync('gh', ['api', '/repos/' + repository + '/git/ref/tags/' + recipe.release], { encoding: 'utf8' })
if (reference.status === 0) {
  const object = JSON.parse(reference.stdout).object
  assert.equal(object.type, 'commit'); assert.equal(object.sha, commit, 'Tag changed before publication')
} else assert.equal(JSON.parse(reference.stdout || '{}').status, 404, 'Unexpected tag query failure')
gh(['release', 'edit', recipe.release, '--repo', repository, '--draft=false', '--latest=false'])
const published = json('releases/' + draft.id)
assert.equal(published.draft, false); assert.equal(published.immutable, true)
assert.equal(published.target_commitish, commit)
assert.equal(json('git/ref/tags/' + recipe.release).object.sha, commit)
console.log('Published immutable runtime:', published.html_url)
