/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CORRIDORKEY_GRAPH_ARTIFACTS_V1 } from '../desktop/assistance-corridorkey-model.ts';
import { createAssistanceOnnxCorridorKeyWorkerAdapterV1 } from '../desktop/assistance-onnx-corridorkey-worker.ts';
import type { CorridorKeyOnnxFrameProcessorOptionsV1 } from '../desktop/assistance-corridorkey-inference.ts';
import { createAssistanceOnnxRuntimeWorkerAdapterV1,
	type AssistanceOnnxRuntimeModuleV1, type AssistanceOnnxTensorV1 } from '../desktop/assistance-onnx-runtime-worker.ts';
import type { AssistanceRuntimeFamilyWorkerExecutionContext } from '../desktop/assistance-runtime-family-worker-entry.ts';
import { createAssistanceVisualFramePackV2, reviewAssistanceVisualFramePackV2 } from
	'../src/common/editor/assistance/visual-frame-pack-v2.ts';

const MIME = 'application/vnd.soundscaper.frame-pack';
const JOB_ID = '1'.repeat(40);
const IDENTITY = { dev: '1', ino: '2' };
const digest = (body: Uint8Array): string => createHash('sha256').update(body).digest('hex');
const runtime = { Tensor: class {}, InferenceSession: { create: () => { throw new Error('Unused fake runtime'); } } } as unknown as AssistanceOnnxRuntimeModuleV1;

function pack(ordinals: readonly number[], overrides: Readonly<Record<string, unknown>> = {}) {
	return Buffer.concat(createAssistanceVisualFramePackV2({
		sourceWidth: 4, sourceHeight: 2, rasterWidth: 4, rasterHeight: 2, timescale: 30_000,
		frames: ordinals.map(sourceFrame => ({ sourceFrame, presentationTick: String(sourceFrame * 1_001),
			rgba: new Uint8Array(4 * 2 * 4).fill(200) })), ...overrides,
	}));
}

async function fixture(context: test.TestContext, bodies = [pack([0, 1]), pack([2])]) {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-keying-worker-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const inputs = await Promise.all(bodies.map(async (body, index) => {
		const path = join(root, `input-${index}`);
		await writeFile(path, body);
		return { claimId: String(index + 2).repeat(40), role: 'frame-pack' as const, mediaType: MIME,
			path, byteLength: body.length, sha256: digest(body), identity: IDENTITY };
	}));
	const outputs = await Promise.all(inputs.map(async (input, index) => {
		const path = join(root, `output-${index}`);
		await writeFile(path, new Uint8Array());
		return { claimId: String(index + 4).repeat(40), role: 'keyed-frames' as const, mediaType: MIME,
			path, maximumByteLength: input.byteLength, initialByteLength: 0 as const,
			initialSha256: digest(new Uint8Array()), identity: IDENTITY };
	}));
	const settings = { schemaVersion: 1, operation: 'video-keying',
		inputRoles: inputs.map(() => 'frame-pack'), outputRoles: outputs.map(() => 'keyed-frames'),
		selectionFence: { projectId: 'project', schemaFamily: 'framescaper', schemaVersion: 1, revision: 1,
			sequenceId: 'sequence', occurrenceIds: ['clip'], sourceId: 'source', sourceSha256: 'a'.repeat(64),
			sourceStartFrame: 0, sourceEndFrame: bodies.reduce((sum, body) => sum + reviewAssistanceVisualFramePackV2(body).frameCount, 0),
			linkMembershipSha256: 'b'.repeat(64), timingAuthoritySha256: 'c'.repeat(64) },
	};
	const grant = { grantVersion: 1 as const, jobId: JOB_ID, familyId: 'onnxruntime-node' as const,
		task: 'video-keying' as const, settingsJson: JSON.stringify(settings), inputs, outputs,
		models: CORRIDORKEY_GRAPH_ARTIFACTS_V1.map(artifact => ({ modelId: 'corridorkey-2.0', version: '2.0.0',
			artifactRole: artifact.role, path: join(root, artifact.fileName), byteLength: artifact.byteLength,
			sha256: artifact.sha256, identity: IDENTITY })),
	};
	const progress: number[] = [];
	const execution: AssistanceRuntimeFamilyWorkerExecutionContext = {
		grant, settings, job: { protocolVersion: 1, jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'video-keying',
			maximumRssBytes: 8 * 1024 ** 3, maximumDurationMs: 60_000, grant,
			descriptor: { familyId: 'onnxruntime-node', runtimeVersion: '1.29.0', target: 'linux-x64',
				executionProvider: 'cpu', executionProviders: ['webgpu', 'cpu'], entrypoint: '/runtime/index.js', files: [] } },
		onProgress: value => { progress.push(value); },
	};
	return { execution, progress, bodies };
}

