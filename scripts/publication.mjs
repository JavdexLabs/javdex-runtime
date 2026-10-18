// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import { recipe } from './runtime.mjs'
export const repository = 'JavdexLabs/javdex-runtime'
export async function preflightDraft(api) {
  const base = '/repos/' + repository
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
