/* SPDX-License-Identifier: AGPL-3.0-only */

/** Native ORT kernel traces prove that the model actually executed on a GPU EP. */

import { lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

export type AssistanceOnnxGpuProviderV1 = 'webgpu' | 'coreml';
export interface AssistanceOnnxGpuKernelCountsV1 {
	readonly gpuKernelCount: number;
	readonly cpuKernelCount: number;
	readonly processIds?: readonly number[];
}

const MAXIMUM_PROFILE_BYTES = 64 * 1024 ** 2;
const PROVIDERS = { webgpu: 'WebGpuExecutionProvider', coreml: 'CoreMLExecutionProvider' };
// Pinned ORT WebGPU tensor kernels only alias or copy buffers for these ops;
// their host-side Compute events never establish shader arithmetic.
const GPU_VIEW_OPS = new Set(['identity', 'reshape', 'flatten', 'squeeze', 'unsqueeze']);
const GPU_VIEW_KERNEL_NAME = /(?:^|[./_:])(?:identity|reshape|flatten|squeeze|unsqueeze)(?:_\d+)*_kernel_time$/iu;

export function reviewAssistanceOnnxGpuProfileV1(
	value: unknown, provider: AssistanceOnnxGpuProviderV1,
): AssistanceOnnxGpuKernelCountsV1 {
	const counts = reviewProfile(value, PROVIDERS[provider]);
	if (!counts.gpuKernelCount) throw new Error('The native ONNX profile proves no executed GPU kernels.');
	return counts;
}

function reviewProfile(value: unknown, expectedProviderName: string): AssistanceOnnxGpuKernelCountsV1 {
	if (!Array.isArray(value)) throw new TypeError('The native ONNX GPU profile must be an event array.');
	let gpuKernelCount = 0, cpuKernelCount = 0;
	const processIds = new Set<number>();
	for (const item of value as readonly unknown[]) {
		if (!item || typeof item !== 'object') continue;
		const event = item as Record<string, unknown>;
		if (event.cat !== 'Node' || event.ph !== 'X' || typeof event.name !== 'string'
			|| !event.name.endsWith('_kernel_time') || typeof event.dur !== 'number'
			|| !Number.isFinite(event.dur) || event.dur <= 0
			|| !event.args || typeof event.args !== 'object') continue;
		const args = event.args as Record<string, unknown>;
		// GPU transfers and synchronization around CPU model work are not GPU compute.
		if (/memcpy|fence|waitevent|recordevent/iu.test(event.name)
			|| typeof args.op_name === 'string' && /memcpy|fence|waitevent|recordevent/iu.test(args.op_name)) continue;
		const selected = args.provider;
		if (selected === expectedProviderName) {
			if (typeof args.op_name === 'string' ? GPU_VIEW_OPS.has(args.op_name.toLowerCase())
				: GPU_VIEW_KERNEL_NAME.test(event.name)) continue;
			gpuKernelCount += 1;
			addProcessId(processIds, event.pid);
		} else if (selected === 'CPUExecutionProvider') cpuKernelCount += 1;
	}
	return kernelCounts(gpuKernelCount, cpuKernelCount, processIds);
}

function addProcessId(processIds: Set<number>, value: unknown): void {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 0xffff_ffff) return;
	processIds.add(value);
	if (processIds.size > 32) throw new Error('The native ONNX GPU profile exceeds its process ID count bound.');
}

function kernelCounts(gpuKernelCount: number, cpuKernelCount: number, processIds: ReadonlySet<number>): AssistanceOnnxGpuKernelCountsV1 {
	return Object.freeze({ gpuKernelCount, cpuKernelCount,
		...(processIds.size ? { processIds: Object.freeze([...processIds]) } : {}) });
}

export async function readAssistanceOnnxGpuProfileDirectoryV1(
	directory: string, prefix: string, expectedProviderName: string,
): Promise<AssistanceOnnxGpuKernelCountsV1> {
	if (!Object.values(PROVIDERS).includes(expectedProviderName)) {
		throw new TypeError('ONNX GPU validation requires a reviewed accelerated provider.');
	}
	const names = (await readdir(directory)).filter(name => name.startsWith(`${basename(prefix)}_`) && name.endsWith('.json'));
	if (!names.length || names.length > 128) throw new Error('The native ONNX GPU profiles are missing or exceed their count bound.');
	let gpuKernelCount = 0, cpuKernelCount = 0, totalBytes = 0;
	const processIds = new Set<number>();
	for (const name of names) {
		const path = join(directory, name);
		const metadata = await lstat(path);
		totalBytes += metadata.size;
		if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 2 || totalBytes > MAXIMUM_PROFILE_BYTES) {
			throw new Error('The native ONNX profile is not a bounded regular file.');
		}
		const bytes = await readFile(path);
		if (bytes.length !== metadata.size) throw new Error('The native ONNX profile changed during readback.');
		const proof = reviewProfile(JSON.parse(bytes.toString('utf8')) as unknown, expectedProviderName);
		gpuKernelCount += proof.gpuKernelCount;
		cpuKernelCount += proof.cpuKernelCount;
		for (const id of proof.processIds ?? []) addProcessId(processIds, id);
	}
	if (!gpuKernelCount) throw new Error('The native ONNX profile proves no executed GPU kernels.');
	return kernelCounts(gpuKernelCount, cpuKernelCount, processIds);
}

export async function createAssistanceOnnxGpuProfileV1() {
	const directory = await mkdtemp(join(tmpdir(), 'scape-onnx-gpu-proof-'));
	return {
		settings: Object.freeze({ enableProfiling: true as const, profileFilePrefix: join(directory, 'model') }),
		async review(provider: AssistanceOnnxGpuProviderV1): Promise<AssistanceOnnxGpuKernelCountsV1> {
			const names = await readdir(directory);
			if (names.length !== 1 || !/^model_[A-Za-z\d_.-]+\.json$/u.test(names[0]!)) {
				throw new Error('The native ONNX session must produce exactly one private profile.');
			}
			return readAssistanceOnnxGpuProfileDirectoryV1(directory, 'model', PROVIDERS[provider]);
		},
		dispose: () => rm(directory, { recursive: true, force: true }),
	};
}
