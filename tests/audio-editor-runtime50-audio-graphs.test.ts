/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { connectPlaybackFrequencyOutput, enginePlaybackFrequencyMethods, disposePlaybackFrequencyOutput } from '../src/common/editor/engine/playback-frequency-range.ts';
import { ENGINE_ASSERT_ACTIVE } from '../src/common/editor/engine/runtime-symbols.ts';
import { createParallelStackExecutor } from '../src/common/editor/engine/parallel-stack-dsp.ts';
import { parallelStackMemoryBytes } from '../src/common/editor/engine/parallel-stack-plan-validation.ts';
import type { ParallelStackTask, ParallelStackPlan } from '../src/common/editor/engine/parallel-stack-types.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import { readMasterMeter } from '../src/common/editor/engine/engine-meter-reading.ts';

class ListeningNode {
	connections = 0;
	disconnections = 0;
	readonly frequency = { setValueAtTime(): void {} };
	readonly Q = { setValueAtTime(): void {} };
	connect(): void { this.connections++; }
	disconnect(): void { this.disconnections++; }
}

test('A05 repeated normalized audition ranges reuse the active listening graph', () => {
	let filters = 0;
	const nodes: ListeningNode[] = [];
	const context = { sampleRate: 48000, currentTime: 0, createBiquadFilter() {
		filters++;
		const node = new ListeningNode(); nodes.push(node); return node;
	} } as unknown as BaseAudioContext;
	const owner = { sampleRate: 48000, [ENGINE_ASSERT_ACTIVE](): void {} } as unknown as EngineRuntimeHost;
	const input = new ListeningNode();
	connectPlaybackFrequencyOutput(owner, context, input as unknown as GainNode, new ListeningNode() as unknown as AudioNode);
	const set = enginePlaybackFrequencyMethods.setPlaybackFrequencyRange.bind(owner);
	const band = { minimumFrequency: 500, maximumFrequency: 2000 };
	assert.deepEqual(set(band), band);
	const before = filters;
	const disconnects = input.disconnections;
	assert.deepEqual(set({ ...band }), band);
	assert.equal(filters, before);
	assert.equal(input.disconnections, disconnects);
	set({ minimumFrequency: 0, maximumFrequency: 50000 });
	const fullRangeDisconnects = input.disconnections;
	set({ minimumFrequency: -10, maximumFrequency: 24000 });
	assert.equal(input.disconnections, fullRangeDisconnects, 'equal clamped ranges are equivalent');
	set(null);
	const nullDisconnects = input.disconnections;
	set(null);
	assert.equal(input.disconnections, nullDisconnects);
	assert.throws(() => set({ minimumFrequency: NaN, maximumFrequency: 1000 }), RangeError);
	disposePlaybackFrequencyOutput(owner);
	assert.ok(nodes.every(node => node.disconnections > 0));
});

function parallelPlan(matrix: readonly (readonly number[])[]): ParallelStackPlan {
	const controls = { worker: 0, inputDelayFrames: 0, outputDelayFrames: 0, gain: 1, pan: 0, gate: 1, vca: 1, effects: [] };
	const tasks: ParallelStackTask[] = [
		{ ...controls, kind: 'stack', key: 'track:t', channels: 4, inputPlanes: [0, 1, 2, 3], prePlanes: [4, 5, 6, 7],
			postPlanes: [8, 9, 10, 11], dependencies: [], edges: [] },
		{ ...controls, kind: 'output', key: 'output:main', channels: 4, inputPlanes: [], prePlanes: [], postPlanes: [12, 13, 14, 15],
			dependencies: [0], edges: [{ id: 'route', sourceTask: 0, sourcePlanes: [8, 9, 10, 11], matrix,
				delayFrames: 0, level: .75, sidechainEffectId: null }] },
	];
	return { version: 1, sampleRate: 48000, blockFrames: 256, bankCount: 8, workerCount: 1, planeCount: 16,
		tasks, taskOrder: [0, 1], tracks: [], stripTaps: [], outputs: [], inputPlaneIndices: [[0, 1, 2, 3]],
		outputPlaneIndices: [[12, 13, 14, 15]], latencyFrames: 0,
		memoryBytes: parallelStackMemoryBytes(tasks, 16, 256, 8, 1) };
}

