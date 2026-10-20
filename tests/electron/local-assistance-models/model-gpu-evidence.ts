/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { expectedRuntimeArchiveFileNames } from './model-delivery-evidence.js';

const MAXIMUM_RECORD_BYTES = 32_768;
const MAXIMUM_RECORDS = 512;
const MAXIMUM_TOTAL_BYTES = 4 * 1024 * 1024;
const GPU_PROVIDERS = new Set(['webgpu', 'coreml', 'vulkan', 'metal']);
const RECORD_FIELDS = new Set([
	'schemaVersion', 'jobId', 'familyId', 'modelIds', 'provider', 'proof',
	'gpuWorkCount', 'cpuWorkCount', 'deviceName', 'processIds',
]);

interface ModelIdentity {
	readonly modelId: string;
	readonly task: string;
}

interface GpuEvidenceContext {
	readonly jobId: string;
	readonly models: readonly ModelIdentity[];
	readonly language?: string;
}

interface ModelGpuEvidence {
	readonly schemaVersion: 1;
	readonly jobId: string;
	readonly familyId: string;
	readonly modelIds: readonly string[];
	readonly provider: string;
	readonly proof: 'onnx-profile' | 'ggml-compute';
	readonly gpuWorkCount: number;
	readonly cpuWorkCount: number;
	readonly deviceName?: string;
	readonly processIds?: readonly number[];
}

/** Read bounded host-owned receipts after IPC completion, including after job release. */
export async function readModelGpuEvidence(root: string, jobId: string): Promise<unknown[]> {
	const entries = (await readdir(root, { withFileTypes: true }))
		.filter((entry) => entry.name.endsWith('.json'))
		.sort((left, right) => left.name.localeCompare(right.name));
	assert.ok(entries.length <= MAXIMUM_RECORDS, 'GPU execution evidence exceeds its record bound.');
	const records: unknown[] = [];
	let totalBytes = 0;
	for (const entry of entries) {
		if (entry.isDirectory()) continue;
		const path = join(root, entry.name);
		const metadata = await lstat(path);
		assert.ok(metadata.isFile() && !metadata.isSymbolicLink(), 'GPU execution evidence must be a regular file.');
		totalBytes += metadata.size;
		assert.ok(metadata.size <= MAXIMUM_RECORD_BYTES && totalBytes <= MAXIMUM_TOTAL_BYTES,
			'GPU execution evidence exceeds its byte bound.');
		const bytes = await readFile(path);
		assert.ok(bytes.byteLength <= MAXIMUM_RECORD_BYTES, 'GPU execution evidence exceeds its byte bound.');
		const record: unknown = JSON.parse(bytes.toString('utf8'));
		if (isRecord(record) && record.jobId === jobId) records.push(record);
	}
	return records;
}

/** Passing outputs require measured GPU computation for every exact model/runtime pair. */
export function assertModelGpuEvidence(records: readonly unknown[], context: GpuEvidenceContext): void {
	assert.ok(records.length > 0, `No GPU execution evidence exists for job ${context.jobId}.`);
	const expected = new Set(context.models.flatMap((model) => expectedFamilies(model, context.language)
		.map((familyId) => pair(model.modelId, familyId))));
	const covered = new Set<string>();
	for (const value of records) {
		const record = reviewRecord(value);
		assert.equal(record.jobId, context.jobId, 'GPU execution evidence belongs to another job.');
		assert.ok(GPU_PROVIDERS.has(record.provider), 'GPU execution evidence selected a CPU or unknown provider.');
		const native = record.familyId === 'whisper-cpp' || record.familyId === 'llama-cpp';
		assert.ok(native ? record.provider === 'vulkan' || record.provider === 'metal'
			: record.provider === 'webgpu' || record.provider === 'coreml',
		'GPU execution evidence provider does not belong to its runtime family.');
		assert.equal(record.proof, native ? 'ggml-compute' : 'onnx-profile',
			'GPU execution evidence has no matching native computation proof.');
		for (const modelId of record.modelIds) {
			const identity = pair(modelId, record.familyId);
			assert.ok(expected.has(identity), `GPU execution evidence contains a foreign model/runtime pair: ${identity}.`);
			if (record.gpuWorkCount > 0) covered.add(identity);
		}
	}
	for (const identity of expected) assert.ok(covered.has(identity),
		`GPU execution evidence has no measured GPU work for ${identity}.`);
}

function expectedFamilies(model: ModelIdentity, language: string | undefined): string[] {
	return expectedRuntimeArchiveFileNames(model.modelId, model.task)
		.map((name: string) => name.replace(/\.tar\.gz$/u, ''))
		.filter((familyId: string) => familyId !== 'kokoro-g2p'
			|| language === undefined || language === 'a' || language === 'b');
}

function reviewRecord(value: unknown): ModelGpuEvidence {
	assert.ok(isRecord(value), 'GPU execution evidence must be a record.');
	assert.ok(Object.keys(value).every((key) => RECORD_FIELDS.has(key)), 'GPU execution evidence has unknown fields.');
	assert.equal(value.schemaVersion, 1, 'GPU execution evidence schema is unsupported.');
	for (const field of ['jobId', 'familyId', 'provider', 'proof'] as const) {
		assert.ok(typeof value[field] === 'string' && value[field].length > 0,
			`GPU execution evidence ${field} is missing.`);
	}
	assert.ok(Array.isArray(value.modelIds) && value.modelIds.length > 0 && value.modelIds.length <= 32
		&& value.modelIds.every((id: unknown) => typeof id === 'string' && id.length > 0)
		&& new Set(value.modelIds).size === value.modelIds.length,
	'GPU execution evidence model identities are invalid.');
	assert.ok(value.proof === 'onnx-profile' || value.proof === 'ggml-compute',
		'GPU execution evidence has no reviewed computation proof.');
	for (const field of ['gpuWorkCount', 'cpuWorkCount'] as const) {
		assert.ok(typeof value[field] === 'number' && Number.isSafeInteger(value[field]) && value[field] >= 0,
			`GPU execution evidence ${field} count is invalid.`);
	}
	assert.ok(value.deviceName === undefined || typeof value.deviceName === 'string'
		&& value.deviceName.length > 0 && value.deviceName.length <= 512,
	'GPU execution evidence device name is invalid.');
	assert.ok(value.processIds === undefined || Array.isArray(value.processIds)
		&& value.processIds.length > 0 && value.processIds.length <= 32
		&& value.processIds.every((pid: unknown) => typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0 && pid <= 0xffff_ffff)
		&& new Set(value.processIds).size === value.processIds.length,
	'GPU execution evidence process identities are invalid.');
	return value as unknown as ModelGpuEvidence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pair(modelId: string, familyId: string): string {
	return `${modelId}/${familyId}`;
}
