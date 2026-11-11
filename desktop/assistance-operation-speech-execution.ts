/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact installed-model resolution for the main-owned speech operations. */
import type { AssistanceOperationRequest, AssistanceOperationProgress } from './assistance-operation-contract.ts';
import type { AssistanceOperationServiceOptions, AssistanceOperationUnavailableReason } from './assistance-operation-service.ts';
import type { SpeechModelPaths } from './assistance-speech-runtime.ts';
const REQUIRED_SPEECH_MODEL_ROLES = Object.freeze(['encoder', 'decoder', 'joiner', 'tokens'] as const);
const ERES2NET_MODEL_ROLE = '3dspeaker_speech_eres2net_sv_en_voxceleb_16k';

type ProgressEmitter = (
	phase: AssistanceOperationProgress['phase'], completed?: number, total?: number,
) => void;

export async function executeSpeech(
	request: AssistanceOperationRequest,
	audioPath: string,
	voiceActivityPath: string | undefined,
	signal: AbortSignal,
	emit: ProgressEmitter,
	options: AssistanceOperationServiceOptions,
): Promise<unknown | AssistanceOperationUnavailableReason> {
	const resolved = await resolveInstalledModels(request, options.models, ['speech-recognition']);
	if (resolved === null) return 'model-unavailable';
	const model = speechModelPaths(resolved[0]!.paths);
	if (model === null) return 'model-unavailable';
	const runtimeStatus = await options.runtime.status();
	if (!runtimeStatus.available) return 'runtime-unavailable';
	emit('running');
	return options.runtime.recognize({
		jobId: request.jobId, modelId: request.models[0]!.modelId, audioPath, voiceActivityPath, model, signal,
		onProgress: ({ completed, total }) => emit('running', completed, total),
	});
}

export function inputPathForRole(
	request: AssistanceOperationRequest,
	inputPaths: readonly string[],
	role: 'audio',
): string;
export function inputPathForRole(
	request: AssistanceOperationRequest,
	inputPaths: readonly string[],
	role: 'voice-activity',
	required: false,
): string | undefined;
export function inputPathForRole(
	request: AssistanceOperationRequest,
	inputPaths: readonly string[],
	role: 'audio' | 'voice-activity',
	required = true,
): string | undefined {
	const index = request.inputs.findIndex((claim) => claim.role === role);
	if (index < 0) {
		if (!required) return undefined;
		throw new TypeError(`The assistance operation omitted its ${role} input path.`);
	}
	const path = inputPaths[index];
	if (typeof path !== 'string' || path === '') {
		throw new TypeError(`The assistance operation has an invalid ${role} input path.`);
	}
	return path;
}

export async function executeVoiceActivity(
	request: AssistanceOperationRequest,
	audioPath: string,
	signal: AbortSignal,
	emit: ProgressEmitter,
	options: AssistanceOperationServiceOptions,
): Promise<unknown | AssistanceOperationUnavailableReason> {
	const runtime = options.voiceActivityRuntime;
	if (!runtime) return 'adapter-unavailable';
	const resolved = await resolveInstalledModels(request, options.models, ['voice-activity-detection']);
	const modelPath = resolved?.[0]?.paths.silero_vad;
	if (typeof modelPath !== 'string' || modelPath === '') {
		return 'model-unavailable';
	}
	const runtimeStatus = await runtime.status();
	if (!runtimeStatus.available) return 'runtime-unavailable';
	emit('running');
	return runtime.detect({
		jobId: request.jobId, modelId: request.models[0]!.modelId, audioPath,
		model: { model: modelPath }, signal,
		onProgress: ({ completed, total }) => emit('running', completed, total),
	});
}

