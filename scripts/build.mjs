// SPDX-License-Identifier: GPL-3.0-or-later
import { buildWindowsVulkanRuntime } from '../runtimes/whisper/build.mjs'
console.log('Runtime built:', await buildWindowsVulkanRuntime())
