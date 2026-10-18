/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	assertModelGpuEvidence,
	readModelGpuEvidence,
} from './electron/local-assistance-models/model-gpu-evidence.ts';

const model = { modelId: 'kokoro-82m-v1.0', task: 'text-to-speech' };
const context = { jobId: 'job-1', models: [model] };
const receipt = (familyId = 'onnxruntime-node') => ({
	schemaVersion: 1, jobId: context.jobId, familyId, modelIds: [model.modelId],
	provider: 'webgpu', proof: 'onnx-profile', gpuWorkCount: 7, cpuWorkCount: 2,
});
const kokoroReceipts = () => [receipt(), receipt('kokoro-g2p')];

test('GPU correctness evidence covers Kokoro inference and its offline phonemizer, allowing CPU shape work', () => {
	assert.doesNotThrow(() => assertModelGpuEvidence(kokoroReceipts(), context));
	assert.throws(() => assertModelGpuEvidence([receipt()], context), /kokoro-g2p/u);
	assert.throws(() => assertModelGpuEvidence([], context), /GPU execution evidence/u);
});

test('Kokoro requires learned G2P GPU evidence for both English variants and synthesis GPU evidence for all nine languages', () => {
	for (const language of ['a', 'b']) {
		assert.doesNotThrow(() => assertModelGpuEvidence(kokoroReceipts(), { ...context, language }));
		assert.throws(() => assertModelGpuEvidence([receipt()], { ...context, language }), /kokoro-g2p/u);
	}
	for (const language of ['e', 'f', 'h', 'i', 'j', 'p', 'z']) {
		assert.doesNotThrow(() => assertModelGpuEvidence([receipt()], { ...context, language }));
		assert.throws(() => assertModelGpuEvidence([], { ...context, language }), /GPU execution evidence/u);
	}
});

test('GPU correctness evidence rejects CPU selection, requested-only proof, and zero actual GPU work', () => {
	for (const replacement of [
		{ provider: 'cpu' }, { proof: 'requested-provider' }, { gpuWorkCount: 0 },
		{ gpuWorkCount: -1 }, { gpuWorkCount: Number.NaN }, { cpuWorkCount: -1 },
	]) {
		assert.throws(() => assertModelGpuEvidence([
			{ ...receipt(), ...replacement }, receipt('kokoro-g2p'),
		], context), /GPU|proof|count/u);
	}
});

test('GPU correctness evidence cannot reuse another language job or omit one model in a multi-model operation', () => {
	assert.throws(() => assertModelGpuEvidence(kokoroReceipts(), { ...context, jobId: 'job-2' }), /job/u);
	const models = [
		{ modelId: 'face', task: 'face-detection' },
		{ modelId: 'objects', task: 'object-detection' },
	];
	assert.throws(() => assertModelGpuEvidence([
		{ ...receipt(), modelIds: ['face'] },
	], { jobId: context.jobId, models }), /objects/u);
	assert.doesNotThrow(() => assertModelGpuEvidence([
		{ ...receipt(), modelIds: ['face'] }, { ...receipt(), modelIds: ['objects'] },
	], { jobId: context.jobId, models }));
});

test('GPU correctness evidence requires the native computation proof for the bound runtime family', () => {
	const models = [{ modelId: 'qwen', task: 'editorial-generation' }];
	const native = { ...receipt('llama-cpp'), modelIds: ['qwen'], provider: 'vulkan',
		proof: 'ggml-compute', deviceName: 'NVIDIA GeForce RTX 3090' };
	assert.doesNotThrow(() => assertModelGpuEvidence([native], { jobId: context.jobId, models }));
	assert.throws(() => assertModelGpuEvidence([{ ...native, proof: 'onnx-profile' }],
		{ jobId: context.jobId, models }), /proof/u);
	assert.throws(() => assertModelGpuEvidence([{ ...native, provider: 'webgpu' }],
		{ jobId: context.jobId, models }), /provider/u);
	assert.throws(() => assertModelGpuEvidence([{ ...native, modelIds: ['unrelated'] }],
		{ jobId: context.jobId, models }), /model/u);
});

test('private GPU receipts preserve optional exact inference process identities without requiring them', () => {
	assert.doesNotThrow(() => assertModelGpuEvidence(kokoroReceipts(), context));
	assert.doesNotThrow(() => assertModelGpuEvidence([
		{ ...receipt(), processIds: [1234, 5678] }, receipt('kokoro-g2p'),
	], context));
	for (const processIds of [[], [0], [-1], [1.5], [Number.NaN], [0x1_0000_0000], [1234, 1234], ['1234'],
		Array.from({ length: 33 }, (_, index) => index + 1)]) {
		assert.throws(() => assertModelGpuEvidence([
			{ ...receipt(), processIds }, receipt('kokoro-g2p'),
		], context), /process/u);
	}
});

test('GPU evidence reader selects the exact job from private per-host records and rejects oversized records', async () => {
	const root = await mkdtemp(join(tmpdir(), 'scape-gpu-evidence-test-'));
	try {
		const observed = { ...receipt(), processIds: [1234, 5678] };
		await writeFile(join(root, 'first.json'), JSON.stringify(observed));
		await writeFile(join(root, 'another.json'), JSON.stringify({ ...receipt(), jobId: 'other-job' }));
		await mkdir(join(root, 'ignored-directory.json'));
		assert.deepEqual(await readModelGpuEvidence(root, context.jobId), [observed]);
		await writeFile(join(root, 'large.json'), ' '.repeat(32_769));
		await assert.rejects(readModelGpuEvidence(root, context.jobId), /bound/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('GPU evidence reader does not follow a symbolic link into another host directory', async (t) => {
	if (process.platform === 'win32') { t.skip('Creating a Windows symlink requires optional OS privilege.'); return; }
	const root = await mkdtemp(join(tmpdir(), 'scape-gpu-evidence-links-'));
	try {
		const other = join(root, 'outside');
		const owned = join(root, 'owned');
		await mkdir(other); await mkdir(owned);
		await writeFile(join(other, 'receipt.json'), JSON.stringify(receipt()));
		await symlink(join(other, 'receipt.json'), join(owned, 'receipt.json'));
		await assert.rejects(readModelGpuEvidence(owned, context.jobId), /regular/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
