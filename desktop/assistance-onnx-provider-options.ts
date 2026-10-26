/* SPDX-License-Identifier: AGPL-3.0-only */

/** Narrow native Node-API provider options shared by normal and proof runs. */

export type AssistanceOnnxGpuProviderV1 = 'coreml' | 'webgpu';

export interface AssistanceOnnxWebGpuPolicyV1 {
	readonly forceCpuNodeNames?: readonly string[];
}

export type AssistanceOnnxExecutionProviderV1 = 'cpu' | AssistanceOnnxGpuProviderV1 | Readonly<{
	readonly name: 'webgpu';
	readonly forceCpuNodeNames: readonly string[];
}>;

export function assistanceOnnxExecutionProvidersV1(
	provider: AssistanceOnnxGpuProviderV1,
	policy?: AssistanceOnnxWebGpuPolicyV1,
): readonly AssistanceOnnxExecutionProviderV1[] {
	const names = policy?.forceCpuNodeNames;
	if (provider !== 'webgpu' || names === undefined || names.length === 0) {
		return Object.freeze([provider, 'cpu']);
	}
	if (names.length > 32 || new Set(names).size !== names.length
		|| names.some((name) => typeof name !== 'string' || name.length < 1
			|| name.length > 256 || /[\r\n\0]/u.test(name))) {
		throw new TypeError('The ONNX WebGPU CPU-node exception list is invalid.');
	}
	return Object.freeze([Object.freeze({
		name: 'webgpu' as const,
		forceCpuNodeNames: Object.freeze([...names]),
	}), 'cpu']);
}
