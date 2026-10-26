/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prepareScheduledParameterAudioParamWindowTiming } from '../src/common/editor/engine/scheduled-parameter-audio-param-time-projector.ts';
import { ScheduledParameterRegistry } from '../src/common/editor/engine/scheduled-parameter-registry.ts';
import { collectAudioParamTimingReceipt } from './helpers/responsiveness-round4-audio-param-parity.ts';

test('AudioParam timing preparation returns scalar data without a per-event projector', () => {
	const prepared = prepareScheduledParameterAudioParamWindowTiming({
		contextStartTime: 1, fromFrame: 37, sampleRate: 44_100, transportRate: 1.2,
	});
	assert.deepEqual(prepared, { contextStartTime: 1, fromFrame: 37, framesPerSecond: 44_100 * 1.2 });
});

test('one AudioParam window reads fixed timing inputs once for one thousand events', () => {
	const reads = { contextStartTime: 0, fromFrame: 0, sampleRate: 0, transportRate: 0 };
	const options = {
		get contextStartTime() { reads.contextStartTime += 1; return 1; },
		get fromFrame() { reads.fromFrame += 1; return 37; },
		get sampleRate() { reads.sampleRate += 1; return 44_100; },
		get transportRate() { reads.transportRate += 1; return 1.2; },
	};
	const { contextStartTime, fromFrame, framesPerSecond } = prepareScheduledParameterAudioParamWindowTiming(options);
	for (let frame = 37; frame < 1037; frame += 1) {
		assert.equal(contextStartTime + (32 / 48_000 + (frame - fromFrame) / framesPerSecond),
			1 + (32 / 48_000 + (frame - 37) / (44_100 * 1.2)));
	}
	assert.deepEqual(reads, { contextStartTime: 1, fromFrame: 1, sampleRate: 1, transportRate: 1 });
});

test('actual AudioParam bindings retain all frozen original calls, bits, errors and continuing-window cancellation', () => {
	const fixture: unknown = JSON.parse(readFileSync(new URL('./fixtures/responsiveness-round4-audio-param-parity.json', import.meta.url), 'utf8'));
	assert.deepEqual(collectAudioParamTimingReceipt(() => new ScheduledParameterRegistry()), fixture);
});
