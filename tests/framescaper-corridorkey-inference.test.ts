/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { CORRIDORKEY_CHROMA_HINT_DEFAULTS } from '../src/common/editor/assistance/corridorkey-hint-settings.ts';
import { createChromaKeyMatte } from '../src/common/editor/video-chroma-key.ts';

import {
	createCorridorKeyOnnxFrameProcessorV1,
} from '../desktop/assistance-corridorkey-inference.ts';
import type {
	AssistanceOnnxInferenceSessionV1,
	AssistanceOnnxRuntimeModuleV1,
	AssistanceOnnxTensorV1,
} from '../desktop/assistance-onnx-runtime-worker.ts';

type Role = 'cradio' | 'moge' | 'rvm' | 'stage1' | 'stage2';
type Tensors = Readonly<Record<string, AssistanceOnnxTensorV1>>;
const PATHS = Object.freeze({ cradio: 'cradio.onnx', moge: 'moge.onnx',
	rvm: 'rvm.onnx', stage1: 'stage1.onnx', stage2: 'stage2.onnx' });
const NAMES = {
	cradio: [['rgb'], ['features']], moge: [['rgb'], ['features']],
	rvm: [['rgb', 'state'], ['features', 'state_out']],
	stage1: [['rgb', 'hint', 'moge', 'cradio', 'rvm', 'quality'], ['baton', 'aux']],
	stage2: [['rgb', 'baton'], ['logits']],
} as const;

class Tensor implements AssistanceOnnxTensorV1 {
	constructor(readonly type: string, readonly data: Uint8Array | Float32Array | BigInt64Array,
		readonly dims: readonly number[]) {}
}

function float(dims: readonly number[], fill = 0): AssistanceOnnxTensorV1 {
	return new Tensor('float32', new Float32Array(dims.reduce((a, b) => a * b, 1)).fill(fill), dims);
}

function raster(width = 256, height = 256) {
	const rgba = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
		rgba.set([0, x % 128 * 2, 64, 255], (y * width + x) * 4);
	}
	rgba[0] = 255;
	rgba[(4 * width + 4) * 4] = 255;
	return { width, height, rgba };
}

function fake(options: Readonly<{
	create?: (role: Role, session: AssistanceOnnxInferenceSessionV1) => AssistanceOnnxInferenceSessionV1;
	beforeRun?: (role: Role, feeds: Tensors) => PromiseLike<void> | void;
	result?: (role: Role, outputs: Tensors) => Tensors;
}> = {}) {
	const created: Role[] = [];
	const released: Role[] = [];
	const runs: Array<Readonly<{ role: Role; feeds: Tensors }>> = [];
	const runtime: AssistanceOnnxRuntimeModuleV1 = {
		Tensor,
		InferenceSession: { create: (path) => {
			const role = Object.keys(PATHS).find((name) => PATHS[name as Role] === path) as Role;
			assert.ok(role);
			created.push(role);
			const session: AssistanceOnnxInferenceSessionV1 = {
				inputNames: NAMES[role][0], outputNames: NAMES[role][1],
				run: async (feeds) => {
					runs.push({ role, feeds });
					await options.beforeRun?.(role, feeds);
					const outputs = prediction(role, feeds);
					return options.result?.(role, outputs) ?? outputs;
				},
				release: () => { released.push(role); },
			};
			return Promise.resolve(options.create?.(role, session) ?? session);
		} },
	};
	return { runtime, created, released, runs };
}

function prediction(role: Role, feeds: Tensors): Tensors {
	const dims = feeds.rgb!.dims;
	const h = dims.at(-2)!;
	const w = dims.at(-1)!;
	if (role === 'cradio') return { features: float([1, 1152, h / 16, w / 16], 1) };
	if (role === 'moge') return { features: float([1, 768, h / 14, w / 14], 2) };
	if (role === 'rvm') {
		const prior = feeds.state!.data as Float32Array;
		return { features: float([1, 1, 384, h / 16, w / 16], 3),
			state_out: new Tensor('float32', Float32Array.from(prior, value => value + 1), feeds.state!.dims) };
	}
	if (role === 'stage1') return { baton: float([1, 1, 512, h / 16, w / 16], 4),
		aux: float([1, 1, 4, h / 2, w / 2], 5) };
	const logits = new Float32Array(h * w * 4).fill(0.25);
	logits.set(feeds.rgb!.data as Float32Array, h * w);
	return { logits: new Tensor('float32', logits, [1, 1, 4, h, w]) };
}

