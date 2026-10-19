/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { Worker } from 'node:worker_threads';
import { createSherpaNativeExecutorV1, callSherpaNativeV1 } from '../desktop/assistance-sherpa-acceleration.ts';
import { createSherpaGpuProfileProvider, createValidatedSherpaSpeechJob } from '../desktop/assistance-sherpa-gpu-validation.ts';
import { createAssistanceSpeechJobRunner } from '../desktop/assistance-helper-job.js';

const jobId = 'a'.repeat(40);
const modelId = 'silero-vad-v5';
const file = (role: string) => ({ role, path: `/fixture/${role}`, bytes: 1,
	sha256: 'b'.repeat(64), identity: { dev: '1', ino: '2' } });
const grant = { operation: 'detect-voice-activity', moduleId: 'sherpa-onnx-node', modelId,
	audio: file('audio'), model: file('vad-model') };

async function environment(context: TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'sherpa-validation-'));
	const previous = { ...process.env };
	process.env.SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS = '1';
	process.env.SOUNDSCAPER_ASSISTANCE_GPU_VALIDATION = '1';
	process.env.SOUNDSCAPER_ASSISTANCE_GPU_EVIDENCE_ROOT = root;
	context.after(async () => {
		for (const key of ['SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS', 'SOUNDSCAPER_ASSISTANCE_GPU_VALIDATION',
			'SOUNDSCAPER_ASSISTANCE_GPU_EVIDENCE_ROOT']) {
			if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
		}
		await rm(root, { recursive: true, force: true });
	});
	return root;
}

test('strict Sherpa rejects CPU-only capability and never retries CPU after GPU failure', async context => {
	await environment(context);
	assert.throws(() => createSherpaNativeExecutorV1(), /GPU provider/u);
	assert.throws(() => createSherpaNativeExecutorV1({ executionProviders: ['coreml', 'cpu'] }), /GPU provider/u);
	assert.equal(await createSherpaNativeExecutorV1({ executionProviders: ['coreml', 'webgpu', 'cpu'] })
		.run(undefined, provider => provider), 'webgpu');
	const seen: string[] = [];
	await assert.rejects(createSherpaNativeExecutorV1({ executionProviders: ['webgpu', 'cpu'] }).run(undefined, provider => {
		seen.push(provider);
		return callSherpaNativeV1(() => { throw new Error('device failed'); });
	}), /device failed/u);
	assert.deepEqual(seen, ['webgpu']);
});

for (const cpuOnly of [false, true]) test(`Sherpa validates flushed native work after worker exit (CPU-only=${cpuOnly})`, async context => {
	const root = await environment(context);
	let announce!: (worker: FakeWorker) => void;
	const started = new Promise<FakeWorker>(resolve => { announce = resolve; });
	class FakeWorker extends EventEmitter {
		readonly plan: { directory: string; modelIds: string[] };
		constructor(_entry: URL, options: { workerData: unknown }) {
			super();
			this.plan = (options.workerData as { gpuValidation: { directory: string; modelIds: string[] } }).gpuValidation;
			queueMicrotask(() => {
				const profiling = createSherpaGpuProfileProvider(this.plan);
				assert.equal(profiling.providerForModel(modelId, 'webgpu'), `webgpu:${join(this.plan.directory, `${modelId}-webgpu.config`)}`);
				this.emit('message', { type: 'gpu-profiles', selections: profiling.selections() });
				this.emit('message', { type: 'result', result: { sampleRate: 16000, segments: [] } });
				announce(this);
			});
		}
		async terminate() { this.emit('exit', 1); return 1; }
	}
	const run = createValidatedSherpaSpeechJob({ jobId, grant, WorkerImpl: FakeWorker,
		workerEntry: new URL('file:///fixture/worker.js'), onProgress: () => {} });
	let settled = false;
	void run.completion.then(() => { settled = true; }, () => { settled = true; });
	const active = await started;
	assert.equal(settled, false, 'success must wait for native finalizers to flush the profile');
	const configuration = await readFile(join(active.plan.directory, `${modelId}-webgpu.config`), 'utf8');
	assert.equal(configuration, `ProfilingFilePrefix=${join(active.plan.directory, `${modelId}-webgpu`)}\n`);
	await writeFile(join(active.plan.directory, `${modelId}-webgpu_flushed.json`), JSON.stringify([
		{ cat: 'Node', ph: 'X', name: 'MatMul_kernel_time', dur: 100, pid: 12345, args: {
			provider: cpuOnly ? 'CPUExecutionProvider' : 'WebGpuExecutionProvider', op_name: 'MatMul' } },
	]));
	active.emit('exit', 0);
	if (cpuOnly) await assert.rejects(run.completion, /GPU|kernel|WebGpu/u);
	else {
		assert.deepEqual(await run.completion, { sampleRate: 16000, segments: [] });
		const names = await readdir(root);
		assert.equal(names.length, 1);
		const receipt = JSON.parse(await readFile(join(root, names[0]!), 'utf8')) as {
			jobId: string; modelIds: string[]; gpuWorkCount: number; processIds?: number[];
		};
		assert.equal(receipt.jobId, jobId);
		assert.deepEqual(receipt.modelIds, [modelId]);
		assert.equal(receipt.gpuWorkCount, 1);
		assert.deepEqual(receipt.processIds, [12345]);
	}
	assert.equal((await readdir(root)).some(name => name.startsWith('sherpa-profile-')), false);
});

test('Sherpa profiling refuses escaped directories', async context => {
	await environment(context);
	assert.throws(() => createSherpaGpuProfileProvider({ directory: tmpdir(), modelIds: [modelId] }), /escaped/u);
});

test('strict speech helper cancellation waits for validation preparation and never starts native work', async context => {
	await environment(context);
	let release!: (value: { createValidatedSherpaSpeechJob: typeof createValidatedSherpaSpeechJob }) => void;
	const loading = new Promise<{ createValidatedSherpaSpeechJob: typeof createValidatedSherpaSpeechJob }>(resolve => { release = resolve; });
	let started = 0;
	class UnusedWorker extends EventEmitter {
		constructor() { super(); started++; }
		async terminate() { return 0; }
	}
	const run = createAssistanceSpeechJobRunner({ WorkerImpl: UnusedWorker as unknown as typeof Worker,
		loadGpuValidation: () => loading })({ jobId, grant, onProgress: () => {} });
	let quiescent = false;
	const cancellation = run.cancel().then(() => { quiescent = true; });
	await Promise.resolve();
	assert.equal(quiescent, false);
	release({ createValidatedSherpaSpeechJob });
	await cancellation;
	await assert.rejects(run.completion, /cancelled/u);
	assert.equal(started, 0);
});
