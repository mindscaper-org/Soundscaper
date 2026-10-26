/* SPDX-License-Identifier: AGPL-3.0-only */

/** GPU selection is restricted to providers in the authenticated runtime closure. */

import type {
	AssistanceOnnxInferenceSessionV1, AssistanceOnnxRuntimeModuleV1,
} from './assistance-onnx-runtime-worker.ts';
import {
	createAssistanceOnnxGpuValidatedRuntimeV1,
	type AssistanceOnnxGpuExecutionProofV1,
} from './assistance-onnx-gpu-validation.ts';
import { isAssistanceGpuValidationEnabled, recordAssistanceGpuValidation } from './assistance-gpu-validation.ts';

type SessionOptions = Parameters<AssistanceOnnxRuntimeModuleV1['InferenceSession']['create']>[1];
type OnnxGpuProvider = 'coreml' | 'webgpu';

export interface AssistanceOnnxGpuValidationOptionsV1 {
	readonly onExecution: (proof: AssistanceOnnxGpuExecutionProofV1) => PromiseLike<void> | void;
}

export function createAssistanceOnnxAcceleratedRuntimeV1(
	runtime: AssistanceOnnxRuntimeModuleV1,
	descriptor: Readonly<{ executionProviders?: readonly string[] }>,
	getSignal: () => AbortSignal | undefined = () => undefined,
	gpuValidation?: AssistanceOnnxGpuValidationOptionsV1,
): AssistanceOnnxRuntimeModuleV1 {
	const providers = (descriptor.executionProviders ?? []).filter((provider): provider is OnnxGpuProvider =>
		provider === 'coreml' || provider === 'webgpu');
	const validation = gpuValidation ?? (isAssistanceGpuValidationEnabled() ? {
		onExecution: (proof: AssistanceOnnxGpuExecutionProofV1) => recordAssistanceGpuValidation({
			provider: proof.provider, proof: 'onnx-profile',
			gpuWorkCount: proof.gpuKernelCount, cpuWorkCount: proof.cpuKernelCount,
			...(proof.processIds === undefined ? {} : { processIds: proof.processIds }),
		}),
	} : undefined);
	if (validation !== undefined) {
		return createAssistanceOnnxGpuValidatedRuntimeV1(runtime, providers, getSignal, validation.onExecution);
	}
	if (!providers.length) return runtime;
	return { Tensor: runtime.Tensor, InferenceSession: { create: async (path, settings) => {
		const signal = getSignal();
		for (const provider of providers) {
			signal?.throwIfAborted();
			let native: AssistanceOnnxInferenceSessionV1;
			try {
				native = await runtime.InferenceSession.create(path, {
					...settings, executionProviders: [provider, 'cpu'],
				});
			} catch {
				signal?.throwIfAborted();
				continue;
			}
			if (signal?.aborted) { await native.release?.(); signal.throwIfAborted(); }
			if (!Array.isArray(native?.inputNames) || !Array.isArray(native.outputNames)
				|| typeof native.run !== 'function' || typeof native.release !== 'function') {
				await native?.release?.();
				throw new TypeError('Accelerated ONNX sessions require a complete releasable native surface.');
			}
			return resilientSession(runtime, path, settings, native, getSignal);
		}
		signal?.throwIfAborted();
		return runtime.InferenceSession.create(path, settings);
	} } };
}

function resilientSession(
	runtime: AssistanceOnnxRuntimeModuleV1, path: string, settings: SessionOptions,
	initial: AssistanceOnnxInferenceSessionV1, getSignal: () => AbortSignal | undefined,
): AssistanceOnnxInferenceSessionV1 {
	const inputNames = Object.freeze([...initial.inputNames]);
	const outputNames = Object.freeze([...initial.outputNames]);
	let native: AssistanceOnnxInferenceSessionV1 | null = initial;
	let gpu = true;
	let released = false;
	let tail: Promise<unknown> = Promise.resolve();
	return {
		inputNames, outputNames,
		run: (feeds) => {
			const signal = getSignal();
			const pending = tail.then(async () => {
				if (released || native === null) throw new Error('The accelerated ONNX session is released.');
				signal?.throwIfAborted();
				try { return await native.run(feeds); }
				catch (error) {
					signal?.throwIfAborted();
					if (!gpu) throw error;
					const failed = native;
					native = null;
					await failed.release?.();
					signal?.throwIfAborted();
					const cpu = await runtime.InferenceSession.create(path, settings);
					if (signal?.aborted || JSON.stringify(cpu.inputNames) !== JSON.stringify(inputNames)
						|| JSON.stringify(cpu.outputNames) !== JSON.stringify(outputNames)) {
						await cpu.release?.();
						signal?.throwIfAborted();
						throw new TypeError('The CPU fallback changed the authenticated ONNX model surface.', { cause: error });
					}
					native = cpu;
					gpu = false;
					return cpu.run(feeds);
				}
			});
			// Keep inference, retries, and release ordered on the native session.
			tail = pending.catch(() => {});
			return pending;
		},
		release: async () => {
			if (released) return;
			released = true;
			await tail;
			const owned = native;
			native = null;
			await owned?.release?.();
		},
	};
}
