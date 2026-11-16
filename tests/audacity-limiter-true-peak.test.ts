/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudacityLimiter } from '../src/common/editor/audacity-effects/basic.js';
import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';
import { audacityLiveEffectLatencyFrames, audacityLiveEffectTailFrames } from '../src/common/editor/audacity-effects/live-capabilities.js';
import { audacityEffectDefaults, normalizeAudacityEffectParams } from '../src/common/editor/audacity-effects/manifest.js';
import { analyzeAudioChannels } from '../src/common/editor/analysis.js';
import { LimiterLiveProcessor } from '../src/common/editor/audacity-effects/limiter-live-processor.ts';
import { truePeakLimiterScratchBytes } from '../src/common/editor/audacity-effects/true-peak-limiter-parameters.ts';

const params = { thresholdDb: 0, makeupTargetDb: -1, kneeWidthDb: 0, lookaheadMs: 1, releaseMs: 20 };

function render(input: Float32Array[], rate: number, blockSize: number, limitTruePeaks = true, lookaheadMs = 1): Float32Array[] {
	const processor = createAudacityLiveProcessor('audacity-limiter', rate, { ...params, limitTruePeaks, lookaheadMs });
	const length = input[0]!.length;
	const result = input.map(() => new Float32Array(length));
	for (let offset = 0; offset < length + processor.latencyFrames; offset += blockSize) {
		const count = Math.min(blockSize, length + processor.latencyFrames - offset);
		const source = input.map(channel => {
			const block = new Float32Array(count);
			if (offset < length) block.set(channel.subarray(offset, offset + count));
			return block;
		});
		const output = source.map(() => new Float32Array(count));
		processor.process(source, output);
		for (let channel = 0; channel < output.length; channel++) {
			const start = Math.max(0, processor.latencyFrames - offset);
			if (start < count) result[channel]!.set(output[channel]!.subarray(start), Math.max(0, offset - processor.latencyFrames));
		}
	}
	return result;
}

test('true peak limiting is opt in and normalizes persisted boolean parameters', () => {
	assert.equal(audacityEffectDefaults('audacity-limiter').limitTruePeaks, false);
	const normalized = normalizeAudacityEffectParams('audacity-limiter', { limitTruePeaks: 'true' }) as Record<string, unknown>;
	assert.equal(normalized.limitTruePeaks, true);
});

for (const rate of [44_100, 48_000, 96_000]) {
	test(`upsampling catches intersample peaks before limiting at ${rate} Hz`, () => {
		const input = [Float32Array.from({ length: 8192 }, (_, frame) => 1.2 * Math.sin(frame * Math.PI / 2 + Math.PI / 4))];
		const sampleLimited = applyAudacityLimiter(input, rate, params);
		const trueLimited = applyAudacityLimiter(input, rate, { ...params, limitTruePeaks: true });
		const peak = (channels: Float32Array[]) => analyzeAudioChannels(channels.map(channel => channel.subarray(1024, -1024)), rate).truePeakDbtp;
		assert.ok(peak(sampleLimited) > -.5, 'fixture must exceed the output ceiling between samples');
		assert.ok(peak(trueLimited) <= -.85, `true peak output: ${peak(trueLimited)} dBTP`);
		assert.equal(trueLimited[0]!.length, input[0]!.length);
	});
}

test('live and selection true peak limiting agree across block boundaries and retain stereo linking', () => {
	const left = Float32Array.from({ length: 4097 }, (_, frame) => frame % 509 < 200 ? Math.sin(frame * 1.4) * 1.3 : 0);
	left[left.length - 1] = .8;
	const input = [left, Float32Array.from(left, value => value * .25)];
	const expected = applyAudacityLimiter(input, 44_100, { ...params, limitTruePeaks: true });
	for (const blockSize of [1, 37, 128, 511]) {
		const actual = render(input, 44_100, blockSize);
		for (let frame = 0; frame < left.length; frame++) {
			assert.ok(Math.abs(actual[0]![frame]! - expected[0]![frame]!) < 2e-6, `block ${blockSize}, frame ${frame}`);
			assert.ok(Math.abs(actual[1]![frame]! - actual[0]![frame]! * .25) < 2e-6);
		}
	}
});

test('true peak latency includes both resampling filters, aligns impulses and declares their release', () => {
	const input = [new Float32Array(1024)]; input[0]![200] = .1;
	for (const [rate, lookaheadMs, expectedLatency] of [[44_100, 1, 76], [44_100, .1, 36], [48_000, .1, 36], [48_000, 0, 32]] as const) {
		const latency = audacityLiveEffectLatencyFrames('audacity-limiter', rate, { ...params, lookaheadMs, limitTruePeaks: true });
		assert.equal(latency, expectedLatency);
		assert.ok(audacityLiveEffectTailFrames('audacity-limiter', rate, { limitTruePeaks: true }) > 0);
		const output = render(input, rate, 37, true, lookaheadMs)[0]!;
		assert.equal(output.indexOf(Math.max(...output)), 200);
	}
});

test('enabled limiter edits retain queued audio and reset clears both resampling histories', () => {
	const settings = { ...params, limitTruePeaks: true };
	const edited = new LimiterLiveProcessor(48_000, settings);
	const unchanged = new LimiterLiveProcessor(48_000, settings);
	const input = [Float32Array.from({ length: 128 }, (_, frame) => .2 * Math.sin(frame * .2))];
	const actual = [new Float32Array(128)]; const expected = [new Float32Array(128)];
	edited.process(input, actual); unchanged.process(input, expected);
	edited.updateParams({ releaseMs: 300 });
	const silence = [new Float32Array(128)];
	edited.process(silence, actual); unchanged.process(silence, expected);
	assert.deepEqual(actual, expected);
	assert.equal(edited.readAnalysis()?.frames, 256);
	assert.equal(edited.readAnalysis(), null);
	edited.reset(); edited.process(silence, actual);
	assert.ok(actual[0]!.every(value => value === 0));
	edited.updateParams({ limitTruePeaks: false });
	assert.equal(edited.latencyFrames, 48);
	edited.updateParams({ limitTruePeaks: true });
	assert.equal(edited.latencyFrames, 80);
	assert.ok(truePeakLimiterScratchBytes(50, 192_000, 32) > 5_000_000);
});
