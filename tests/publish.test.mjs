// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { preflightRelease, preflightDraft } from '../scripts/publication.mjs'

test('publication refuses an existing release or tag, unknown HTTP errors and missing immutability', async () => {
  const absent = { status: 404 }
  const immutable = { status: 200, body: { enabled: true } }
  const api = async endpoint => endpoint.endsWith('/immutable-releases') ? immutable : absent
  await preflightRelease(api)
  await assert.rejects(preflightRelease(async endpoint => endpoint.includes('/releases/tags/') ? { status: 200, body: { id: 1 } } : api(endpoint)), /already exists/)
  await assert.rejects(preflightRelease(async endpoint => endpoint.includes('/git/ref/') ? { status: 200, body: {} } : api(endpoint)), /already exists/)
  await assert.rejects(preflightRelease(async () => ({ status: 503 })), /HTTP/)
  await assert.rejects(preflightRelease(async endpoint => endpoint.endsWith('/immutable-releases') ? { status: 200, body: { enabled: false } } : absent), /immutable/)
})
test('CI can prepare only a new draft without an administration token', async () => {
  const api = async endpoint => ({ status: endpoint.endsWith('/immutable-releases') ? 403 : 404 })
  await preflightDraft(api)
  await assert.rejects(preflightDraft(async endpoint => endpoint.includes('/releases/tags/') ? { status: 200, body: { draft: false } } : api(endpoint)), /already exists/)
})
