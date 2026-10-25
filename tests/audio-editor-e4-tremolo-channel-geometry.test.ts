/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmSamplesEqual } from './helpers/assert-pcm-samples.ts';
import { createStandardEffectNode, ensureStandardEffectWorklet } from '../src/common/editor/engine/standard-effect-node.ts';
import { createTremoloProcessor } from '../src/common/editor/first-party-effects/standard/tremolo-dsp.ts';
import { MockAudioContext } from './helpers/mock-audio-context.js';
import { MockAudioWorkletNode } from './helpers/audio-editor-runtime-harness.js';

for (const width of [1, 2, 6, 32]) test(`Tremolo follows actual input channels on a ${width}-channel strip`, async () => {
	const context = new MockAudioContext() as unknown as BaseAudioContext;
	await ensureStandardEffectWorklet(context);
	const node = createStandardEffectNode(context, MockAudioWorkletNode as unknown as typeof AudioWorkletNode,
		'tremolo', { depth: 0 }, width);
	const options = (node as unknown as { readonly options: AudioWorkletNodeOptions }).options;
	assert.equal(options.channelCountMode, 'max', 'a neutral insert cannot widen a mono passage before its strip panner');
	assert.equal(options.outputChannelCount, undefined, 'native output geometry must follow this one input');
	assert.equal(options.channelCount, width);
	assert.equal(options.channelInterpretation, 'discrete', 'already-wide input retains exact channel identities');
});

test('stateful processors retain their explicit geometry and discrete release histories', async () => {
	const context = new MockAudioContext() as unknown as BaseAudioContext;
	await ensureStandardEffectWorklet(context);
	const node = createStandardEffectNode(context, MockAudioWorkletNode as unknown as typeof AudioWorkletNode,
		'noise-gate', {}, 6);
	const options = (node as unknown as { readonly options: AudioWorkletNodeOptions }).options;
	assert.equal(options.channelCountMode, 'explicit');
	assert.deepEqual(options.outputChannelCount, [6]);
	assert.equal(options.channelInterpretation, 'discrete');
});

test('one Tremolo oscillator keeps its exact phase while native output narrows and widens', () => {
	const params = { frequency: 4, depth: 70 };
	const adaptive = createTremoloProcessor({ sampleRate: 48_000, channelCount: 6, params });
	const mono = createTremoloProcessor({ sampleRate: 48_000, channelCount: 1, params });
	for (const width of [6, 1, 2, 1, 6]) {
		const frames = 257;
		const input = Array.from({ length: width }, (_, channel) => new Float32Array(frames).fill((channel + 1) / 8));
		const output = input.map(() => new Float32Array(frames));
		const reference = [new Float32Array(frames)];
		adaptive.processBlock(input, output, frames);
		mono.processBlock([input[0]!], reference, frames);
		assertPcmSamplesEqual(output[0], reference[0]!);
		for (let channel = 1; channel < width; channel++) {
			assert.ok(output[channel]!.every((sample, frame) => Math.abs(sample - reference[0]![frame]! * (channel + 1)) < 1e-7));
		}
	}
});
