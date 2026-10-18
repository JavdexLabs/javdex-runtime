// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import { recipe } from './runtime.mjs'
export const repository = 'JavdexLabs/javdex-runtime'
export function selectRuntimeDraft(releases, commit) {
  assert.ok(Array.isArray(releases) && releases.length < 100, 'Expected complete bounded release list')
  const candidates = releases.filter(release => release.tag_name === recipe.release)
  assert.equal(candidates.length, 1, 'Expected exactly one matching runtime Draft')
  assert.equal(candidates[0].draft, true); assert.equal(candidates[0].target_commitish, commit)
  return candidates[0]
}
export async function preflightDraft(api) {
  const base = '/repos/' + repository
  // A draft without a created tag is not returned by GET releases/tags/:tag.
  const listing = await api(base + '/releases?per_page=100')
  assert.equal(listing.status, 200, 'Draft query HTTP ' + listing.status)
  assert.ok(Array.isArray(listing.body) && listing.body.length < 100, 'Expected complete bounded release list')
  assert.ok(!listing.body.some(release => release.tag_name === recipe.release), 'Runtime release or draft already exists')
  for (const endpoint of [base + '/releases/tags/' + recipe.release, base + '/git/ref/tags/' + recipe.release]) {
    const response = await api(endpoint)
    if (response.status === 200) throw new Error('Runtime release or tag already exists: ' + recipe.release)
    assert.equal(response.status, 404, 'Publication preflight HTTP ' + response.status)
  }
}
export async function preflightRelease(api) {
  await preflightDraft(api)
  const settings = await api('/repos/' + repository + '/immutable-releases')
  assert.equal(settings.status, 200, 'Immutability query HTTP ' + settings.status)
  assert.equal(settings.body.enabled, true, 'Runtime releases must be immutable')
}
