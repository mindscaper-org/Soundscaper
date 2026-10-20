/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createAssistanceLlamaCppWorkerSpawnerV1, type AssistanceLlamaCppSpawn } from '../desktop/assistance-llama-cpp-worker.ts';
import { createAssistanceWhisperCppWorkerSpawnerV1, type AssistanceWhisperCppSpawn } from '../desktop/assistance-whisper-cpp-worker.ts';
import { createAssistanceNativeGpuExecutorV1 } from '../desktop/assistance-native-gpu-execution.ts';
import { NativeGpuTestChild, nativeGpuWorkerFixture } from './helpers/desktop-assistance-native-gpu-worker-fixture.ts';

async function environment(context: TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'native-gpu-validation-'));
	const keys = ['SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS', 'SOUNDSCAPER_ASSISTANCE_GPU_VALIDATION', 'SOUNDSCAPER_ASSISTANCE_GPU_EVIDENCE_ROOT'];
	const saved = keys.map(key => process.env[key]);
	process.env.SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS = '1';
	process.env.SOUNDSCAPER_ASSISTANCE_GPU_VALIDATION = '1';
	process.env.SOUNDSCAPER_ASSISTANCE_GPU_EVIDENCE_ROOT = root;
	context.after(async () => {
		for (const [index, key] of keys.entries()) {
			if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index];
		}
		await rm(root, { recursive: true, force: true });
	});
	return root;
}

for (const family of ['whisper-cpp', 'llama-cpp'] as const) {
	for (const receipt of [true, false]) test(`${family} requires actual compute proof before completing strict inference (receipt=${receipt})`, async context => {
		const root = await environment(context);
		const fixture = await nativeGpuWorkerFixture(context, family);
		const spawn: AssistanceLlamaCppSpawn = (_executable, args, options) => {
			if (family === 'llama-cpp') {
				assert.equal(options.env.SOUNDSCAPER_ASSISTANCE_GPU_VALIDATION, '1');
				assert.ok(args.includes('--no-warmup'), 'proof must come from model inference, not a warmup graph');
			}
			const child = new NativeGpuTestChild();
			queueMicrotask(() => {
				if (receipt) child.stderr.end(`SOUNDSCAPER_GPU_COMPUTE_V1 provider=vulkan gpu=12 cpu=2 device=${Buffer.from('GPU').toString('hex')}\n`);
				child.stdout.end(fixture.body);
				child.emit('close', 0, null);
			});
			return child;
		};
		const spawner = family === 'llama-cpp' ? createAssistanceLlamaCppWorkerSpawnerV1({ spawn })
			: createAssistanceWhisperCppWorkerSpawnerV1({ spawn: spawn as AssistanceWhisperCppSpawn });
		const completion = spawner(fixture.job, { onProgress: () => {} }).completion;
		if (receipt) {
			await completion;
			const names = await readdir(root);
			assert.equal(names.length, 1);
			const evidence = JSON.parse(await readFile(join(root, names[0]!), 'utf8')) as { familyId: string; gpuWorkCount: number };
			assert.equal(evidence.familyId, family);
			assert.equal(evidence.gpuWorkCount, 12);
		} else await assert.rejects(completion, /compute receipt/u);
	});

	test(`${family} strict mode forbids CPU-only descriptors and failed GPU fallback`, async context => {
		await environment(context);
		const { job } = await nativeGpuWorkerFixture(context, family);
		assert.throws(() => createAssistanceNativeGpuExecutorV1({ ...job.descriptor,
			executionProviders: ['cpu'], accelerationEntrypoints: undefined }), /GPU runtime/u);
		let attempts = 0;
		const spawn: AssistanceLlamaCppSpawn = () => {
			attempts++;
			const child = new NativeGpuTestChild();
			queueMicrotask(() => child.emit('close', 1, null));
			return child;
		};
		const spawner = family === 'llama-cpp' ? createAssistanceLlamaCppWorkerSpawnerV1({ spawn })
			: createAssistanceWhisperCppWorkerSpawnerV1({ spawn: spawn as AssistanceWhisperCppSpawn });
		await assert.rejects(spawner(job, { onProgress: () => {} }).completion, /did not complete successfully/u);
		assert.equal(attempts, 1);
	});
}
