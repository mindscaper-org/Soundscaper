/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { captureAssistanceRuntimeFamilyJobGrantV1 } from '../desktop/assistance-runtime-family-file-grants.ts';
import { runAssistanceRuntimeFamilyWorkerJobV1 } from '../desktop/assistance-runtime-family-worker-entry.ts';
import { createAssistanceOnnxRuntimeWorkerAdapterV1,
	type AssistanceOnnxRuntimeModuleV1, type AssistanceOnnxTensorV1 } from '../desktop/assistance-onnx-runtime-worker.ts';
import { voiceFixerMelFilterFixture } from './helpers/voicefixer-mel-filter-fixture.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { onnxGpuDescriptorFixture } from './helpers/desktop-assistance-onnx-gpu-fixture.ts';
import { validateAssistanceRuntimeFamilyDescriptorV1 } from '../desktop/assistance-runtime-family-process-protocol.ts';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const JOB = 'a'.repeat(40);

async function fixture(t: TestContext, frames: number, gpu = false, version = '1.0.0') {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-reuse-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const channels = [new Float32Array(frames).fill(0.5), new Float32Array(frames).fill(-0.25)];
	const bytes = encodeWav(channels, { sampleRate: 48_000, bitDepth: 32, float: true, dither: false });
	const model = Buffer.from('authenticated-fixture');
	const inputPath = join(root, 'input.wav'), outputPath = join(root, 'output.wav');
	const roles = ['analysis', 'vocoder', 'mel_filters'];
	const modelBytes = (role: string) => role === 'mel_filters' ? voiceFixerMelFilterFixture() : model;
	await Promise.all([writeFile(inputPath, bytes), writeFile(outputPath, ''),
		...roles.map(role => writeFile(join(root, `${role}.onnx`), modelBytes(role)))]);
	const grant = await captureAssistanceRuntimeFamilyJobGrantV1({ jobId: JOB,
		familyId: 'onnxruntime-node', task: 'speech-enhancement',
		settingsJson: JSON.stringify({ schemaVersion: 1, operation: 'speech-enhancement',
			inputRoles: ['audio'], outputRoles: ['enhanced-audio'] }),
		inputs: [{ path: inputPath, claim: { claimVersion: 1, claimId: 'b'.repeat(40), jobId: JOB,
			role: 'audio', mediaType: 'audio/wav', byteLength: bytes.length, sha256: hash(bytes) } }],
		models: roles.map(role => ({ modelId: 'voicefixer', version, artifactRole: role, path: join(root, `${role}.onnx`),
			byteLength: modelBytes(role).length, sha256: hash(modelBytes(role)) })),
		outputs: [{ path: outputPath, reservation: { claimVersion: 1, claimId: 'c'.repeat(40), jobId: JOB,
			role: 'enhanced-audio', mediaType: 'audio/wav', maximumByteLength: bytes.length } }],
	});
	const descriptor = gpu ? validateAssistanceRuntimeFamilyDescriptorV1(onnxGpuDescriptorFixture('linux-x64'))
		: { familyId: 'onnxruntime-node' as const, runtimeVersion: '1.29.0', target: 'linux-x64' as const,
			executionProvider: 'cpu' as const, entrypoint: '/runtime/index.js',
			files: [{ path: '/runtime/index.js', relativePath: 'index.js', byteLength: 1,
				sha256: '6'.repeat(64), executable: false }] };
	return { channels, outputPath, job: { protocolVersion: 1 as const, jobId: JOB,
		familyId: 'onnxruntime-node' as const, task: 'speech-enhancement' as const,
		maximumRssBytes: 8 * 1024 ** 3, maximumDurationMs: 60_000, grant, descriptor } };
}

