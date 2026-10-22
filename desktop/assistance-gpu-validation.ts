/* SPDX-License-Identifier: AGPL-3.0-only */

/** Private real-model test receipts; deliberately outside the renderer protocol. */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { lstat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export interface AssistanceGpuValidationJob {
	readonly jobId: string;
	readonly familyId: string;
	readonly modelIds: readonly string[];
}

export interface AssistanceGpuValidationWork {
	readonly provider: 'webgpu' | 'coreml' | 'vulkan' | 'metal';
	readonly proof: 'onnx-profile' | 'ggml-compute';
	readonly gpuWorkCount: number;
	readonly cpuWorkCount: number;
	readonly deviceName?: string;
	/** Observed native GPU kernel event PIDs, for host adapter-counter correlation. */
	readonly processIds?: readonly number[];
}

const jobs = new AsyncLocalStorage<AssistanceGpuValidationJob>();
const families = new Set(['onnxruntime-node', 'sherpa-onnx-node', 'whisper-cpp', 'llama-cpp', 'kokoro-g2p']);
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/u;

export function isAssistanceGpuValidationEnabled(): boolean {
	if (process.env.SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS !== '1'
		|| process.env.SOUNDSCAPER_ASSISTANCE_GPU_VALIDATION !== '1') return false;
	const root = process.env.SOUNDSCAPER_ASSISTANCE_GPU_EVIDENCE_ROOT;
	if (!root || !isAbsolute(root) || root.includes('\0')) {
		throw new TypeError('GPU validation needs an absolute private evidence directory.');
	}
	return true;
}

export function currentAssistanceGpuValidationJob(): AssistanceGpuValidationJob | undefined {
	return jobs.getStore();
}

export async function withAssistanceGpuValidationJob<T>(
	job: AssistanceGpuValidationJob,
	operation: () => Promise<T>,
): Promise<T> {
	if (!isAssistanceGpuValidationEnabled()) return await operation();
	if (!job || !identifier.test(job.jobId) || !families.has(job.familyId)
		|| !Array.isArray(job.modelIds) || job.modelIds.length < 1 || job.modelIds.length > 32
		|| job.modelIds.some(id => typeof id !== 'string' || !identifier.test(id))) {
		throw new TypeError('GPU validation received an invalid authenticated job.');
	}
	return await jobs.run(Object.freeze({ jobId: job.jobId, familyId: job.familyId,
		modelIds: Object.freeze([...new Set(job.modelIds)]) }), operation);
}

export async function recordAssistanceGpuValidation(work: AssistanceGpuValidationWork): Promise<void> {
	if (!isAssistanceGpuValidationEnabled()) return;
	const job = jobs.getStore();
	if (!job) throw new TypeError('GPU evidence has no authenticated job context.');
	const onnx = work?.provider === 'webgpu' || work?.provider === 'coreml';
	const ggml = work?.provider === 'vulkan' || work?.provider === 'metal';
	if (!work || !(onnx && work.proof === 'onnx-profile' || ggml && work.proof === 'ggml-compute')
		|| !Number.isSafeInteger(work.gpuWorkCount) || work.gpuWorkCount < 1 || work.gpuWorkCount > 100_000_000
		|| !Number.isSafeInteger(work.cpuWorkCount) || work.cpuWorkCount < 0 || work.cpuWorkCount > 100_000_000
		|| work.processIds !== undefined && (!Array.isArray(work.processIds) || work.processIds.length < 1
			|| work.processIds.length > 32 || new Set(work.processIds).size !== work.processIds.length
			|| work.processIds.some(id => !Number.isSafeInteger(id) || id < 1 || id > 0xffff_ffff))
		|| work.deviceName !== undefined && (typeof work.deviceName !== 'string'
			|| !work.deviceName.trim() || work.deviceName.length > 256 || /\p{Cc}/u.test(work.deviceName))) {
		throw new TypeError('GPU evidence needs bounded observed compute from a supported GPU provider.');
	}
	const root = process.env.SOUNDSCAPER_ASSISTANCE_GPU_EVIDENCE_ROOT!;
	const stat = await lstat(root);
	if (!stat.isDirectory() || stat.isSymbolicLink()) {
		throw new TypeError('GPU evidence must use a private regular directory.');
	}
	const record = { schemaVersion: 1, ...job, provider: work.provider, proof: work.proof,
		gpuWorkCount: work.gpuWorkCount, cpuWorkCount: work.cpuWorkCount,
		...(work.processIds === undefined ? {} : { processIds: [...work.processIds] }),
		...(work.deviceName === undefined ? {} : { deviceName: work.deviceName }) };
	await writeFile(join(root, `${job.jobId}-${randomUUID()}.json`), JSON.stringify(record),
		{ flag: 'wx', mode: 0o600 });
}