export async function executeSpeakerDiarization(
	request: AssistanceOperationRequest,
	audioPath: string,
	signal: AbortSignal,
	emit: ProgressEmitter,
	options: AssistanceOperationServiceOptions,
): Promise<unknown | AssistanceOperationUnavailableReason> {
	const runtime = options.diarizationRuntime;
	if (!runtime) return 'adapter-unavailable';
	const resolved = await resolveInstalledModels(request, options.models,
		['speaker-segmentation', 'speaker-embedding']);
	const segmentation = resolved?.[0];
	const embedding = resolved?.[1];
	const segmentationPath = segmentation?.paths.model;
	const embeddingPath = embedding?.paths[ERES2NET_MODEL_ROLE];
	if (!segmentation || !embedding || typeof segmentationPath !== 'string' || segmentationPath === ''
		|| typeof embeddingPath !== 'string' || embeddingPath === '') return 'model-unavailable';
	const runtimeStatus = await runtime.status();
	if (!runtimeStatus.available) return 'runtime-unavailable';
	emit('running');
	return runtime.diarize({
		jobId: request.jobId, audioPath,
		modelIds: {
			segmentation: segmentation.binding.modelId,
			embedding: embedding.binding.modelId,
		},
		models: { segmentation: segmentationPath, embedding: embeddingPath },
		signal,
		onProgress: ({ completed, total }) => emit('running', completed, total),
	});
}

export async function executeShotDetection(
	request: AssistanceOperationRequest,
	videoPath: string,
	signal: AbortSignal,
	emit: ProgressEmitter,
	options: AssistanceOperationServiceOptions,
): Promise<unknown | AssistanceOperationUnavailableReason> {
	if (request.models.length !== 0) {
		throw new TypeError('shot-detection does not accept model bindings.');
	}
	const runtime = options.shotDetectionRuntime;
	if (!runtime) return 'adapter-unavailable';
	const runtimeStatus = await runtime.status();
	if (!runtimeStatus.available) return 'runtime-unavailable';
	emit('running');
	return (await runtime.detect({ videoPath, signal })) ?? 'runtime-unavailable';
}

function speechModelPaths(resolved: Readonly<Record<string, string>>): SpeechModelPaths | null {
	for (const role of REQUIRED_SPEECH_MODEL_ROLES) {
		if (typeof resolved[role] !== 'string' || resolved[role] === '') return null;
	}
	return Object.freeze({
		encoder: resolved.encoder!, decoder: resolved.decoder!, joiner: resolved.joiner!, tokens: resolved.tokens!,
	});
}

interface ResolvedOperationModel {
	readonly binding: AssistanceOperationRequest['models'][number];
	readonly paths: Readonly<Record<string, string>>;
}

export async function resolveInstalledModels(
	request: AssistanceOperationRequest,
	models: AssistanceOperationServiceOptions['models'],
	tasks: readonly string[],
): Promise<readonly ResolvedOperationModel[] | null> {
	if (request.models.length !== tasks.length) {
		throw new TypeError(`${request.operation} requires ${tasks.length} exact model binding(s).`);
	}
	const [status, installedModels] = await Promise.all([models.status(), models.listInstalled()]);
	const used = new Set<string>();
	const resolved: ResolvedOperationModel[] = [];
	for (const task of tasks) {
		const candidates = request.models.filter((binding) => status.models.some((view) => (
			view.modelId === binding.modelId && view.task === task && view.version === binding.version
			&& view.availability === 'installed'
		)));
		if (candidates.length !== 1 || used.has(candidates[0]!.modelId)) return null;
		const binding = candidates[0]!;
		used.add(binding.modelId);
		const installed = installedModels.find(({ modelId }) => modelId === binding.modelId);
		if (!installed || installed.version !== binding.version) return null;
		const actualDigests = installed.artifacts.map(({ sha256 }) => sha256).sort();
		if (actualDigests.length !== binding.artifactSha256s.length
			|| actualDigests.some((digest, index) => digest !== binding.artifactSha256s[index])) {
			throw new Error('The assistance model binding disagrees with its authenticated artifact inventory.');
		}
		let paths: Record<string, string>;
		try { paths = await models.resolveModelPaths(binding.modelId); }
		catch (error) { if (modelEvidenceUnavailable(error)) return null; throw error; }
		resolved.push(Object.freeze({ binding, paths: Object.freeze({ ...paths }) }));
	}
	return Object.freeze(resolved);
}

function modelEvidenceUnavailable(error: unknown): boolean {
	return error instanceof Error && /is not installed/u.test(error.message);
}
