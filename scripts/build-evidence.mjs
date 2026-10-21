// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { repository } from './distribution.mjs'
export const buildJobs = ['contracts', 'mirror', 'mac (macos-15, arm64)', 'mac (macos-15-intel, x64)',
  'ffmpeg (ubuntu-24.04, linux-x64)', 'ffmpeg (ubuntu-24.04-arm, linux-arm64)', 'ffmpeg (windows-latest, win32-x64)',
  'playback (ubuntu-24.04, linux-x64)', 'playback (windows-latest, win32-x64)', 'playback (macos-15, darwin-arm64)', 'playback (macos-15-intel, darwin-x64)']
export function verifyBuildJobs(jobs) {
  for (const name of buildJobs) {
    const matches = jobs.filter(job => job.name === name)
    assert.equal(matches.length, 1, 'Missing or ambiguous build job: ' + name)
    assert.equal(matches[0].conclusion, 'success', 'Unverified build job: ' + name)
  }
  // A publication failure is recoverable, but never a failed/skipped native build.
  assert.ok(jobs.every(job => buildJobs.includes(job.name) || job.name === 'stage'))
}
export function verifiedBuildRun(runId, commit, api) {
  assert.match(String(runId), /^[1-9][0-9]+$/)
  const run = api('actions/runs/' + runId)
  assert.equal(run.event, 'workflow_dispatch'); assert.equal(run.path, '.github/workflows/distributions.yml')
  assert.equal(run.status, 'completed'); assert.equal(run.repository.full_name, repository)
  assert.match(run.head_sha, /^[a-f0-9]{40}$/)
  const jobs = api(`actions/runs/${runId}/jobs?per_page=100`)
  assert.ok(jobs.total_count < 100); verifyBuildJobs(jobs.jobs)
  const changed = execFileSync('git', ['diff', '--name-only', run.head_sha, commit, '--', 'runtimes/', 'LICENSE',
    'scripts/distribution.mjs', 'scripts/mirror.mjs', 'scripts/mac-ai-build.mjs', 'scripts/package-ai.mjs',
    'scripts/ffmpeg-build.mjs', 'scripts/archive-playback.mjs'], { encoding: 'utf8' }).trim()
  assert.equal(changed, '', 'Build inputs changed; run all native builds again')
  return { commit: run.head_sha, runId: Number(runId), conclusion: run.conclusion, verifiedJobs: buildJobs }
}