function adapter() {
	let creates = 0;
	let releases = 0;
	let frames = 0;
	let options: CorridorKeyOnnxFrameProcessorOptionsV1 | null = null;
	const worker = createAssistanceOnnxCorridorKeyWorkerAdapterV1(async () => runtime, {
		createProcessor: async value => {
			creates += 1;
			options = value;
			return { process: async frame => {
				frames += 1;
				const rgba = Uint8Array.from(frame.rgba);
				for (let index = 0; index < rgba.length; index += 4) {
					rgba[index] = frames;
					rgba[index + 3] = 128;
				}
				return { width: frame.width, height: frame.height, rgba };
			}, release: async () => { releases += 1; } };
		},
	});
	return { worker, state: () => ({ creates, releases, frames, options }) };
}

test('keying retains source geometry, exact VFR ticks, pack boundaries, and one continuous processor', async context => {
	const held = await fixture(context);
	const runtime = adapter();
	const result = await runtime.worker(held.execution);
	assert.equal(result.outputs.length, 2);
	assert.deepEqual([runtime.state().creates, runtime.state().releases, runtime.state().frames], [1, 1, 3]);
	assert.equal(runtime.state().options?.runtime, globalsRuntime());
	for (const [index, output] of result.outputs.entries()) {
		const bytes = await readFile(held.execution.grant.outputs[index]!.path);
		assert.equal(output.byteLength, held.bodies[index]!.byteLength);
		assert.equal(output.sha256, digest(bytes));
		assert.equal(output.claimId, held.execution.grant.outputs[index]!.claimId);
		assert.equal(output.role, 'keyed-frames');
		const reviewed = reviewAssistanceVisualFramePackV2(bytes);
		const source = reviewAssistanceVisualFramePackV2(held.bodies[index]!);
		assert.deepEqual([reviewed.sourceWidth, reviewed.sourceHeight, reviewed.rasterWidth,
			reviewed.rasterHeight, reviewed.timescale], [4, 2, 4, 2, 30_000]);
		for (let ordinal = 0; ordinal < reviewed.frameCount; ordinal += 1) {
			assert.deepEqual(reviewed.frameTiming(ordinal), source.frameTiming(ordinal));
			assert.equal(reviewed.frame(ordinal).rgba[0], source.frameTiming(ordinal).sourceFrame + 1);
			assert.equal(reviewed.frame(ordinal).rgba[3], 128);
		}
	}
	assert.equal(held.progress.at(-1), 1);
});

function globalsRuntime(): AssistanceOnnxRuntimeModuleV1 { return runtime; }

test('the runtime router selects authenticated GPU providers for all five graphs and carries RVM state across packs', async context => {
	const held = await fixture(context);
	const providers: string[][] = [];
	class Tensor implements AssistanceOnnxTensorV1 {
		constructor(readonly type: string, readonly data: Float32Array | Uint8Array | BigInt64Array,
			readonly dims: readonly number[]) {}
	}
	const f = (dims: readonly number[], fill = 0): AssistanceOnnxTensorV1 =>
		new Tensor('float32', new Float32Array(dims.reduce((a, b) => a * b, 1)).fill(fill), dims);
	const signatures = { cradio: [['rgb'], ['features']], moge: [['rgb'], ['features']],
		rvm: [['rgb', 'state'], ['features', 'state_out']],
		stage1: [['rgb', 'hint', 'moge', 'cradio', 'rvm', 'quality'], ['baton', 'aux']],
		stage2: [['rgb', 'baton'], ['logits']] } as const;
	const selected: AssistanceOnnxRuntimeModuleV1 = { Tensor, InferenceSession: { create: async (path, options) => {
		providers.push([...options.executionProviders]);
		const role = CORRIDORKEY_GRAPH_ARTIFACTS_V1.find(artifact => path.endsWith(artifact.fileName))!.role;
		return { inputNames: signatures[role][0], outputNames: signatures[role][1], release: () => {},
			run: async (feeds): Promise<Readonly<Record<string, AssistanceOnnxTensorV1>>> => {
				const h = feeds.rgb!.dims.at(-2)!;
				const w = feeds.rgb!.dims.at(-1)!;
				if (role === 'cradio') return { features: f([1, 1152, h / 16, w / 16]) };
				if (role === 'moge') return { features: f([1, 768, h / 14, w / 14]) };
				if (role === 'rvm') {
					const state = Number(feeds.state!.data[0]) + 1;
					return { features: f([1, 1, 384, h / 16, w / 16], state), state_out: f(feeds.state!.dims, state) };
				}
				if (role === 'stage1') return { baton: f([1, 1, 512, h / 16, w / 16], Number(feeds.rvm!.data[0])),
					aux: f([1, 1, 4, h / 2, w / 2]) };
				const logits = f([1, 1, 4, h, w], Number(feeds.baton!.data[0]) / 4);
				(logits.data as Float32Array).set(feeds.rgb!.data as Float32Array, h * w);
				return { logits };
			} };
	} } };
	await createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => selected })(held.execution);
	assert.equal(providers.length, 5);
	for (const provider of providers) assert.deepEqual(provider, ['webgpu', 'cpu']);
	const first = reviewAssistanceVisualFramePackV2(await readFile(held.execution.grant.outputs[0]!.path));
	const second = reviewAssistanceVisualFramePackV2(await readFile(held.execution.grant.outputs[1]!.path));
	assert.deepEqual([first.frame(0).rgba[3], first.frame(1).rgba[3], second.frame(0).rgba[3]], [64, 128, 191]);
});

