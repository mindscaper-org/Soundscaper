/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DESKTOP_EXPECTED_RUNTIME_FILES } from '../scripts/lib/desktop-project-library-expected-runtime-files.mjs';

test('desktop staging admits the complete real-time AI denoising compiler closure exactly once', () => {
	for (const member of [
		'config/assistance-sherpa-gpu-build.json',
		'config/assistance-sherpa-retained-builds.json',
		'desktop/ai-denoise-helper-process.js',
		'desktop/ai-denoise-kernel.js',
		'desktop/ai-denoise-model.js',
		'desktop/ai-denoise-preload.js',
		'desktop/ai-denoise-sessions.js',
		'desktop/assistance-native-runtime-payload.mjs',
		'src/common/editor/effect-parameter-validation.js',
		'src/common/editor/first-party-effects/ai-denoise/contract.js',
		'src/common/editor/resample-geometry.js',
	]) {
		assert.equal(DESKTOP_EXPECTED_RUNTIME_FILES.filter(file => file === member).length, 1, member);
	}
});
