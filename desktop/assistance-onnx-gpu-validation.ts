/* SPDX-License-Identifier: AGPL-3.0-only */

/** Opt-in diagnostics require GPU work by the same session producing model output. */

import {
	createAssistanceOnnxGpuProfileV1,
	type AssistanceOnnxGpuKernelCountsV1,
	type AssistanceOnnxGpuProviderV1,
} from './assistance-onnx-gpu-profile.ts';
import type {
	AssistanceOnnxInferenceSessionV1, AssistanceOnnxRuntimeModuleV1,
} from './assistance-onnx-runtime-worker.ts';
import {
	assistanceOnnxExecutionProvidersV1,
	type AssistanceOnnxWebGpuPolicyV1,
} from './assistance-onnx-provider-options.ts';

export interface AssistanceOnnxGpuExecutionProofV1 extends AssistanceOnnxGpuKernelCountsV1 {
	readonly provider: AssistanceOnnxGpuProviderV1;
}

export function createAssistanceOnnxGpuValidatedRuntimeV1(
	runtime: AssistanceOnnxRuntimeModuleV1,
	providers: readonly AssistanceOnnxGpuProviderV1[],
	getSignal: () => AbortSignal | undefined,
	onExecution: (proof: AssistanceOnnxGpuExecutionProofV1) => PromiseLike<void> | void,
	webGpuPolicy?: AssistanceOnnxWebGpuPolicyV1,
): AssistanceOnnxRuntimeModuleV1 {
	// CoreML may route a profiled subgraph to CPU or ANE internally. Its EP name
	// alone cannot certify physical GPU work; every maintained target ships WebGPU.
	const gpuProviders = providers.filter(provider => provider === 'webgpu');
	if (!gpuProviders.length) throw new Error('GPU validation requires an authenticated WebGPU runtime provider.');
	return { Tensor: runtime.Tensor, InferenceSession: { create: async (path, settings) => {
		const failures: unknown[] = [];
		for (const provider of gpuProviders) {
			getSignal()?.throwIfAborted();
			const profile = await createAssistanceOnnxGpuProfileV1();
			let native: AssistanceOnnxInferenceSessionV1;
			try {
				native = await runtime.InferenceSession.create(path, {
					...settings, ...profile.settings,
					executionProviders: assistanceOnnxExecutionProvidersV1(provider, webGpuPolicy),
				});
			} catch (error) {
				await profile.dispose();
				getSignal()?.throwIfAborted();
				failures.push(error);
				continue;
			}
			if (getSignal()?.aborted || !Array.isArray(native?.inputNames) || !Array.isArray(native.outputNames)
				|| typeof native.run !== 'function' || typeof native.release !== 'function'
				|| typeof native.endProfiling !== 'function') {
				try { await native?.release?.(); } finally { await profile.dispose(); }
				getSignal()?.throwIfAborted();
				throw new TypeError('GPU validation requires a complete native ONNX session with profiling.');
			}
			let tail: Promise<unknown> = Promise.resolve();
			let release: Promise<void> | undefined;
			let proof: AssistanceOnnxGpuKernelCountsV1 | undefined;
			let profiling = true, ran = false, failed = false;
			return {
				inputNames: native.inputNames, outputNames: native.outputNames,
				run: (feeds) => {
					if (release) return Promise.reject(new Error('The GPU validation session is released.'));
					const pending = tail.then(async () => {
						getSignal()?.throwIfAborted();
						try {
							const result = await native.run(feeds);
							if (profiling) {
								// A first successful output proves this exact native session. Stop here so
								// multi-chunk audio jobs cannot grow an otherwise valid trace past its bound.
								profiling = false;
								await native.endProfiling!();
								proof = await profile.review(provider);
							}
							ran = true;
							return result;
						} catch (error) { failed = true; throw error; }
					});
					tail = pending.catch(() => {});
					return pending;
				},
				release: () => {
					release ??= (async () => {
						await tail;
						try {
							getSignal()?.throwIfAborted();
							if (ran && !failed && proof !== undefined) {
								await onExecution(Object.freeze({ provider, ...proof }));
							}
						} finally {
							try { await native.release!(); } finally { await profile.dispose(); }
						}
					})();
					return release;
				},
			};
		}
		throw new AggregateError(failures, 'No authenticated GPU provider could create the model session.');
	} } };
}
