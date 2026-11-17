/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runStreamedSelectionProcessing } from '../src/common/editor/streamed-effects/processing.ts';
import { canStreamSelectionEffect } from '../src/common/editor/streamed-effects/admission.ts';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects.js';
import { initializePffft } from '../src/common/editor/pffft.js';

const sampleRate = 48_000;
const input = Array.from({ length: 2 }, (_, channel) => Float32Array.from({ length: 140_003 }, (_, frame) =>
	.2 * Math.sin(frame * (.037 + channel * .013)) + (frame % 997 === channel ? .4 : .01)));
const cases: readonly (readonly [string, Readonly<Record<string, unknown>>])[] = [
	['audacity-normalize', { peakDb: -3, removeDc: true }],
	['audacity-loudness-normalization', { mode: 'rms', targetRmsDb: -16 }],
	['audacity-amplify', { gainDb: 18, allowClipping: false }], ['audacity-remove-dc-offset', {}],
	['audacity-fade-in', {}], ['audacity-fade-out', {}], ['audacity-invert', {}], ['audacity-bass-treble', { bassDb: 4, trebleDb: -3 }],
	['audacity-distortion', { mode: 'cubic', dcBlock: true }], ['audacity-echo', { delaySeconds: .01, decay: .4 }],
	['audacity-phaser', { stages: 8 }], ['audacity-wahwah', {}],
	['audacity-classic-filters', { order: 7, family: 'chebyshev-ii' }], ['audacity-reverb', {}],
	['audacity-compressor', { lookaheadMs: 10 }], ['audacity-limiter', { lookaheadMs: 10 }],
	['lowpass-filter', { frequency: 3000, rolloff: 24 }], ['notch-filter', { frequency: 60 }], ['shelf-filter', { gain: -6 }],
	['vocoder', { bands: 12 }], ['multi-tap-delay', { time: .01, echoes: 3, pitchShift: 0 }],
	['highpass-filter', { frequency: 80, rolloff: 24 }], ['tremolo', {}], ['hum-removal', {}],
	['noise-gate', {}], ['deesser', {}], ['multiband-compressor', {}], ['bitcrusher', { dither: 'shaped', downsampling: 3 }],
	['audacity-filter-curve-eq', { filterLength: 8191, points: [{ frequency: 20, gain: 6 }, { frequency: 20000, gain: -6 }] }],
];
await initializePffft();
for (const [type, params] of cases) test(`streamed ${type} retains complete-selection PCM with irregular final chunks`, async () => {
	assert.equal(canStreamSelectionEffect(type, params), true);
	const expected = await applyAudioSelectionEffectAsync(type, input, sampleRate, params);
	const actual = input.map(channel => new Float32Array(channel.length));
	let offset = 0, largestRead = 0;
	await runStreamedSelectionProcessing({ effects: [{ type, params }], sampleRate, channelCount: 2, frameCount: input[0]!.length }, {
		assertCurrent: () => undefined,
		read: async (start, end) => { largestRead = Math.max(largestRead, end - start); return input.map(channel => channel.slice(start, end)); },
		write: async channels => { assert.ok(channels[0]!.length <= 65536); channels.forEach((channel, index) => actual[index]!.set(channel, offset)); offset += channels[0]!.length; },
	});
	assert.ok(largestRead <= 65536);
	assert.equal(offset, input[0]!.length);
	assert.deepEqual(actual, expected);
});

test('stream admission preserves offline Echo ranges and rejects unsupported duration/spectral jobs', () => {
	assert.equal(canStreamSelectionEffect('audacity-echo', { delaySeconds: 20, decay: 1 }), true);
	assert.equal(canStreamSelectionEffect('audacity-reverse', {}), false);
	assert.equal(canStreamSelectionEffect('audacity-legacy-compressor', {}), false);
});

test('streamed processing rejects malformed reads and observes cancellation between writes', async () => {
	const request = { effects: [{ type: 'audacity-invert', params: {} }], sampleRate, channelCount: 2, frameCount: 140003 };
	await assert.rejects(runStreamedSelectionProcessing(request, { assertCurrent: () => undefined,
		read: async () => [new Float32Array(1)], write: async () => undefined }), /PCM|channel|length|geometry/iu);
	let stopped = false, writes = 0;
	await assert.rejects(runStreamedSelectionProcessing(request, { assertCurrent: () => { if (stopped) throw new Error('cancelled'); },
		read: async (start, end) => input.map(channel => channel.slice(start, end)),
		write: async () => { writes++; stopped = true; } }), /cancelled/u);
	assert.equal(writes, 1);
});

