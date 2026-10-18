/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import test from 'node:test';

import {
	createAssistanceOnnxGpuProfileV1,
	readAssistanceOnnxGpuProfileDirectoryV1,
	reviewAssistanceOnnxGpuProfileV1,
} from '../desktop/assistance-onnx-gpu-profile.ts';

function kernel(provider: string, name = 'MatMul_0_kernel_time') {
	return { cat: 'Node', ph: 'X', name, dur: 125, args: { provider } };
}

test('ONNX GPU proof counts executed kernels rather than requested providers or session creation', () => {
	assert.deepEqual(reviewAssistanceOnnxGpuProfileV1([
		{ cat: 'Session', ph: 'X', name: 'session_initialization', dur: 100,
			args: { provider: 'WebGpuExecutionProvider' } },
		kernel('WebGpuExecutionProvider'), kernel('CPUExecutionProvider', 'Shape_1_kernel_time'),
		kernel('WebGpuExecutionProvider', 'MatMul_0_fence_before'),
	], 'webgpu'), { gpuKernelCount: 1, cpuKernelCount: 1 });
	assert.deepEqual(reviewAssistanceOnnxGpuProfileV1([
		kernel('CoreMLExecutionProvider'),
	], 'coreml'), { gpuKernelCount: 1, cpuKernelCount: 0 });
});

test('ONNX GPU proof rejects empty, CPU-only, wrong-provider and malformed profiles', () => {
	for (const profile of [[], [kernel('CPUExecutionProvider')], [kernel('CoreMLExecutionProvider')],
		[{ ...kernel('WebGpuExecutionProvider'), dur: 0 }],
		[{ ...kernel('WebGpuExecutionProvider'), ph: 'B' }], {}, null]) {
		assert.throws(() => reviewAssistanceOnnxGpuProfileV1(profile, 'webgpu'), /GPU|profile/u);
	}
});

test('GPU transfers and fences cannot prove CPU-only model computation ran on GPU', () => {
	for (const transfer of [kernel('WebGpuExecutionProvider', 'MemcpyToHost_kernel_time'),
		kernel('WebGpuExecutionProvider', 'MemcpyFromHost_kernel_time'),
		{ ...kernel('WebGpuExecutionProvider', 'output_kernel_time'),
			args: { provider: 'WebGpuExecutionProvider', op_name: 'Memcpy' } },
		{ ...kernel('WebGpuExecutionProvider', 'event_kernel_time'),
			args: { provider: 'WebGpuExecutionProvider', op_name: 'WaitEvent' } }]) {
		assert.throws(() => reviewAssistanceOnnxGpuProfileV1([
			transfer, kernel('CPUExecutionProvider'),
		], 'webgpu'), /no executed GPU kernels/u);
	}
});

test('GPU alias and view nodes cannot certify CPU-only model arithmetic', () => {
	for (const opName of ['Identity', 'Reshape', 'Flatten', 'Squeeze', 'Unsqueeze']) {
		for (const view of [
			{ ...kernel('WebGpuExecutionProvider', 'output_kernel_time'), pid: 99,
				args: { provider: 'WebGpuExecutionProvider', op_name: opName } },
			{ ...kernel('WebGpuExecutionProvider', `${opName}_kernel_time`), pid: 99 },
			{ ...kernel('WebGpuExecutionProvider', `/model.2/${opName}_83_kernel_time`), pid: 99 },
		]) {
			assert.throws(() => reviewAssistanceOnnxGpuProfileV1([
				view, kernel('CPUExecutionProvider'),
			], 'webgpu'), /no executed GPU kernels/u);
			assert.deepEqual(reviewAssistanceOnnxGpuProfileV1([
				view, { ...kernel('WebGpuExecutionProvider'), pid: 12345 }, kernel('CPUExecutionProvider'),
			], 'webgpu'), { gpuKernelCount: 1, cpuKernelCount: 1, processIds: [12345] });
		}
	}
	assert.deepEqual(reviewAssistanceOnnxGpuProfileV1([
		{ ...kernel('WebGpuExecutionProvider', 'Identity_0_kernel_time'),
			args: { provider: 'WebGpuExecutionProvider', op_name: 'MatMul' } },
	], 'webgpu'), { gpuKernelCount: 1, cpuKernelCount: 0 });
});

test('ONNX GPU proof retains only observed native process IDs from GPU computation', () => {
	const gpu = kernel('WebGpuExecutionProvider');
	assert.deepEqual(reviewAssistanceOnnxGpuProfileV1([
		{ ...gpu, pid: 12345 }, { ...gpu, pid: 12345 }, { ...gpu, pid: 67890 },
		{ ...kernel('CPUExecutionProvider'), pid: 99 },
		{ ...kernel('WebGpuExecutionProvider', 'MemcpyToHost_kernel_time'), pid: 100 },
		...[undefined, '12345', 0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1, 0x1_0000_0000]
			.map(pid => ({ ...gpu, pid })),
	], 'webgpu'), { gpuKernelCount: 11, cpuKernelCount: 1, processIds: [12345, 67890] });
	assert.throws(() => reviewAssistanceOnnxGpuProfileV1(
		Array.from({ length: 33 }, (_, index) => ({ ...gpu, pid: index + 1 })), 'webgpu',
	), /process.*bound/u);
});

test('ONNX profile files remain private, bounded, and are removed after verification', async () => {
	const profile = await createAssistanceOnnxGpuProfileV1();
	const directory = dirname(profile.settings.profileFilePrefix);
	try {
		assert.equal(profile.settings.enableProfiling, true);
		await writeFile(`${profile.settings.profileFilePrefix}_2026-10-18.json`,
			JSON.stringify([kernel('WebGpuExecutionProvider')]));
		assert.deepEqual(await profile.review('webgpu'), { gpuKernelCount: 1, cpuKernelCount: 0 });
	} finally { await profile.dispose(); }
	await assert.rejects(access(directory), { code: 'ENOENT' });
	await profile.dispose();
});

test('ONNX profile verification rejects missing or ambiguous trace files', async () => {
	const profile = await createAssistanceOnnxGpuProfileV1();
	try {
		await assert.rejects(profile.review('webgpu'), /one.*profile/u);
		for (const suffix of ['_first.json', '_second.json']) {
			await writeFile(`${profile.settings.profileFilePrefix}${suffix}`,
				JSON.stringify([kernel('WebGpuExecutionProvider')]));
		}
		await assert.rejects(profile.review('webgpu'), /one.*profile/u);
	} finally { await profile.dispose(); }
});

test('a native multi-session model aggregates only its own bounded kernel profiles', async () => {
	const profile = await createAssistanceOnnxGpuProfileV1();
	try {
		for (const [suffix, events] of [
			['_encoder.json', [{ ...kernel('WebGpuExecutionProvider'), pid: 12345 }]],
			['_decoder.json', [{ ...kernel('WebGpuExecutionProvider'), pid: 12345 }, kernel('CPUExecutionProvider')]],
		] as const) await writeFile(`${profile.settings.profileFilePrefix}${suffix}`, JSON.stringify(events));
		await writeFile(`${dirname(profile.settings.profileFilePrefix)}/foreign_trace.json`, 'invalid foreign profile');
		assert.deepEqual(await readAssistanceOnnxGpuProfileDirectoryV1(
			dirname(profile.settings.profileFilePrefix), profile.settings.profileFilePrefix, 'WebGpuExecutionProvider',
		), { gpuKernelCount: 2, cpuKernelCount: 1, processIds: [12345] });
	} finally { await profile.dispose(); }
});