test('sampled, downscaled, partial, or timing-inconsistent streams never load model sessions', async context => {
	for (const bodies of [
		[pack([1, 2])], [pack([0, 2])], [pack([0]), pack([1], { timescale: 60_000 })],
		[pack([0], { sourceWidth: 8 })], [pack([0]), pack([1], { sourceWidth: 8, rasterWidth: 8,
			frames: [{ sourceFrame: 1, presentationTick: '1001', rgba: new Uint8Array(8 * 2 * 4) }] })],
	]) {
		const held = await fixture(context, bodies);
		const runtime = adapter();
		await assert.rejects(runtime.worker(held.execution), /full|contiguous|geometry|timescale|ordinal/iu);
		assert.equal(runtime.state().creates, 0);
	}
});

test('malformed grants, model substitutions, and reservations fail before model loading', async context => {
	const held = await fixture(context);
	const original = held.execution;
	for (const execution of [
		{ ...original, settings: { ...original.settings, operation: 'saliency-detection' } },
		{ ...original, grant: { ...original.grant, outputs: original.grant.outputs.slice(1) } },
		{ ...original, grant: { ...original.grant,
			outputs: original.grant.outputs.map(output => ({ ...output, maximumByteLength: output.maximumByteLength + 1 })) } },
		{ ...original, grant: { ...original.grant, models: original.grant.models.map(model => ({ ...model, version: '2.0.1' })) } },
		{ ...original, grant: { ...original.grant, models: original.grant.models.map(model => ({ ...model, sha256: 'a'.repeat(64) })) } },
		{ ...original, settings: { ...original.settings, selectionFence: {
			...held.execution.settings.selectionFence as Record<string, unknown>, sourceEndFrame: 99 } } },
	]) {
		const runtime = adapter();
		await assert.rejects(runtime.worker(execution), /keying|CorridorKey|pinned|frame|grant|source/iu);
		assert.equal(runtime.state().creates, 0);
	}
});

test('changed input bytes cannot be inferred under an earlier authenticated claim', async context => {
	const held = await fixture(context);
	const input = held.execution.grant.inputs[0]!;
	const bytes = await readFile(input.path);
	bytes[bytes.length - 1] = 0;
	await writeFile(input.path, bytes);
	const runtime = adapter();
	await assert.rejects(runtime.worker(held.execution), /digest|identity|changed/iu);
	assert.equal(runtime.state().creates, 0);
});

test('processing failures and cancellation release the continuous processor before returning', async context => {
	for (const mode of ['failure', 'cancel', 'geometry']) {
		const held = await fixture(context);
		const cancellation = new AbortController();
		let releases = 0;
		const worker = createAssistanceOnnxCorridorKeyWorkerAdapterV1(async () => runtime, {
			createProcessor: async () => ({ release: async () => { releases += 1; }, process: async frame => {
				if (mode === 'failure') throw new Error('Model inference failed');
				if (mode === 'cancel') cancellation.abort();
				return { ...frame, width: mode === 'geometry' ? frame.width + 1 : frame.width };
			} }),
		});
		await assert.rejects(worker({ ...held.execution, signal: cancellation.signal }),
			/inference failed|aborted|geometry/iu);
		assert.equal(releases, 1);
	}
});
