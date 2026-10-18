// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { preflightRelease, repository } from './publication.mjs'
import { recipe, hashFile } from './runtime.mjs'

const token = process.env.GITHUB_TOKEN
async function api(endpoint, options = {}) {
  const response = await fetch('https://api.github.com' + endpoint, {
    ...options, signal: AbortSignal.timeout(60000),
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json', ...options.headers }
  })
  return { status: response.status, body: await response.json() }
}
await preflightRelease(api)
if (process.argv[2] === 'preflight') { console.log('Fixed release absent; immutable releases enabled.'); process.exit(0) }
assert.equal(process.argv[2], 'publish')
assert.ok(token, 'Publishing requires the CI repository token')
assert.equal(process.env.GITHUB_REPOSITORY, repository)
assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch')
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
assert.equal(process.env.GITHUB_SHA, commit, 'Checkout must match the run source')
const output = path.resolve('dist'), release = JSON.parse(await fs.readFile(path.join(output, 'release.json'), 'utf8'))
assert.equal(release.commit, commit); assert.equal(release.version, recipe.release)
assert.equal(release.runId, Number(process.env.GITHUB_RUN_ID))
assert.deepEqual(release.target, recipe.target); assert.deepEqual(release.interface, recipe.interface)
assert.equal(release.artifacts.length, 1)
const artifact = release.artifacts[0]
assert.equal(artifact.name, recipe.release + '-win32-x64-vulkan.zip')
assert.equal((await fs.stat(path.join(output, artifact.name))).size, artifact.bytes)
assert.equal(await hashFile(path.join(output, artifact.name)), artifact.sha256)
const sums = await fs.readFile(path.join(output, 'SHA256SUMS.txt'), 'utf8')
assert.equal(sums, artifact.sha256 + '  ' + artifact.name + '\n')
const draft = await api('/repos/' + repository + '/releases', { method: 'POST', body: JSON.stringify({
  tag_name: recipe.release, target_commitish: commit, name: 'Whisper b5130 Windows x64 Vulkan r1',
  draft: true, prerelease: false, make_latest: 'false',
  body: 'Fixed-source Whisper Vulkan runtime for Javdex.\n\nSource: ' + commit +
    '\nCI run: https://github.com/' + repository + '/actions/runs/' + release.runId +
    '\n\nNative Windows CLI and pinned Kotoba/VAD CPU smoke passed. Physical GPU inference: NOT TESTED.\nModel weights, drivers and the development SDK are not included.\nSee release.json for the actual archive digest and size.'
}) })
assert.equal(draft.status, 201, 'Cannot create draft release')
for (const name of [artifact.name, 'release.json', 'SHA256SUMS.txt']) {
  const bytes = await fs.readFile(path.join(output, name))
  const response = await fetch(draft.body.upload_url.split('{')[0] + '?name=' + encodeURIComponent(name), {
    method: 'POST', signal: AbortSignal.timeout(300000), headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream' }, body: bytes
  })
  assert.equal(response.status, 201, 'Cannot upload ' + name)
  const asset = await response.json()
  assert.equal(asset.size, bytes.length)
  assert.equal(asset.digest, 'sha256:' + await hashFile(path.join(output, name)))
}
const listing = await api('/repos/' + repository + '/releases/' + draft.body.id + '/assets')
assert.equal(listing.status, 200)
assert.deepEqual(listing.body.map(asset => asset.name).sort(), [artifact.name, 'release.json', 'SHA256SUMS.txt'].sort())
const result = await api('/repos/' + repository + '/releases/' + draft.body.id, { method: 'PATCH', body: JSON.stringify({ draft: false, make_latest: 'false' }) })
assert.equal(result.status, 200); assert.equal(result.body.immutable, true, 'Release must be immutable')
console.log('Published fixed runtime:', result.body.html_url)
