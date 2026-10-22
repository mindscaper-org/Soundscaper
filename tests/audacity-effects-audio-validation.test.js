import assert from 'node:assert/strict';
import test from 'node:test';

import { applyAudacityAmplify } from '../src/common/editor/audacity-effects/basic.js';
import { applyAudacityEcho } from '../src/common/editor/audacity-effects/realtime.js';

const invalidInputs = [
	{ channels: [], sampleRate: 48_000, message: /non-empty array/u },
	{ channels: [new Float64Array(1)], sampleRate: 48_000, message: /Float32Array/u },
	{
		channels: [new Float32Array(1), new Float32Array(2)],
		sampleRate: 48_000,
		message: /same length/u,
	},
	{ channels: [new Float32Array(1)], sampleRate: 0, message: /sampleRate/u },
	{ channels: [new Float32Array(1)], sampleRate: Number.NaN, message: /sampleRate/u },
];

test('basic and realtime Audacity effects reject unusable PCM inputs', () => {
	for (const { channels, sampleRate, message } of invalidInputs) {
		assert.throws(() => applyAudacityAmplify(channels, sampleRate), message);
		assert.throws(() => applyAudacityEcho(channels, sampleRate), message);
	}
});
