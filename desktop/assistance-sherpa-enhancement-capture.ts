/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectFile, type AssistanceRuntimeFamilyInputCapture,
	type AssistanceRuntimeFamilyModelCapture, type AssistanceRuntimeFamilyOutputCapture } from './assistance-runtime-family-file-grants.ts';
import { validateSherpaEnhancementGrant, type SherpaEnhancementGrant } from './assistance-sherpa-enhancement-contract.ts';

export interface SherpaEnhancementRequest {
	readonly jobId: string;
	readonly modelId: string;
	readonly input: AssistanceRuntimeFamilyInputCapture;
	readonly models: readonly AssistanceRuntimeFamilyModelCapture[];
	readonly output: AssistanceRuntimeFamilyOutputCapture;
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: Readonly<{ completed: number; total: number }>) => void;
}

export async function captureSherpaEnhancementGrant(request: SherpaEnhancementRequest): Promise<SherpaEnhancementGrant> {
	const { input, output, jobId, signal } = request;
	if (input.claim.jobId !== jobId || output.reservation.jobId !== jobId) throw new TypeError('Foreign enhancement job claim.');
	const capturedInput = await inspectFile(input.path, { minimumBytes: input.claim.byteLength,
		maximumBytes: input.claim.byteLength, expectedSha256: input.claim.sha256, label: 'enhancement input', signal });
	const models = await Promise.all(request.models.map(async (model) => ({ ...model,
		identity: (await inspectFile(model.path, { minimumBytes: model.byteLength, maximumBytes: model.byteLength,
			expectedSha256: model.sha256, label: 'enhancement model', signal })).identity })));
	const capturedOutput = await inspectFile(output.path, { minimumBytes: 0, maximumBytes: 0,
		expectedSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', label: 'enhancement output', signal });
	return validateSherpaEnhancementGrant({ operation: 'enhance-speech', moduleId: 'sherpa-onnx-node',
		jobId, modelId: request.modelId,
		input: { claimId: input.claim.claimId, role: input.claim.role, mediaType: input.claim.mediaType,
			path: input.path, ...capturedInput }, models,
		output: { claimId: output.reservation.claimId, role: output.reservation.role,
			mediaType: output.reservation.mediaType, path: output.path,
			maximumByteLength: output.reservation.maximumByteLength, initialByteLength: 0,
			initialSha256: capturedOutput.sha256, identity: capturedOutput.identity } });
}

export async function authenticateSherpaEnhancementGrant(grant: SherpaEnhancementGrant): Promise<void> {
	for (const file of [grant.input, ...grant.models]) await inspectFile(file.path, {
		minimumBytes: file.byteLength, maximumBytes: file.byteLength, expectedSha256: file.sha256,
		expectedIdentity: file.identity, label: 'enhancement worker input' });
	await inspectFile(grant.output.path, { minimumBytes: 0, maximumBytes: 0,
		expectedSha256: grant.output.initialSha256, expectedIdentity: grant.output.identity, label: 'enhancement worker output' });
}