function runtime(options: { fail?: 'nan' | 'shape' | 'names'; onRun?: () => void } = {}) {
	let releases = 0, calls = 0;
	const providers: unknown[] = [];
	class Tensor implements AssistanceOnnxTensorV1 {
		constructor(readonly type: 'uint8' | 'float32' | 'int64',
			readonly data: Uint8Array | Float32Array | BigInt64Array, readonly dims: readonly number[]) {}
	}
	const module: AssistanceOnnxRuntimeModuleV1 = { Tensor, InferenceSession: {
		create: async (path, config) => {
			providers.push(config.executionProviders);
			const analysis = path.endsWith('analysis.onnx');
			return { inputNames: options.fail === 'names' ? ['foreign'] : analysis ? ['mel_orig'] : ['mel'],
				outputNames: analysis ? ['mel'] : ['wav'],
				run: async (feeds): Promise<Readonly<Record<string, AssistanceOnnxTensorV1>>> => {
					if (analysis) {
						calls += 1; options.onRun?.();
						assert.deepEqual(feeds.mel_orig!.dims, [1, 1, 501, 128]);
						assert.ok(Math.abs((feeds.mel_orig!.data as Float32Array)[0]! - (calls % 2 === 1 ? 512 : 256)) < 1e-3);
						return { mel: new Tensor('float32', new Float32Array(501 * 128).fill(1), [1, 1, 501, 128]) };
					}
					assert.ok((feeds.mel!.data as Float32Array).every(value => value === 10));
					const output = new Float32Array(223_146).fill(calls % 2 === 1 ? 0.25 : -0.125);
					if (options.fail === 'nan') output[0] = Number.NaN;
					return { wav: new Tensor('float32', output, options.fail === 'shape' ? [223_146] : [1, 1, 223_146]) };
				}, release: () => { releases += 1; } };
		},
	} };
	return { module, providers, get releases() { return releases; }, get calls() { return calls; } };
}

for (const frames of [1, 159, 239_999, 271_003]) test(`VoiceFixer streams ${frames} frames without shifting stereo or the final partial block`, async t => {
	const f = await fixture(t, frames), r = runtime();
	const progress: number[] = [];
	const result = await runAssistanceRuntimeFamilyWorkerJobV1({ job: f.job,
		onProgress: value => progress.push(value),
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => r.module }) });
	const bytes = await readFile(f.outputPath), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	assert.equal(bytes.length, 44 + frames * 8); assert.equal(view.getUint32(24, true), 48_000);
	for (let i = 0; i < frames; i += 1) for (let c = 0; c < 2; c += 1) {
		assert.ok(Math.abs(view.getFloat32(44 + (2 * i + c) * 4, true) - (c === 0 ? 0.25 : -0.125)) < 1e-6);
	}
	assert.equal(result.outputs[0]!.sha256, hash(bytes)); assert.equal(r.releases, 2);
	assert.equal(r.calls, 2 * (Math.ceil(frames / 120_000) + 1));
	assert.equal(progress[0], 0); assert.equal(progress.at(-1), 1);
	assert.ok(progress.every((value, i) => i === 0 || value >= progress[i - 1]!));
});

test('VoiceFixer retains the authenticated GPU provider choice', async t => {
	const f = await fixture(t, 50, true), r = runtime();
	await runAssistanceRuntimeFamilyWorkerJobV1({ job: f.job,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => r.module }) });
	assert.deepEqual(r.providers, [['webgpu', 'cpu'], ['webgpu', 'cpu']]);
});

for (const fail of ['nan', 'shape', 'names'] as const) test(`VoiceFixer rejects ${fail} output and publishes no partial WAV`, async t => {
	const f = await fixture(t, 240_001), r = runtime({ fail });
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({ job: f.job,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => r.module }) }));
	assert.equal((await readFile(f.outputPath)).length, 0); assert.equal(r.releases, fail === 'names' ? 1 : 2);
});

test('VoiceFixer rejects a substituted model version before loading native code', async t => {
	const f = await fixture(t, 50, false, '2.0.0'); let loaded = false;
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({ job: f.job,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => {
			loaded = true; return runtime().module;
		} }) }));
	assert.equal(loaded, false);
});

test('cancelling VoiceFixer between chunks releases the session and leaves the reservation empty', async t => {
	const f = await fixture(t, 271_003), signal = new AbortController();
	const r = runtime({ onRun: () => { signal.abort(); } });
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({ job: f.job, signal: signal.signal,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => r.module }) }));
	assert.equal(r.calls, 1); assert.equal(r.releases, 2); assert.equal((await readFile(f.outputPath)).length, 0);
});
