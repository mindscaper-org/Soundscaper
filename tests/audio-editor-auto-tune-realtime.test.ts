/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadStaffPadWasm } from '../src/common/editor/staffpad/runtime.js';
import { createAutoTuneProcessor } from '../src/common/editor/first-party-effects/auto-tune/dsp.ts';
import { autoTuneRealtimeGeometry } from '../src/common/editor/first-party-effects/auto-tune/realtime-contract.ts';
import { audioEffectTypes, createEffect } from '../src/common/editor/effects.js';
import { effectLatencyFrames } from '../src/common/editor/engine/effect-rack.ts';
import { AUTO_TUNE_EFFECT_DEFINITION } from '../src/common/editor/first-party-effects/auto-tune/definition.ts';
import { compileParallelStackEffect } from '../src/common/editor/engine/parallel-stack-effects.ts';
import { effectParameterInventory } from '../src/common/editor/effect-parameter-descriptors.ts';
import { compileProjectPdcPlan } from '../src/common/editor/engine/project-pdc-plan.ts';

const RATE = 48000;
const runtime = async () => loadStaffPadWasm(await readFile(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url)));
const tone = (frequency: number, rate = RATE, seconds = 1) => Float32Array.from({ length: rate * seconds },
	(_, frame) => .3 * Math.sin(2 * Math.PI * frequency * frame / rate));
type Processor = ReturnType<typeof createAutoTuneProcessor>;

function render(processor: Processor, input: Float32Array[], sizes = [128]): Float32Array[] {
	const output = input.map(channel => new Float32Array(channel.length));
	let offset = 0, block = 0;
	while (offset < input[0]!.length) {
		const frames = Math.min(sizes[block++ % sizes.length]!, input[0]!.length - offset);
		processor.processBlock(input.map(channel => channel.subarray(offset, offset + frames)),
			output.map(channel => channel.subarray(offset, offset + frames)), frames);
		offset += frames;
	}
	return output;
}

function frequency(samples: Float32Array, rate: number, start = .35, end = .85): number {
	const crossings: number[] = [];
	for (let frame = Math.round(start * rate) + 1; frame < end * rate; frame++) {
		const left = samples[frame - 1]!, right = samples[frame]!;
		if (left <= 0 && right > 0) crossings.push(frame - 1 - left / (right - left));
	}
	assert.ok(crossings.length > 2);
	return (crossings.length - 1) * rate / (crossings.at(-1)! - crossings[0]!);
}

test('Auto-Tune is available in racks with fixed latency and explicit live-only controls', () => {
	assert.ok(audioEffectTypes().includes('auto-tune'));
	const effect = createEffect('auto-tune');
	const geometry = autoTuneRealtimeGeometry(RATE, 2);
	assert.ok(geometry.latencyFrames / RATE < .1);
	assert.equal(effectLatencyFrames(effect, RATE), geometry.latencyFrames);
	for (const [, , metadata] of Object.values(AUTO_TUNE_EFFECT_DEFINITION.ranges)) assert.equal(metadata.automatable, false);
	for (const choice of Object.values(AUTO_TUNE_EFFECT_DEFINITION.choices)) assert.equal(choice.automatable, false);
	assert.throws(() => compileParallelStackEffect(effect, RATE, 2), /do not support/, 'unqualified worker backend falls back to the conventional rack');
	for (const params of [{ mix: 0 }, { amount: 0 }, { retune: 500, key: 'a', scale: 'minor' }]) {
		assert.equal(effectLatencyFrames({ ...effect, params: { ...effect.params, ...params } }, RATE), geometry.latencyFrames);
	}
	for (const args of [[7999, 1], [192001, 1], [RATE, 0], [RATE, 33]]) {
		assert.throws(() => autoTuneRealtimeGeometry(args[0]!, args[1]!), RangeError);
	}
});

test('parameter descriptors and track/bus/master PDC agree with the streaming delay', () => {
	const effect = createEffect('auto-tune', { id: 'tune' });
	const latency = autoTuneRealtimeGeometry(RATE, 2).latencyFrames;
	const inventory = effectParameterInventory({ kind: 'track', id: 'voice' }, effect, { sampleRate: RATE });
	assert.ok(inventory.descriptors.length >= 3);
	for (const descriptor of inventory.descriptors) {
		assert.equal(descriptor.latencyFrames, latency);
		assert.equal(descriptor.automatable, false);
	}
	const plan = compileProjectPdcPlan({ sampleRate: RATE, tracks: [{ id: 'voice', effects: [effect] }, { id: 'dry', effects: [] }],
		mixer: { groups: [{ id: 'bus', effects: [effect] }] }, master: { effects: [effect] } });
	assert.equal(plan.trackLatencyFrames.get('voice'), latency);
	assert.equal(plan.trackLatencyFrames.get('dry'), 0);
	assert.equal(plan.busLatencyFrames.get('bus'), latency);
	assert.equal(plan.masterLatencyFrames, latency);
	assert.equal(plan.latencyFrames, latency * 3);
});

test('unity wet audio and dry mix share exactly the latency reported to rack compensation', async () => {
	for (const sampleRate of [8000, 44100, 48000, 96000, 192000]) {
		const processor = createAutoTuneProcessor({ sampleRate, channelCount: 1, params: {}, staffPadRuntime: await runtime() });
		try {
			const input = new Float32Array(sampleRate);
			input[Math.round(sampleRate / 4)] = .5;
			const output = render(processor, [input])[0]!;
			let peak = 0;
			for (let frame = 1; frame < output.length; frame++) if (output[frame]! > output[peak]!) peak = frame;
			assert.equal(peak, Math.round(sampleRate / 4) + processor.latencyFrames, String(sampleRate));
		} finally { processor.dispose(); }
	}
});

