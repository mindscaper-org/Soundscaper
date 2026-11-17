/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareStreamedNormalization } from '../src/common/editor/audacity-effects/streamed-normalization.ts';
import { applyAudacityNormalize, applyAudacityLoudnessNormalization } from '../src/common/editor/audacity-effects/basic.js';

const sampleRate = 8_000;
const input = (channels: number, frames = 16_137) => Array.from({ length: channels }, (_, channel) =>
	Float32Array.from({ length: frames }, (_, frame) => channel === 3 ? 0 :
		.08 * (channel + 1) * Math.sin(frame * .31) + .02 * Math.cos(frame * .007) + .03));

for (const channelCount of [1, 2, 6]) for (const independent of [false, true]) {
	for (const mode of ['lufs', 'rms']) test(`streamed normalization matches one-shot ${channelCount} channels, ${mode}, independent=${independent}`, async () => {
		const channels = input(channelCount), original = channels.map(channel => channel.slice());
		const effects = [
			{ type: 'audacity-normalize', params: { peakDb: 0, removeDc: true, applyGain: true, stereoIndependent: false } },
			{ type: 'audacity-loudness-normalization', params: { mode, targetLufs: -16, targetRmsDb: -1, dualMono: true, stereoIndependent: independent } },
		];
		const expected = applyAudacityLoudnessNormalization(applyAudacityNormalize(channels, sampleRate, effects[0]!.params), sampleRate, effects[1]!.params);
		const output = channels.map(channel => new Float32Array(channel.length));
		let largestRead = 0;
		const stream = await prepareStreamedNormalization({ effects, sampleRate, frameCount: channels[0]!.length,
			channelCount, chunkFrames: 997, assertCurrent: () => undefined,
			read: async (start, end) => { largestRead = Math.max(largestRead, end - start); return channels.map(channel => channel.subarray(start, end)); } });
		let offset = 0;
		for await (const chunk of stream()) {
			chunk.forEach((channel, index) => output[index]!.set(channel, offset)); offset += chunk[0]!.length;
		}
		assert.equal(offset, channels[0]!.length);
		assert.equal(largestRead, 997);
		assert.deepEqual(output, expected, 'chunk boundaries must preserve DC, Float32 rounding, filters and loudness gating');
		assert.deepEqual(channels, original, 'borrowed source PCM stays unchanged');
	});
}

test('streamed normalization handles silence, short clips and disabled peak/DC normalization', async () => {
	for (const channels of [[new Float32Array(137)], input(2, 137)]) {
		const effects = [{ type: 'audacity-normalize', params: { removeDc: false, applyGain: false } },
			{ type: 'audacity-loudness-normalization', params: { targetLufs: -16, dualMono: false } }];
		const expected = applyAudacityLoudnessNormalization(channels, sampleRate, effects[1]!.params);
		const stream = await prepareStreamedNormalization({ effects, sampleRate, frameCount: 137, channelCount: channels.length,
			chunkFrames: 43, assertCurrent: () => undefined, read: async (start, end) => channels.map(channel => channel.slice(start, end)) });
		const output = channels.map(() => new Float32Array(137)); let offset = 0;
		for await (const chunk of stream()) { chunk.forEach((channel, index) => output[index]!.set(channel, offset)); offset += chunk[0]!.length; }
		assert.deepEqual(output, expected);
	}
});

test('streamed normalization rejects malformed reads and cancellation before publication', async () => {
	const request = { effects: [{ type: 'audacity-normalize', params: {} }], sampleRate, frameCount: 100, channelCount: 1,
		chunkFrames: 32, assertCurrent: () => undefined, read: async () => [new Float32Array(1)] };
	await assert.rejects(prepareStreamedNormalization(request), /PCM/u);
	await assert.rejects(prepareStreamedNormalization({ ...request, assertCurrent: () => { throw new Error('Cancelled'); } }), /Cancelled/u);
});

test('streamed peak normalization retains independent gain, DC-only, subnormal PCM and signed zero', async () => {
	for (const channels of [input(2, 137), [Float32Array.from([0, -0, 2 ** -149, -(2 ** -149), 0])]]) {
		for (const params of [{ applyGain: false, removeDc: false }, { applyGain: false, removeDc: true },
			{ applyGain: true, removeDc: false, stereoIndependent: true }, { applyGain: true, removeDc: true, stereoIndependent: true }]) {
			const frameCount = channels[0]!.length, expected = applyAudacityNormalize(channels, sampleRate, params);
			const stream = await prepareStreamedNormalization({ effects: [{ type: 'audacity-normalize', params }], sampleRate, frameCount,
				channelCount: channels.length, chunkFrames: 3, assertCurrent: () => undefined,
				read: async (start, end) => channels.map(channel => channel.slice(start, end)) });
			const output = channels.map(() => new Float32Array(frameCount)); let offset = 0;
			for await (const chunk of stream()) { chunk.forEach((channel, index) => output[index]!.set(channel, offset)); offset += chunk[0]!.length; }
			assert.deepEqual(output, expected);
		}
	}
});