for (const dense of [false, true]) test(`A06 parallel ${dense ? 'mixed' : 'mapped'} routes prepare sparse channel selection before processing`, () => {
	let reads = 0;
	const matrix = Array.from({ length: 4 }, (_, destination) => {
		const row = dense && destination === 2 ? [.2, .3, 0, -.7]
			: Array.from({ length: 4 }, (_, source) => source === destination ? 1 : 0);
		return new Proxy(row, { get(target, key, receiver) {
			if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
			return Reflect.get(target, key, receiver) as unknown;
		} });
	});
	const plan = parallelPlan(matrix);
	const execute = createParallelStackExecutor(plan, 0);
	const planes = Array.from({ length: 16 }, () => new Float32Array(256));
	for (let channel = 0; channel < 4; channel++) for (let frame = 0; frame < 256; frame++) {
		planes[channel][frame] = frame === 0 ? -0 : Math.sin(frame * .037 + channel) * .7;
	}
	execute(0, planes, 0);
	const expected = Array.from({ length: 4 }, (_, destination) => {
		const output = new Float32Array(256);
		for (let source = 0; source < 4; source++) {
			const coefficient = matrix[destination][source];
			if (coefficient === 0) continue;
			for (let frame = 0; frame < 256; frame++) output[frame] = output[frame] + planes[8 + source][frame] * coefficient;
		}
		for (let frame = 0; frame < 256; frame++) output[frame] = 0 + Math.fround(output[frame] * .75);
		return output;
	});
	reads = 0;
	execute(1, planes, 0);
	assert.equal(reads, dense ? 7 : 4);
	assert.deepEqual(planes.slice(12), expected);
});

function displayedSpectrum(channels: readonly Float32Array[]): readonly number[] {
	const output: number[] = [];
	const count = Math.min(...channels.map(channel => channel.length));
	const highest = Math.max(1, count - 1);
	for (let bucket = 0; bucket < 128; bucket++) {
		const start = Math.max(1, Math.floor(highest ** (bucket / 128)));
		const end = Math.min(count, Math.max(start + 1, Math.ceil(highest ** ((bucket + 1) / 128))));
		let loudest = -120;
		for (let bin = start; bin < end; bin++) {
			let power = 0;
			for (const channel of channels) power += 10 ** (channel[bin] / 10);
			const value = 10 * Math.log10(power / channels.length);
			if (Number.isFinite(value)) loudest = Math.max(loudest, Math.min(0, value));
		}
		output.push(loudest);
	}
	return output;
}

test('A08 live channel spectra merge each FFT bin once despite overlapping log buckets', (context) => {
	const channels = Array.from({ length: 8 }, (_, channel) => Float32Array.from(
		{ length: 2048 }, (_, bin) => bin % 11 === 0 ? -Infinity : -120 + ((bin * 3 + channel * 7) % 125),
	));
	const expected = displayedSpectrum(channels);
	const analysers = channels.map(values => ({ frequencyBinCount: 2048,
		getFloatFrequencyData(target: Float32Array): void { target.set(values); } }) as AnalyserNode);
	let merges = 0;
	const original = Math.log10;
	const mock = context.mock.method(Math, 'log10', (value: number) => { merges++; return original(value); });
	const tap = { spectrum: analysers[0], spectrumChannels: analysers, splitter: null, stereo: [] };
	const reading = readMasterMeter(null, tap);
	mock.mock.restore();
	assert.equal(merges, 2047);
	assert.deepEqual(reading.spectrumDb, expected);
	assert.ok(Object.isFrozen(reading.spectrumDb));
	channels[0][37] = 0;
	assert.deepEqual(readMasterMeter(null, tap).spectrumDb, displayedSpectrum(channels), 'scratch must refresh for each meter tick');
});
