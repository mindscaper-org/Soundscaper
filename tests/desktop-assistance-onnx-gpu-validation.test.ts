/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import test from 'node:test';

import { createAssistanceOnnxGpuValidatedRuntimeV1 } from '../desktop/assistance-onnx-gpu-validation.ts';
import type { AssistanceOnnxRuntimeModuleV1 } from '../desktop/assistance-onnx-runtime-worker.ts';

test('strict ONNX validation rejects missing GPU providers and never retries inference on CPU', async () => {
	let calls = 0;
	const runtime = { Tensor: class {}, InferenceSession: { create: async () => {
		calls += 1;
		return { inputNames: ['x'], outputNames: ['y'], run: async () => { throw new Error('device lost'); },
			endProfiling() {}, release() {} };
	} } } as unknown as AssistanceOnnxRuntimeModuleV1;
	assert.throws(() => createAssistanceOnnxGpuValidatedRuntimeV1(runtime, [], () => undefined, () => {}), /GPU/u);
	assert.throws(() => createAssistanceOnnxGpuValidatedRuntimeV1(runtime, ['coreml'], () => undefined, () => {}), /WebGPU/u);
	assert.equal(calls, 0, 'CoreML-only validation must fail before creating any native session');
	const wrapped = createAssistanceOnnxGpuValidatedRuntimeV1(runtime, ['webgpu'], () => undefined, () => {});
	const session = await wrapped.InferenceSession.create('/model.onnx', settings);
	await assert.rejects(async () => session.run({}), /device lost/u);
	await session.release?.();
	assert.equal(calls, 1);
});

const settings = { executionProviders: ['cpu'] as const, graphOptimizationLevel: 'all' as const,
	interOpNumThreads: 1 as const, intraOpNumThreads: 4 as const };

test('strict ONNX validation proves model GPU kernels before final release and retains its actual outputs', async () => {
	const events: string[] = [];
	const proofs: unknown[] = [];
	let creations = 0;
	const output = { y: { type: 'float32', data: Float32Array.of(42), dims: [1] } };
	const runtime = { Tensor: class {}, InferenceSession: { create: async (_path: string, options: typeof settings & { profileFilePrefix: string }) => {
		creations += 1;
		assert.deepEqual(options.executionProviders, ['webgpu', 'cpu']);
		return { inputNames: ['x'], outputNames: ['y'], run: async () => { events.push('run'); return output; },
			endProfiling() {
				events.push('profile');
				writeFileSync(`${options.profileFilePrefix}_trace.json`, JSON.stringify([
					{ cat: 'Node', ph: 'X', name: 'MatMul_kernel_time', dur: 50, pid: 12345,
						args: { provider: 'WebGpuExecutionProvider' } },
				]));
			}, release() { events.push('release'); } };
	} } } as unknown as AssistanceOnnxRuntimeModuleV1;
	const wrapped = createAssistanceOnnxGpuValidatedRuntimeV1(runtime, ['coreml', 'webgpu'], () => undefined,
		proof => { events.push('proof'); proofs.push(proof); });
	const session = await wrapped.InferenceSession.create('/model.onnx', settings);
	assert.equal(await session.run({}), output);
	assert.equal(creations, 1, 'WebGPU must be selected directly ahead of CoreML in strict validation');
	assert.deepEqual(proofs, []);
	await session.release?.();
	await session.release?.();
	assert.deepEqual(events, ['run', 'profile', 'proof', 'release']);
	assert.deepEqual(proofs, [{ provider: 'webgpu', gpuKernelCount: 1, cpuKernelCount: 0, processIds: [12345] }]);
});

test('strict ONNX validation rejects a native session without profiling support and retains creation errors', async () => {
	let releases = 0;
	const runtime = { Tensor: class {}, InferenceSession: { create: async () => ({
		inputNames: [], outputNames: [], run: async () => ({}), release() { releases += 1; },
	}) } } as unknown as AssistanceOnnxRuntimeModuleV1;
	const wrapped = createAssistanceOnnxGpuValidatedRuntimeV1(runtime, ['webgpu'], () => undefined, () => {});
	await assert.rejects(async () => wrapped.InferenceSession.create('/model.onnx', settings), /profiling/u);
	assert.equal(releases, 1);
	const cause = new Error('no adapter');
	const rejected = createAssistanceOnnxGpuValidatedRuntimeV1({ ...runtime,
		InferenceSession: { create: async () => { throw cause; } },
	}, ['webgpu'], () => undefined, () => {});
	await assert.rejects(async () => rejected.InferenceSession.create('/model.onnx', settings),
		(error: unknown) => error instanceof AggregateError && error.errors.includes(cause));
});

test('a requested GPU session that actually runs entirely on CPU fails validation and releases its resources', async () => {
	let released = false, proved = false;
	const runtime = { Tensor: class {}, InferenceSession: { create: async (_path: string, options: { profileFilePrefix: string }) => ({
		inputNames: ['x'], outputNames: ['y'], run: async () => ({}),
		endProfiling() {
			writeFileSync(`${options.profileFilePrefix}_trace.json`, JSON.stringify([
				{ cat: 'Node', ph: 'X', name: 'MatMul_kernel_time', dur: 50,
					args: { provider: 'CPUExecutionProvider' } },
			]));
		}, release() { released = true; },
	}) } } as unknown as AssistanceOnnxRuntimeModuleV1;
	const wrapped = createAssistanceOnnxGpuValidatedRuntimeV1(runtime, ['webgpu'], () => undefined,
		() => { proved = true; });
	const session = await wrapped.InferenceSession.create('/model.onnx', settings);
	await session.run({});
	await assert.rejects(async () => session.release?.(), /no executed GPU kernels/u);
	assert.equal(released, true);
	assert.equal(proved, false);
});