test('streaming pitch correction works across sample rates and preserves silent channels', async () => {
	for (const sampleRate of [8000, 44100, 48000, 96000, 192000]) {
		const processor = createAutoTuneProcessor({ sampleRate, channelCount: 3, params: { retune: 0 }, staffPadRuntime: await runtime() });
		try {
			const input = tone(450, sampleRate);
			const output = render(processor, [input, input.map(value => -value), new Float32Array(input.length)]);
			assert.ok(output.every(channel => channel.every(Number.isFinite)));
			assert.ok(Math.abs(frequency(output[0]!, sampleRate) - 440) < 1, String(sampleRate));
			assert.ok(output[2]!.every(sample => sample === 0));
			let energy = 0, cross = 0;
			for (let frame = Math.round(sampleRate * .35); frame < sampleRate * .85; frame++) {
				energy += output[0]![frame]! ** 2;
				cross += output[0]![frame]! * output[1]![frame]!;
			}
			assert.ok(cross / energy < -.99, 'opposite-phase stereo survives');
		} finally { processor.dispose(); }
	}
});

test('partitioning and reset preserve streaming PCM exactly; disposal is idempotent', async () => {
	const processor = createAutoTuneProcessor({ sampleRate: RATE, channelCount: 1, params: { retune: 0 }, staffPadRuntime: await runtime() });
	const input = [tone(280)];
	try {
		const reference = render(processor, input);
		processor.reset();
		assert.deepEqual(render(processor, input, [1, 7, 129, 511, 32]), reference);
		processor.updateParams({ key: 'c', scale: 'major' });
		processor.reset();
		assert.ok(Math.abs(frequency(render(processor, input)[0]!, RATE) - 293.665) < 1);
	} finally { processor.dispose(); processor.dispose(); }
	assert.throws(() => processor.reset(), /disposed/);
});

test('zero mix/amount uses exact delayed dry audio with stable compensation through live edits', async () => {
	const processor = createAutoTuneProcessor({ sampleRate: RATE, channelCount: 1, params: { mix: 0 }, staffPadRuntime: await runtime() });
	try {
		const input = tone(450);
		const latency = autoTuneRealtimeGeometry(RATE, 1).latencyFrames;
		const dry = render(processor, [input])[0]!;
		assert.ok(dry.subarray(0, latency).every(sample => sample === 0));
		assert.deepEqual(dry.subarray(latency), input.subarray(0, input.length - latency));
		processor.updateParams({ mix: 100, retune: 0 });
		assert.ok(Math.abs(frequency(render(processor, [input])[0]!, RATE) - 440) < 1);
		processor.updateParams({ amount: 0 });
		assert.deepEqual(render(processor, [input])[0]!.subarray(latency), input.subarray(0, input.length - latency));
		assert.throws(() => processor.updateParams({ scale: 'invalid' }), RangeError);
	} finally { processor.dispose(); }
});

test('retune speed controls response time and partial mixes combine aligned wet and dry PCM', async () => {
	const input = tone(450);
	const outputs: Float32Array[] = [];
	for (const params of [{ retune: 0 }, { retune: 500 }, { retune: 0, mix: 25 }, { retune: 0, mix: 0 }]) {
		const processor = createAutoTuneProcessor({ sampleRate: RATE, channelCount: 1, params, staffPadRuntime: await runtime() });
		try { outputs.push(render(processor, [input])[0]!); }
		finally { processor.dispose(); }
	}
	assert.ok(frequency(outputs[1]!, RATE, .2, .4) > frequency(outputs[0]!, RATE, .2, .4) + 3);
	for (let frame = 0; frame < input.length; frame++) {
		assert.ok(Math.abs(outputs[2]![frame]! - (.25 * outputs[0]![frame]! + .75 * outputs[3]![frame]!)) < 1e-6);
	}
});

test('successive notes and repeated live key changes stay bounded without input mutation or starvation', async () => {
	const staffPadRuntime = await runtime();
	const processor = createAutoTuneProcessor({ sampleRate: RATE, channelCount: 1, params: { retune: 0 }, staffPadRuntime });
	const heap = staffPadRuntime.memory.buffer;
	try {
		for (let index = 0; index < 20; index++) {
			processor.updateParams({ key: index % 2 ? 'a' : 'c', scale: index % 2 ? 'minor' : 'major' });
			const input = tone(index % 2 ? 538 : 280);
			const original = input.slice();
			const output = render(processor, [input], [128, 37, 256])[0]!;
			assert.ok(output.every(Number.isFinite));
			assert.ok(Math.abs(frequency(output, RATE) - (index % 2 ? 523.251 : 293.665)) < 1);
			assert.deepEqual(input, original);
			assert.equal(staffPadRuntime.memory.buffer, heap, 'native heap stays fixed during playback');
		}
	} finally { processor.dispose(); }
});

test('the maximum admitted layout processes without growing its private native heap', async () => {
	const staffPadRuntime = await runtime();
	const processor = createAutoTuneProcessor({ sampleRate: 192000, channelCount: 32, params: { retune: 0 }, staffPadRuntime });
	try {
		const heap = staffPadRuntime.memory.buffer;
		const input = tone(450, 192000, .1);
		const output = render(processor, Array.from({ length: 32 }, () => input));
		assert.ok(output.every(channel => channel.every(Number.isFinite)));
		assert.equal(staffPadRuntime.memory.buffer, heap);
	} finally { processor.dispose(); }
});
