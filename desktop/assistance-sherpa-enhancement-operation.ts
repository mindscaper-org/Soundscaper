/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AssistanceOperationRequest } from './assistance-operation-contract.ts';
import type { AssistanceOperationServiceOptions } from './assistance-operation-service.ts';
import { resolveInstalledModels } from './assistance-operation-speech-execution.ts';
import type { SpeechRuntimeStatus } from './assistance-speech-runtime.ts';
import type { SherpaEnhancementRequest } from './assistance-sherpa-enhancement-capture.ts';
import type { SherpaEnhancementResult } from './assistance-sherpa-enhancement-contract.ts';
import { speechEnhancementModel } from '../src/common/editor/assistance/speech-enhancement-models.ts';

export interface SherpaEnhancementRuntime {
	status(): Promise<SpeechRuntimeStatus>;
	enhance(request: SherpaEnhancementRequest): Promise<SherpaEnhancementResult>;
}

export async function executeSherpaEnhancementOperation(request: AssistanceOperationRequest,
	inputPaths: readonly string[], options: AssistanceOperationServiceOptions, signal: AbortSignal,
	onProgress?: (value: number) => void,
) {
	const unavailable = (reason: 'adapter-unavailable' | 'runtime-unavailable' | 'model-unavailable') =>
		Object.freeze({ outcome: 'unavailable' as const, reason });
	const runtime = options.enhancementRuntime;
	if (!runtime) return unavailable('adapter-unavailable');
	const binding = request.models[0], expected = speechEnhancementModel(binding?.modelId);
	if (request.operation !== 'speech-enhancement' || request.models.length !== 1 || !binding
		|| !expected || expected.modelId === 'deepfilternet3' || binding.version !== expected.version
		|| request.inputs.length !== 1 || request.outputs.length !== 1) throw new TypeError('Invalid Sherpa enhancement operation.');
	const resolved = await resolveInstalledModels(request, options.models, ['speech-enhancement']);
	if (!resolved) return unavailable('model-unavailable');
	if (!(await runtime.status()).available) return unavailable('runtime-unavailable');
	const installed = (await options.models.listInstalled()).find((model) => model.modelId === binding.modelId && model.version === binding.version);
	if (!installed) return unavailable('model-unavailable');
	const reservation = request.outputs[0]!;
	const result = await runtime.enhance({ jobId: request.jobId, modelId: binding.modelId,
		input: { claim: request.inputs[0]!, path: inputPaths[0]! },
		models: installed.artifacts.map((artifact) => {
			const artifactRole = artifact.fileName.split('.')[0]!;
			const path = resolved[0]!.paths[artifactRole];
			if (!path) throw new TypeError('An enhancement model artifact lacks its authenticated path.');
			return { modelId: binding.modelId, version: binding.version, artifactRole,
				path, byteLength: artifact.byteLength, sha256: artifact.sha256 };
		}),
		output: { reservation, path: await options.registry.resolveOutputReservationPathForMain(request.jobId, reservation, signal) },
		signal, onProgress: ({ completed, total }) => onProgress?.(total === 0 ? 1 : completed / total) });
	return Object.freeze({ outcome: 'completed' as const,
		outputs: Object.freeze([{ claimId: reservation.claimId, role: reservation.role,
			mediaType: reservation.mediaType, ...result }]) });
}
