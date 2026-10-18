/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	currentAssistanceGpuValidationJob, isAssistanceGpuValidationEnabled,
	recordAssistanceGpuValidation, withAssistanceGpuValidationJob,
} from './assistance-gpu-validation.ts';
import { createAssistanceOnnxGpuProfileV1 } from './assistance-onnx-gpu-profile.ts';

export interface AssistanceKokoroGpuValidationEnvironmentV1 {
	readonly SCAPE_KOKORO_REQUIRE_GPU: '1';
	readonly SCAPE_KOKORO_GPU_PROFILE_PREFIX: string;
}

/** English learned pronunciation must use GPU matrix work before its phonemes are admitted. */
export async function runAssistanceKokoroGpuValidationV1(
	language: string, targetId: string, files: readonly Readonly<{ path: string }>[],
	execute: (environment?: AssistanceKokoroGpuValidationEnvironmentV1) => Promise<Uint8Array>,
): Promise<Uint8Array> {
	if (!isAssistanceGpuValidationEnabled() || !['a', 'b'].includes(language)) return execute();
	const windows = targetId.startsWith('win-'), mac = targetId.startsWith('mac-');
	const required = [windows ? 'scape-g2p-gpu.dll' : mac ? 'libscape-g2p-gpu.dylib' : 'libscape-g2p-gpu.so',
		windows ? 'onnxruntime_providers_webgpu.dll' : mac ? 'libonnxruntime_providers_webgpu.dylib' : 'libonnxruntime_providers_webgpu.so',
		`onnx-webgpu-device-probe${windows ? '.exe' : ''}`];
	if (required.some(name => !files.some(file => file.path === `_internal/scape-gpu/${name}`))) {
		throw new Error('GPU validation requires an authenticated GPU Kokoro pronunciation runtime. Update AI assets and refresh the runtime snapshots.');
	}
	const job = currentAssistanceGpuValidationJob();
	if (!job) throw new TypeError('Kokoro GPU validation requires an authenticated model job.');
	const profile = await createAssistanceOnnxGpuProfileV1();
	try {
		const output = await execute({ SCAPE_KOKORO_REQUIRE_GPU: '1',
			SCAPE_KOKORO_GPU_PROFILE_PREFIX: profile.settings.profileFilePrefix });
		const proof = await profile.review('webgpu');
		await withAssistanceGpuValidationJob({ ...job, familyId: 'kokoro-g2p' },
			() => recordAssistanceGpuValidation({ provider: 'webgpu', proof: 'onnx-profile',
				gpuWorkCount: proof.gpuKernelCount, cpuWorkCount: proof.cpuKernelCount,
				...(proof.processIds === undefined ? {} : { processIds: proof.processIds }) }));
		return output;
	} finally { await profile.dispose(); }
}
