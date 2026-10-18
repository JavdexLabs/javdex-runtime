// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { smokeArgs } from '../scripts/smoke-plan.mjs'

test('short CPU smoke bounds the encoder window without skipping actual Kotoba or VAD', () => {
  for (const vad of [false, true]) {
    const { args } = smokeArgs('/scratch', vad)
    assert.equal(args[args.indexOf('-ac') + 1], '256', 'Do not encode the default 30-second window for a <=3-second fixture')
    assert.ok(args.includes('--no-gpu') && args.includes('-ojf'))
    assert.match(args[args.indexOf('-m') + 1], /kotoba\.bin$/)
    assert.equal(args.includes('--vad'), vad)
    if (vad) assert.match(args[args.indexOf('--vad-model') + 1], /vad\.bin$/)
  }
})
