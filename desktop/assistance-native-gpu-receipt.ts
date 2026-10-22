/* SPDX-License-Identifier: AGPL-3.0-only */

import { recordAssistanceGpuValidation } from './assistance-gpu-validation.ts';

const MARKER = 'SOUNDSCAPER_GPU_COMPUTE_V1';
const RECEIPT = /^SOUNDSCAPER_GPU_COMPUTE_V1 provider=(vulkan|metal) gpu=([1-9]\d*) cpu=(\d+) device=([a-f\d]+)$/u;

/** A receipt is emitted by the pinned engine only after GPU graph work completes. */
export function reviewAssistanceNativeGpuReceipt(stderr: string, provider: string) {
	const lines = stderr.split(/\r?\n/u).filter(line => line.startsWith(MARKER));
	if (lines.length !== 1) throw new Error('GPU validation requires exactly one native compute receipt.');
	const match = RECEIPT.exec(lines[0]!);
	if (!match || match[1] !== provider || match[4]!.length > 512 || match[4]!.length % 2 !== 0) {
		throw new Error('The native GPU compute receipt is malformed or selected a foreign provider.');
	}
	const gpuWorkCount = Number(match[2]);
	const cpuWorkCount = Number(match[3]);
	const deviceName = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(match[4]!, 'hex'));
	if (!Number.isSafeInteger(gpuWorkCount) || !Number.isSafeInteger(cpuWorkCount)
		|| gpuWorkCount > 1_000_000 || cpuWorkCount > 1_000_000
		|| deviceName.length === 0 || /\p{Cc}/u.test(deviceName)) {
		throw new Error('The native GPU compute receipt exceeds its bound.');
	}
	return Object.freeze({ provider: match[1] as 'vulkan' | 'metal', proof: 'ggml-compute' as const,
		gpuWorkCount, cpuWorkCount, deviceName });
}

export async function recordAssistanceNativeGpuReceipt(stderr: string, provider: string): Promise<void> {
	await recordAssistanceGpuValidation(reviewAssistanceNativeGpuReceipt(stderr, provider));
}