test('finite click removal retains the offline last-window rule, including an impulse near the selection end', async () => {
	const channels = Array.from({ length: 2 }, (_, channel) => Float32Array.from({ length: 20003 }, (_, f) => .0001 * Math.sin(f * (.12 + channel * .03))));
	for (const channel of channels) for (let f = 1000; f < channel.length; f += 2500) channel[f] = 1;
	const expected = await applyAudioSelectionEffectAsync('audacity-click-removal', channels, sampleRate, {});
	const actual = channels.map(channel => new Float32Array(channel.length)); let offset = 0;
	await runStreamedSelectionProcessing({ effects: [{ type: 'audacity-click-removal', params: {} }], sampleRate, channelCount: 2, frameCount: channels[0]!.length }, {
		assertCurrent: () => undefined, read: async (start, end) => channels.map(channel => channel.slice(start, end)),
		write: async chunk => { chunk.forEach((channel, c) => actual[c]!.set(channel, offset)); offset += chunk[0]!.length; },
	});
	assert.deepEqual(actual, expected);
});

for (const frames of [17, 4097, 65539]) test(`noise reduction preserves finite edges and temporal smoothing at ${frames} frames`, async () => {
	const { captureAudacityNoiseProfile } = await import('../src/common/editor/audacity-effects/spectral.js');
	let seed = 17; const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 - .5; };
	const profile = captureAudacityNoiseProfile([Float32Array.from({ length: 8192 }, () => noise() * .1)], sampleRate);
	const channels = [Float32Array.from({ length: frames }, (_, f) => noise() * .01 + (f > frames - 300 ? Math.sin(f * .037) * .2 : 0))];
	const params = { reductionDb: 30, sensitivity: 8, frequencySmoothingBands: 6 };
	const expected = await applyAudioSelectionEffectAsync('audacity-noise-reduction', channels, sampleRate, params, { noiseProfile: profile });
	const actual = new Float32Array(frames); let offset = 0;
	await runStreamedSelectionProcessing({ effects: [{ type: 'audacity-noise-reduction', params, context: { noiseProfile: profile } }], sampleRate, channelCount: 1, frameCount: frames }, {
		assertCurrent: () => undefined, read: async (start, end) => channels.map(channel => channel.slice(start, end)),
		write: async chunk => { actual.set(chunk[0]!, offset); offset += chunk[0]!.length; },
	});
	assert.deepEqual(actual, expected[0]);
});

test('stream memory admission charges Echo history beyond one packet and skips out-of-selection delays', async () => {
	const { streamedEffectPeakBytes } = await import('../src/common/editor/streamed-effects/memory.ts');
	const estimate = (delaySeconds: number) => streamedEffectPeakBytes([{ type: 'audacity-echo', params: { delaySeconds, decay: .5 } }], 48000 * 600, 2, 48000);
	assert.ok(estimate(300) > estimate(20) + 100 * 1024 ** 2);
	assert.ok(estimate(601) < estimate(20));
});

test('Auto Duck streams its detector and finishes an active region at the finite selection boundary', async () => {
	const frames = 24003, rate = 8000, program = [new Float32Array(frames).fill(.5)], detector = [new Float32Array(frames)];
	detector[0]!.fill(.5, 1300, 5000); detector[0]!.fill(.5, frames - 2300);
	const params = { maximumPause: .2, outerFadeDown: .1, outerFadeUp: .1, innerFadeDown: .05, innerFadeUp: .05 };
	const expected = await applyAudioSelectionEffectAsync('audacity-auto-duck', program, rate, params, { controlChannels: detector });
	const actual = new Float32Array(frames); let offset = 0;
	await runStreamedSelectionProcessing({ effects: [{ type: 'audacity-auto-duck', params }], sampleRate: rate, channelCount: 1, frameCount: frames }, {
		assertCurrent: () => undefined, read: async (start, end) => program.map(channel => channel.slice(start, end)),
		readControl: async (start, end) => detector.map(channel => channel.slice(start, end)),
		write: async chunk => { actual.set(chunk[0]!, offset); offset += chunk[0]!.length; },
	});
	assert.deepEqual(actual, expected[0]);
});
