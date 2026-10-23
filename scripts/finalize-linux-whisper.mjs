// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { verifyRelease, repository, tag } from './verify-linux-whisper.mjs'
const [commit, runId] = process.argv.slice(2)
assert.match(commit || '', /^[a-f0-9]{40}$/); assert.match(runId || '', /^[1-9][0-9]+$/)
const gh = args => execFileSync('gh', args, {encoding:'utf8', maxBuffer:8*1024**2})
const api = suffix => JSON.parse(gh(['api', `repos/${repository}/${suffix}`]))
const run = api(`actions/runs/${runId}`)
assert.equal(run.head_sha, commit); assert.equal(run.conclusion, 'success'); assert.equal(run.status, 'completed')
assert.equal(run.path, '.github/workflows/linux-whisper.yml')
const jobs = api(`actions/runs/${runId}/jobs`).jobs
assert.deepEqual(jobs.map(j=>j.name).sort(), ['candidate','contracts'])
assert.ok(jobs.every(j=>j.conclusion === 'success'))
assert.equal(api('immutable-releases').enabled, true)
const releases = api('releases?per_page=100'); assert.ok(releases.length<100)
const draft = releases.find(r=>r.tag_name===tag); assert.ok(draft)
const pins = JSON.parse(fs.readFileSync('runtimes/whisper/linux/assets.lock.json'))
verifyRelease(draft,commit,pins)
const descriptor = draft.assets.find(a=>a.name==='release.json')
const release = JSON.parse(gh(['api', `repos/${repository}/releases/assets/${descriptor.id}`, '-H','Accept: application/octet-stream']))
assert.equal(release.commit,commit);assert.equal(release.tag,tag);assert.deepEqual(release.artifacts,pins)
// A successful candidate job checked all bytes. Recheck immutable GitHub identities before publication.
const current = api(`releases/${draft.id}`); verifyRelease(current,commit,pins)
assert.deepEqual(current.assets.map(a=>[a.id,a.name,a.size,a.digest]),draft.assets.map(a=>[a.id,a.name,a.size,a.digest]))
const reference = api(`git/ref/tags/${tag}`);assert.equal(reference.object.type,'commit');assert.equal(reference.object.sha,commit)
gh(['api',`repos/${repository}/releases/${draft.id}`,'--method','PATCH','-F','draft=false','-f','make_latest=false'])
const published=api(`releases/${draft.id}`);assert.equal(published.draft,false);assert.equal(published.immutable,true)
assert.equal(api(`git/ref/tags/${tag}`).object.sha,commit)
console.log(published.html_url)
