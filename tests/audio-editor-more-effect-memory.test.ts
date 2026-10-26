/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudacityEffect, AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES, estimateAudacityEffectPeakBytes } from '../src/common/editor/audacity-effects/index.js';

for (const params of [{ delaySeconds: 10_000, decay: 0.5 }, { delaySeconds: 10_000, decay: 0 }]) {
	test(`Echo whose first repeat lies beyond the selection requires no history allocation with decay=${String(params.decay)}`, () => {
		const channels = [Float32Array.of(.25, .5, -.25, -.5)];
		const estimate = estimateAudacityEffectPeakBytes('audacity-echo', channels[0]!.length, params, { channelCount: 1, sampleRate: 48_000 });
		assert.ok(estimate < AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES, 'The menu memory preflight must admit this dry, four-frame result.');
		const output = applyAudacityEffect('audacity-echo', channels, 48_000, params);
		assert.deepEqual(output, channels);
		assert.notEqual(output[0], channels[0], 'The effect result owns its PCM.');
	});
}
