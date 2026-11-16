/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createAssistanceBasicPitchWorkerAdapterV1 } from '../desktop/assistance-onnx-basic-pitch-worker.ts';
import { createAssistanceOnnxRuntimeWorkerAdapterV1 } from '../desktop/assistance-onnx-runtime-worker.ts';
import type { AssistanceOnnxRuntimeModuleV1, AssistanceOnnxTensorV1 } from '../desktop/assistance-onnx-runtime-worker.ts';
import { captureAssistanceRuntimeFamilyJobGrantV1 } from '../desktop/assistance-runtime-family-file-grants.ts';
import { runAssistanceRuntimeFamilyWorkerJobV1 } from '../desktop/assistance-runtime-family-worker-entry.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { onnxGpuDescriptorFixture } from './helpers/desktop-assistance-onnx-gpu-fixture.ts';
import { validateAssistanceRuntimeFamilyDescriptorV1 } from '../desktop/assistance-runtime-family-process-protocol.ts';

const inputName = 'serving_default_input_2:0';
const outputNames = ['StatefulPartitionedCall:2', 'StatefulPartitionedCall:1', 'StatefulPartitionedCall:0'];
function tensor(data: Float32Array, dims: readonly number[]): AssistanceOnnxTensorV1 { return { type: 'float32', data, dims }; }
function runtime(run: (feeds: Readonly<Record<string, AssistanceOnnxTensorV1>>) => Promise<Readonly<Record<string, AssistanceOnnxTensorV1>>>,
	options: { created?: (settings: Parameters<AssistanceOnnxRuntimeModuleV1['InferenceSession']['create']>[1]) => void; released?: () => void } = {}): AssistanceOnnxRuntimeModuleV1 {
	class Tensor { constructor(readonly type: 'float32' | 'int64' | 'uint8', readonly data: Float32Array | BigInt64Array | Uint8Array, readonly dims: readonly number[]) {} }
	return { Tensor, InferenceSession: { create: async (_path, settings) => {
		options.created?.(settings);
		return { inputNames: [inputName], outputNames, run, release: async () => { options.released?.(); } };
	} } };
}
function predictions() {
	const notes = new Float32Array(172 * 88);
	const onsets = new Float32Array(172 * 88);
	for (const pitch of [60, 64, 67]) {
		for (let t = 20; t < 70; t++) notes[t * 88 + pitch - 21] = 0.8;
		onsets[20 * 88 + pitch - 21] = 0.9;
	}
	return { [outputNames[0]!]: tensor(onsets, [1, 172, 88]), [outputNames[1]!]: tensor(notes, [1, 172, 88]),
		[outputNames[2]!]: tensor(new Float32Array(172 * 264), [1, 172, 264]) };
}
async function fixture(context: TestContext, sampleCount = 22_050) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-basic-pitch-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const input = join(root, 'audio.wav'), output = join(root, 'notes.json'), model = join(root, 'nmp.onnx');
	const pcm = new Float32Array(sampleCount); pcm[0] = 0.25;
	const wave = encodeWav([pcm], { sampleRate: 22_050, bitDepth: 32, float: true, dither: false });
	const bytes = Buffer.from('fixture-network');
	await Promise.all([writeFile(input, wave), writeFile(output, new Uint8Array()), writeFile(model, bytes)]);
	const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
	const jobId = '1'.repeat(40);
	const grant = await captureAssistanceRuntimeFamilyJobGrantV1({ jobId, familyId: 'onnxruntime-node', task: 'music-transcription',
		settingsJson: JSON.stringify({ schemaVersion: 1, operation: 'music-transcription', inputRoles: ['audio'], outputRoles: ['midi-notes'] }),
		inputs: [{ path: input, claim: { claimVersion: 1, claimId: '2'.repeat(40), jobId, role: 'audio', mediaType: 'audio/wav', byteLength: wave.byteLength, sha256: sha(wave) } }],
		models: [{ modelId: 'basic-pitch', version: '1.0.0', artifactRole: 'nmp', path: model, byteLength: bytes.length, sha256: sha(bytes) }],
		outputs: [{ path: output, reservation: { claimVersion: 1, claimId: '3'.repeat(40), jobId, role: 'midi-notes',
			mediaType: 'application/vnd.soundscaper.midi-notes+json', maximumByteLength: 8 * 1024 ** 2 } }],
	});
	const job = { protocolVersion: 1 as const, jobId, familyId: 'onnxruntime-node' as const, task: 'music-transcription' as const,
		maximumRssBytes: 1024 ** 3, maximumDurationMs: 60_000, grant,
		descriptor: { familyId: 'onnxruntime-node' as const, runtimeVersion: '1.29.0', target: 'linux-x64' as const,
			executionProvider: 'cpu' as const, entrypoint: '/runtime/onnx.js', files: [{ path: '/runtime/onnx.js', relativePath: 'onnx.js', byteLength: 1, sha256: '4'.repeat(64), executable: false }] } };
	return { job, output };
}

test('Basic Pitch uses the exact graph, pads the first window and publishes polyphonic note events', async context => {
	const value = await fixture(context);
	let released = 0;
	const module = runtime(async feeds => {
		const input = feeds[inputName]!;
		assert.deepEqual(input.dims, [1, 43_844, 1]);
		assert.equal(input.data[0], 0);
		assert.equal(input.data[3840], 0.25);
		return predictions();
	}, { released: () => { released++; } });
	await runAssistanceRuntimeFamilyWorkerJobV1({ job: value.job, execute: createAssistanceBasicPitchWorkerAdapterV1(async () => module) });
	const result = JSON.parse(await readFile(value.output, 'utf8')) as { sampleCount: number; notes: { pitch: number; startSample: number }[] };
	assert.equal(result.sampleCount, 22_050);
	assert.deepEqual(result.notes.map(n => [n.pitch, n.startSample]), [[60, 1280], [64, 1280], [67, 1280]]);
	assert.equal(released, 1);
});

test('a corrupt Basic Pitch tensor is rejected without publishing an output', async context => {
	const value = await fixture(context);
	const module = runtime(async () => {
		const output = predictions(); output[outputNames[1]!] = tensor(new Float32Array(2), [1, 172, 88]); return output;
	});
	await assert.rejects(() => runAssistanceRuntimeFamilyWorkerJobV1({ job: value.job,
		execute: createAssistanceBasicPitchWorkerAdapterV1(async () => module) }), /tensor/iu);
	assert.equal((await readFile(value.output)).length, 0);
});

test('Basic Pitch dispatch preserves the authenticated GPU preference on every desktop target', async context => {
	for (const target of ['mac-arm64', 'linux-x64', 'linux-arm64', 'win-x64', 'win-arm64'] as const) {
		const value = await fixture(context);
		const provider = target === 'mac-arm64' ? 'coreml' : 'webgpu';
		let creations = 0;
		const module = runtime(async () => predictions(), { created: settings => {
			creations++;
			assert.deepEqual(settings.executionProviders, [provider, 'cpu']);
		} });
		await runAssistanceRuntimeFamilyWorkerJobV1({ job: { ...value.job,
			descriptor: validateAssistanceRuntimeFamilyDescriptorV1(onnxGpuDescriptorFixture(target)),
		}, execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => module }) });
		assert.equal(creations, 1);
		assert.ok((await readFile(value.output)).length > 0);
	}
});
