/* SPDX-License-Identifier: AGPL-3.0-only */

import { isSherpaEnhancementModel, speechEnhancementModel,
	type SherpaEnhancementModelId } from '../src/common/editor/assistance/speech-enhancement-models.ts';
import { inputGrant, modelGrant, outputGrant,
	type AssistanceRuntimeFamilyInputGrantV1, type AssistanceRuntimeFamilyModelGrantV1,
	type AssistanceRuntimeFamilyOutputGrantV1 } from './assistance-runtime-family-job-contract.ts';
import { assertHelperWireEnvelope } from './helper-wire-admission.ts';

export const SHERPA_ENHANCEMENT_ARTIFACTS = Object.freeze({
	gtcrn: [{ role: 'gtcrn_simple', sha256: 'e77603ac0c23dac3227dd2d7135b3a585cbee2679048aecfa886657d3ae1b534' }],
	'dpdfnet2-48khz': [{ role: 'dpdfnet2_48khz_hr', sha256: '0b399f8a58dc4d70d8cd97541f5c39869406145193b957d00a03b66070944928' }],
	voxlock: [
		{ role: 'voxlock_enroll', sha256: '5d06048c156bb8cd422d29848e6d38fb26a7b39f6f7fd92eccf2a6ed1ce003c6' },
		{ role: 'voxlock_chunk_int8', sha256: 'df61a9d0062b0adbcf1182302b1eb8b815f15ac47ea4923e8e164c1aff64121d' },
	],
} as const);

export interface SherpaEnhancementGrant {
	readonly operation: 'enhance-speech';
	readonly moduleId: 'sherpa-onnx-node';
	readonly jobId: string;
	readonly modelId: SherpaEnhancementModelId;
	readonly input: AssistanceRuntimeFamilyInputGrantV1;
	readonly models: readonly AssistanceRuntimeFamilyModelGrantV1[];
	readonly output: AssistanceRuntimeFamilyOutputGrantV1;
}
export interface SherpaEnhancementResult { readonly byteLength: number; readonly sha256: string; }

export function validateSherpaEnhancementGrant(value: unknown): SherpaEnhancementGrant {
	assertHelperWireEnvelope(value);
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid Sherpa enhancement grant.');
	const row = value as Record<string, unknown>;
	if (Object.keys(row).sort().join(',') !== 'input,jobId,modelId,models,moduleId,operation,output'
		|| row.operation !== 'enhance-speech' || row.moduleId !== 'sherpa-onnx-node'
		|| typeof row.jobId !== 'string' || !/^[a-f\d]{40}$/u.test(row.jobId)
		|| !isSherpaEnhancementModel(row.modelId) || !Array.isArray(row.models)) {
		throw new TypeError('Invalid Sherpa enhancement grant fields.');
	}
	const input = inputGrant(row.input, row.jobId), output = outputGrant(row.output, row.jobId);
	const models = row.models.map(modelGrant);
	const pins = SHERPA_ENHANCEMENT_ARTIFACTS[row.modelId];
	const version = speechEnhancementModel(row.modelId)!.version;
	if (input.role !== 'audio' || input.mediaType !== 'audio/wav'
		|| output.role !== 'enhanced-audio' || output.mediaType !== 'audio/wav'
		|| models.length !== pins.length || pins.some((pin) => models.filter((model) =>
			model.modelId === row.modelId && model.version === version
			&& model.artifactRole === pin.role && model.sha256 === pin.sha256).length !== 1)) {
		throw new TypeError('Sherpa enhancement requires its exact model artifacts and WAV roles.');
	}
	const files = [input, ...models, output];
	if (new Set(files.map(({ path }) => path)).size !== files.length
		|| new Set(files.map(({ identity }) => `${identity.dev}:${identity.ino}`)).size !== files.length) {
		throw new TypeError('Sherpa enhancement files must have distinct paths and identities.');
	}
	return Object.freeze({ operation: 'enhance-speech', moduleId: 'sherpa-onnx-node',
		jobId: row.jobId, modelId: row.modelId, input, models: Object.freeze(models), output });
}

export function validateSherpaEnhancementResult(value: unknown, grant: SherpaEnhancementGrant): SherpaEnhancementResult {
	assertHelperWireEnvelope(value);
	const row = value as Partial<SherpaEnhancementResult> | null;
	if (!row || Object.keys(row).sort().join(',') !== 'byteLength,sha256'
		|| !Number.isSafeInteger(row.byteLength) || row.byteLength! < 45
		|| row.byteLength! > grant.output.maximumByteLength || typeof row.sha256 !== 'string'
		|| !/^[a-f\d]{64}$/u.test(row.sha256)) throw new TypeError('Invalid Sherpa enhanced WAV result.');
	return Object.freeze({ byteLength: row.byteLength!, sha256: row.sha256 });
}