function approximately(actual: number, expected: number): void {
	assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} differs from ${expected}`);
}

test('five graphs receive exact frame layouts, native resampling, normalized features, and no hint', async () => {
	const held = fake();
	const processor = await createCorridorKeyOnnxFrameProcessorV1({ runtime: held.runtime, modelPaths: PATHS });
	const frame = raster();
	const result = await processor.process(frame);
	assert.deepEqual(held.created, ['cradio', 'moge', 'rvm', 'stage1', 'stage2']);
	assert.deepEqual(held.runs.map(({ role }) => role), held.created);
	const [cradio, moge, rvm, stage1, stage2] = held.runs.map(({ feeds }) => feeds);
	assert.deepEqual(cradio!.rgb!.dims, [1, 3, 64, 64]);
	assert.deepEqual(moge!.rgb!.dims, [1, 3, 56, 56]);
	assert.deepEqual(rvm!.rgb!.dims, [1, 1, 3, 64, 64]);
	// Area uses 4x4 blocks for C-RADIO and adaptive overlapping 5x5 bins for MoGe.
	approximately(Number(cradio!.rgb!.data[0]), 1 / 16);
	approximately(Number(moge!.rgb!.data[0]), 2 / 25);
	// RVM samples at source coordinate 1.5, excluding the impulse at (0, 0).
	assert.equal(rvm!.rgb!.data[0], 0);
	approximately(Number(cradio!.rgb!.data[64 * 64]), 3 / 255);
	approximately(Number(moge!.rgb!.data[56 * 56]), 4 / 255);
	assert.deepEqual(rvm!.state!.dims, [1, 17, 384]);
	assert.ok((rvm!.state!.data as Float32Array).every(value => value === 0));
	assert.deepEqual(stage1!.rgb!.dims, [1, 1, 3, 256, 256]);
	assert.deepEqual(stage1!.hint!.dims, [1, 1, 1, 256, 256]);
	assert.ok((stage1!.hint!.data as Float32Array).every(value => value === 0));
	assert.deepEqual(stage1!.quality!.dims, [1, 1]);
	assert.deepEqual([...stage1!.quality!.data], [-1]);
	assert.deepEqual(stage1!.moge!.dims, [1, 1, 768, 4, 4]);
	assert.equal(stage1!.moge!.data[0], 2);
	assert.deepEqual(stage1!.cradio!.dims, [1, 1, 1152, 4, 4]);
	assert.equal(stage1!.cradio!.data[0], 1);
	assert.deepEqual(stage1!.rvm!.dims, [1, 1, 384, 4, 4]);
	assert.equal(stage1!.rvm!.data[0], 3);
	assert.deepEqual(stage2!.baton!.dims, [1, 1, 512, 16, 16]);
	assert.equal(stage2!.baton!.data[0], 4);
	assert.deepEqual([result.width, result.height], [256, 256]);
	assert.deepEqual([...result.rgba.slice(0, 4)], [255, 0, 64, 64]);
	assert.equal(held.released.length, 0);
	await processor.release();
	assert.deepEqual([...held.released].sort(), [...held.created].sort());
});

test('Chroma Key hint runs first on original RGB and reflects its matte into the model hint tensor', async () => {
	const held = fake(); const hint = { ...CORRIDORKEY_CHROMA_HINT_DEFAULTS };
	const processor = await createCorridorKeyOnnxFrameProcessorV1({ runtime: held.runtime, modelPaths: PATHS, hint });
	hint.keyColor = 0x0000ff;
	const frame = raster(9, 9);
	for (let index = 0; index < frame.rgba.length; index += 4) frame.rgba.set([0, 255, 0, 255], index);
	for (let y = 3; y < 6; y += 1) for (let x = 3; x < 6; x += 1) frame.rgba.set([255, 0, 0, 255], (y * 9 + x) * 4);
	const expected = createChromaKeyMatte(frame, CORRIDORKEY_CHROMA_HINT_DEFAULTS);
	await processor.process(frame);
	const feeds = held.runs.find(({ role }) => role === 'stage1')!.feeds;
	assert.deepEqual([...feeds.quality!.data], [0.75]);
	for (let y = 0; y < 9; y += 1) for (let x = 0; x < 9; x += 1) {
		assert.equal(feeds.hint!.data[(y + 123) * 256 + x + 123], expected[y * 9 + x]);
	}
	assert.equal(feeds.hint!.data[123 * 256 + 122], expected[1], 'hint reflection excludes the edge pixel');
	assert.equal(feeds.rgb!.data[127 * 256 + 127], Math.fround(Math.asinh(1 / 0.008) / Math.asinh(16 / 0.008)), 'the original red subject remains the model input');
	await processor.release();
});

test('concurrent process calls serialize the recurrent stream and retain state without sharing output buffers', async () => {
	let unblock!: () => void;
	const gate = new Promise<void>(resolve => { unblock = resolve; });
	let entered!: () => void;
	const firstRun = new Promise<void>(resolve => { entered = resolve; });
	let count = 0;
	const modelStates: Float32Array[] = [];
	const held = fake({ beforeRun: async role => {
		if (role === 'cradio' && count++ === 0) { entered(); await gate; }
	}, result: (role, tensors) => {
		if (role === 'rvm') modelStates.push(tensors.state_out!.data as Float32Array);
		return tensors;
	} });
	const processor = await createCorridorKeyOnnxFrameProcessorV1({ runtime: held.runtime, modelPaths: PATHS });
	const first = processor.process(raster());
	const sourceFrame = raster();
	const secondFrame = { ...sourceFrame, rgba: Buffer.from(sourceFrame.rgba) };
	const second = processor.process(secondFrame);
	secondFrame.rgba.fill(0);
	await firstRun;
	assert.deepEqual(held.runs.map(({ role }) => role), ['cradio']);
	unblock();
	const results = await Promise.all([first, second]);
	assert.notEqual(results[0]!.rgba, results[1]!.rgba);
	assert.equal(results[1]!.rgba[0], 255, 'queued input owns its original pixels');
	const states = held.runs.filter(({ role }) => role === 'rvm').map(({ feeds }) => feeds.state!.data);
	assert.equal(states[0]![0], 0);
	assert.equal(states[1]![0], 1);
	modelStates[1]!.fill(77);
	await processor.process(raster());
	assert.equal(held.runs.filter(({ role }) => role === 'rvm')[2]!.feeds.state!.data[0], 2);
	await processor.release();
	await processor.release();
	assert.equal(held.released.length, 5);
	await assert.rejects(processor.process(raster()), /closed|released/iu);
});

test('a native geometry change retires the stream before another recurrent update', async () => {
	const held = fake();
	const processor = await createCorridorKeyOnnxFrameProcessorV1({ runtime: held.runtime, modelPaths: PATHS });
	await processor.process(raster());
	await assert.rejects(processor.process(raster(255, 256)), /geometry|dimensions/iu);
	assert.equal(held.runs.length, 5);
	assert.equal(held.released.length, 5);
	await assert.rejects(processor.process(raster()), /closed|released/iu);
});

test('creation failures and foreign graph signatures release every session already obtained', async () => {
	for (const role of Object.keys(PATHS) as Role[]) {
		const held = fake({ create: (candidate, session) => {
			if (candidate === role) throw new Error('Creation failed');
			return session;
		} });
		await assert.rejects(createCorridorKeyOnnxFrameProcessorV1({ runtime: held.runtime, modelPaths: PATHS }),
			/Creation failed/u);
		assert.deepEqual([...held.released].sort(), held.created.filter(value => value !== role).sort());
	}
	for (const field of ['inputNames', 'outputNames'] as const) {
		const held = fake({ create: (role, session) => role === 'rvm'
			? { ...session, [field]: ['foreign'] } : session });
		await assert.rejects(createCorridorKeyOnnxFrameProcessorV1({ runtime: held.runtime, modelPaths: PATHS }),
			/signature/iu);
		assert.deepEqual([...held.released].sort(), ['cradio', 'moge', 'rvm']);
	}
	const invalid = fake({ create: (role, session) => role === 'moge'
		? { ...session, run: null as never } : session });
	await assert.rejects(createCorridorKeyOnnxFrameProcessorV1({ runtime: invalid.runtime, modelPaths: PATHS }),
		/surface/iu);
	assert.deepEqual([...invalid.released].sort(), ['cradio', 'moge']);
});

test('all graph outputs reject foreign inventories, wrong dimensions, element types and nonfinite samples', async () => {
	for (const role of Object.keys(PATHS) as Role[]) {
		for (const failure of ['inventory', 'dimensions', 'type', 'nonfinite']) {
			const held = fake({ result: (candidate, tensors) => {
				if (candidate !== role) return tensors;
				if (failure === 'inventory') return { ...tensors, foreign: float([1]) };
				const name = NAMES[role][1].at(-1)!; // Includes unused stage-one aux and recurrent state_out.
				const tensor = tensors[name]!;
				if (failure === 'dimensions') return { ...tensors, [name]: { ...tensor, dims: [tensor.data.length] } };
				if (failure === 'type') return { ...tensors, [name]: { ...tensor, type: 'int64' } };
				(tensor.data as Float32Array)[tensor.data.length - 1] = NaN;
				return tensors;
			} });
			const processor = await createCorridorKeyOnnxFrameProcessorV1({ runtime: held.runtime, modelPaths: PATHS });
			await assert.rejects(processor.process(raster()), /inventory|tensor|finite/iu);
			assert.equal(held.released.length, 5, `${role}/${failure} must retire all sessions`);
			await processor.release();
		}
	}
});

test('cancellation before or during creation releases only the successfully created sessions', async () => {
	const cancelled = new AbortController();
	cancelled.abort();
	const none = fake();
	await assert.rejects(createCorridorKeyOnnxFrameProcessorV1({ runtime: none.runtime, modelPaths: PATHS,
		signal: cancelled.signal }), { name: 'AbortError' });
	assert.equal(none.created.length, 0);
	const cancellation = new AbortController();
	const partial = fake({ create: (_role, session) => { cancellation.abort(); return session; } });
	await assert.rejects(createCorridorKeyOnnxFrameProcessorV1({ runtime: partial.runtime, modelPaths: PATHS,
		signal: cancellation.signal }), { name: 'AbortError' });
	assert.deepEqual(partial.created, ['cradio']);
	assert.deepEqual(partial.released, ['cradio']);
});

test('cancellation during inference stops at the graph boundary and retires every session', async () => {
	const cancellation = new AbortController();
	const held = fake({ beforeRun: role => { if (role === 'rvm') cancellation.abort(); } });
	const processor = await createCorridorKeyOnnxFrameProcessorV1({ runtime: held.runtime, modelPaths: PATHS,
		signal: cancellation.signal });
	await assert.rejects(processor.process(raster()), { name: 'AbortError' });
	assert.deepEqual(held.runs.map(({ role }) => role), ['cradio', 'moge', 'rvm']);
	await processor.release();
	assert.equal(held.released.length, 5);
});

test('idle cancellation releases sessions and invalid pixel storage cannot reach a graph', async () => {
	const cancellation = new AbortController();
	const held = fake();
	const processor = await createCorridorKeyOnnxFrameProcessorV1({ runtime: held.runtime, modelPaths: PATHS,
		signal: cancellation.signal });
	cancellation.abort();
	await processor.release();
	assert.equal(held.released.length, 5);
	const invalid = fake();
	const invalidProcessor = await createCorridorKeyOnnxFrameProcessorV1({ runtime: invalid.runtime, modelPaths: PATHS });
	await assert.rejects(invalidProcessor.process({ width: 1, height: 1, rgba: new Uint8Array(3) }), /RGBA/iu);
	assert.equal(invalid.runs.length, 0);
	assert.equal(invalid.released.length, 5);
});

test('release attempts every session and reports cleanup failures without retrying disposed sessions', async () => {
	const held = fake({ create: (role, session) => role !== 'moge' ? session : {
		...session, release: async () => { await session.release?.(); throw new Error('Native release failed'); },
	} });
	const processor = await createCorridorKeyOnnxFrameProcessorV1({ runtime: held.runtime, modelPaths: PATHS });
	await assert.rejects(processor.release(), { name: 'AggregateError', message: /cleanup failed/u });
	assert.equal(held.released.length, 5);
	await assert.rejects(processor.release(), { name: 'AggregateError' });
	assert.equal(held.released.length, 5);
});
