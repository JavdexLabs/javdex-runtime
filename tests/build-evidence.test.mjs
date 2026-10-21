// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildJobs, verifyBuildJobs } from '../scripts/build-evidence.mjs'
test('publication recovery requires every original native build and contract check to pass', () => {
  const jobs = buildJobs.map(name => ({ name, conclusion: 'success' }))
  verifyBuildJobs([...jobs, { name: 'stage', conclusion: 'failure' }])
  assert.throws(() => verifyBuildJobs(jobs.slice(1)))
  assert.throws(() => verifyBuildJobs([...jobs, jobs[0]]))
  for (const conclusion of ['failure', 'skipped', 'cancelled']) assert.throws(() => verifyBuildJobs(jobs.map((j, i) => i === 2 ? { ...j, conclusion } : j)))
})
