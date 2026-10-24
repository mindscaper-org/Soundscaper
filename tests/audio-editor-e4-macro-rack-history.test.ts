/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { macroRackHistoryFrames, macroRackHistoryScratchBytes, prependMacroRackHistory } from '../src/common/editor/controller/effects/internal/macro/macro-rack-history.ts';
import { DelayProcessor } from '../src/common/editor/delay-worklet.js';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects-runtime.js';
import { createEffectMacroChainRunner, planEffectMacroChain, type EffectMacroChainRuntime } from '../src/common/editor/controller/effects/internal/macro/effect-macro-chain.ts';

interface Pcm { readonly channels: readonly Float32Array[] }
const rate = 48_000;
const delay = { id: 'echo', type: 'delay', params: { time: .04, feedback: 0, mix: 1 } };
function delayed(channels: readonly Float32Array[]): Float32Array[] {
	const processor = new DelayProcessor({ processorOptions: { sampleRate: rate, params: delay.params } });
	const output = channels.map(channel => new Float32Array(channel.length));
	processor.process([channels], [output]);
	return output;
}
function fixture(startFrame = 4800, cancelAfterRead = false) {
	const source = Float32Array.from({ length: startFrame + 4800 }, (_, frame) => frame >= startFrame ? .05 : frame === startFrame - 800 ? .25 : 0);
	const reads: Array<readonly [number, number, readonly string[] | undefined]> = [];
	let current = true, captures = 0;
	const runtime: EffectMacroChainRuntime<Pcm> = {
		sampleRate: rate, projectFrameCount: () => source.length,
		copy: { autoDuckControlTrack: 'Control required', effectInvalidAudio: 'Invalid', noiseProfileMissing: 'Profile required' },
		assertCurrent: () => { if (!current) throw new DOMException('Retired', 'AbortError'); },
		renderDryRange: async (_track, from, to, _width, clipIds) => {
			reads.push([from, to, clipIds]);
			if (cancelAfterRead) current = false;
			return [source.slice(from, to)];
		},
		runSelectionEffect: async request => ({ channels: await applyAudioSelectionEffectAsync(request.effectType, [...request.channels], request.sampleRate, request.params) }),
		createAudioBuffer: async channels => ({ channels }),
		renderSnapshot: async (_project, range, buffers) => {
			captures += 1;
			const buffer = buffers.values().next().value;
			assert.ok(buffer && typeof buffer === 'object' && 'channels' in buffer && Array.isArray(buffer.channels));
			assert.ok(buffer.channels.every((channel): channel is Float32Array => channel instanceof Float32Array));
			assert.equal(typeof range.startFrame, 'number'); assert.equal(typeof range.endFrame, 'number');
			return { channels: delayed(buffer.channels).map(channel => channel.slice(Number(range.startFrame), Number(range.endFrame))) };
		},
		audioBufferChannels: buffer => buffer.channels,
		matchSelectionChannels: channels => [...channels],
	};
	return { runner: createEffectMacroChainRunner(runtime), source, reads, captures: () => captures,
		target: { track: { id: 'voice' }, startFrame, endFrame: source.length, channelCount: 1, clipIds: ['selected'] } };
}
for (const gainDb of [0, 6]) test(`an offline ${gainDb}dB step retains original history for the following delay`, async () => {
	const value = fixture();
	const output = await value.runner.runSegments(planEffectMacroChain([{ id: 'gain', type: 'audacity-amplify', params: { gainDb } }, delay]),
		[value.source.slice(4800)], value.target);
	const reference = value.source.map((sample, frame) => frame < 4800 ? sample : sample * 10 ** (gainDb / 20));
	const expected = delayed([reference])[0]!.slice(4800);
	assert.equal(output[0]?.[1120], .25, 'the echo of the unchanged prefix is neither removed nor amplified');
	assert.ok(output[0]?.every((sample, frame) => Math.abs(sample - expected[frame]!) < 1e-7));
	assert.deepEqual(value.reads, [[0, 4800, ['selected']]]);
});
test('rack history is clipped to source start and exact clip authority', async () => {
	const value = fixture(1000);
	await value.runner.runSegments(planEffectMacroChain([delay]), [value.source.slice(1000)], value.target);
	assert.deepEqual(value.reads, [[0, 1000, ['selected']]]);
});
test('a prefix read cannot publish a staged capture after its operation retires', async () => {
	const value = fixture(4800, true);
	await assert.rejects(value.runner.runSegments(planEffectMacroChain([delay]), [value.source.slice(4800)], value.target), { name: 'AbortError' });
	assert.equal(value.captures(), 0);
});
test('a rack at source origin retains the existing no-history path', async () => {
	const value = fixture(0);
	const output = await value.runner.runSegments(planEffectMacroChain([delay]), [value.source], value.target);
	assert.deepEqual(output, delayed([value.source])); assert.deepEqual(value.reads, []);
});

test('finite echo history longer than ten seconds remains bounded by the original prefix', () => {
	const long = [{ ...delay, params: { time: 5, feedback: .5, mix: 1 } }];
	assert.equal(macroRackHistoryFrames(long, rate, rate * 20), rate * 20);
	assert.equal(macroRackHistoryFrames(long, rate, rate * 100), rate * 50);
	assert.equal(macroRackHistoryFrames([{ id: 'gain', type: 'audacity-amplify', params: {} }], rate, rate * 100), 0);
});
test('staged scratch is charged without rejecting an unchanged timeline rack for nonexistent staging', () => {
	assert.equal(macroRackHistoryScratchBytes([delay], rate, 2, false), 0);
	assert.equal(macroRackHistoryScratchBytes([{ id: 'gain', type: 'audacity-amplify', params: {} }, delay], rate, 2, false), rate * 2 * 4 * 5);
	const duck = { id: 'duck', type: 'audacity-auto-duck', params: {}, context: { controlTrackId: 'voice' } };
	assert.equal(macroRackHistoryScratchBytes([duck, { ...duck, id: 'second' }], rate, 2), rate * 4 * 4 * 5);
	assert.throws(() => macroRackHistoryScratchBytes([delay], Number.MAX_SAFE_INTEGER, 32), /memory range/u);
	assert.throws(() => prependMacroRackHistory([new Float32Array(4)], [new Float32Array(3)], 4), /requested prefix/u);
});
