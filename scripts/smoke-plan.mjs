// SPDX-License-Identifier: GPL-3.0-or-later
import path from 'node:path'

export function smokeArgs(scratch, vad) {
  const output = path.join(scratch, vad ? 'with-vad' : 'without-vad')
  const args = ['-m', path.join(scratch, 'kotoba.bin'), '-f', path.join(scratch, vad ? 'speech-short.wav' : 'probe.wav'),
    // 256 encoder positions cover 5.12 seconds; fixtures contain at most 3 seconds.
    // Keep production build flags unchanged and exercise actual inference, not --help alone.
    '-l', 'ja', '-t', '2', '-mc', '0', '-ac', '256', '-ojf', '-of', output, '--no-gpu']
  if (vad) args.push('--vad', '--vad-model', path.join(scratch, 'vad.bin'))
  return { args, output }
}
