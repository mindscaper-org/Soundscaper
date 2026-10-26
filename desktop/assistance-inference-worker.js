/* SPDX-License-Identifier: AGPL-3.0-only */

/** The only process/thread context permitted to load sherpa-onnx native code. */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';

import assistanceNativeRuntimeManifest from '../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import { verifyAssistanceNativeRuntimePayload } from './assistance-native-runtime-payload.mjs';
import { createSherpaDiarizerFactory } from './project-library-runtime/desktop/assistance-sherpa-diarizer.js';
import { createSherpaRecognizerFactory } from './project-library-runtime/desktop/assistance-sherpa-recognizer.js';
import { createSherpaVadFactory } from './project-library-runtime/desktop/assistance-sherpa-vad.js';
import { createSpeechRuntimeAdapter } from './project-library-runtime/desktop/assistance-speech-runtime.js';
import { validateAssistanceSpeechJobGrant } from './project-library-runtime/desktop/assistance-speech-job-contract.js';
import { nativeChildFileIdentityFromStat } from './project-library-runtime/desktop/native-child-file-identity.js';
import { isAssistanceGpuValidationEnabled } from './project-library-runtime/desktop/assistance-gpu-validation.js';
import { createSherpaGpuProfileProvider } from './project-library-runtime/desktop/assistance-sherpa-gpu-validation.js';

let executionProviders;
let disposeNativeResources;
const gpuProfile = isAssistanceGpuValidationEnabled() && workerData?.operation !== 'status' && workerData?.grant?.operation !== 'status'
	? createSherpaGpuProfileProvider(workerData?.gpuValidation) : null;
const acceleration = () => ({ executionProviders,
	...(gpuProfile ? { providerForModel: gpuProfile.providerForModel } : {}) });
const runtime = createSpeechRuntimeAdapter({
	createFactory: (module) => createSherpaRecognizerFactory(module, acceleration()),
	load: loadVerifiedRuntime,
});

void run().finally(() => disposeNativeResources?.()).then(
	(result) => {
		if (gpuProfile) parentPort?.postMessage({ type: 'gpu-profiles', selections: gpuProfile.selections() });
		parentPort?.postMessage({ type: 'result', result });
	},
	(error) => parentPort?.postMessage({
		type: 'error',
		error: {
			name: error instanceof Error ? error.name : 'Error',
			message: error instanceof Error ? error.message : String(error),
		},
	}),
);

async function run() {
	const grant = validateAssistanceSpeechJobGrant(gpuProfile ? workerData.grant : workerData);
	if (grant.operation === 'status') return runtime.status();
	const modelFiles = grant.operation === 'recognize'
		? Object.values(grant.model)
		: grant.operation === 'diarize-speakers' ? Object.values(grant.models) : [grant.model];
	const inputFiles = grant.operation === 'recognize' && grant.voiceActivity
		? [grant.audio, grant.voiceActivity] : [grant.audio];
	for (const file of [...inputFiles, ...modelFiles]) await verifyGrantedFile(file);
	parentPort?.postMessage({ type: 'progress', value: 0 });
	if (grant.operation === 'detect-voice-activity') {
		const module = await loadVerifiedRuntime();
		const detector = createSherpaVadFactory(module, acceleration());
		return detector.detect({
			modelId: grant.modelId,
			audioPath: grant.audio.path,
			model: { model: grant.model.path },
			onProgress: ({ completed, total }) => parentPort?.postMessage({
				type: 'progress', value: total === 0 ? 1 : completed / total,
			}),
		});
	}
	if (grant.operation === 'diarize-speakers') {
		const module = await loadVerifiedRuntime();
		const diarizer = createSherpaDiarizerFactory(module, acceleration());
		return diarizer.diarize({
			audioPath: grant.audio.path,
			modelIds: grant.modelIds,
			models: {
				segmentation: grant.models.segmentation.path,
				embedding: grant.models.embedding.path,
			},
			onProgress: ({ completed, total }) => parentPort?.postMessage({
				type: 'progress', value: total === 0 ? 1 : completed / total,
			}),
		});
	}
	return runtime.recognize({
		modelId: grant.modelId,
		audioPath: grant.audio.path,
		voiceActivityPath: grant.voiceActivity?.path,
		model: {
			encoder: grant.model.encoder.path,
			decoder: grant.model.decoder.path,
			joiner: grant.model.joiner.path,
			tokens: grant.model.tokens.path,
		},
		language: grant.language,
		threads: grant.threads,
	});
}

async function loadVerifiedRuntime() {
	const targetId = process.env.SOUNDSCAPER_ASSISTANCE_RUNTIME_TARGET;
	const outputRoot = process.env.SOUNDSCAPER_ASSISTANCE_RUNTIME_ROOT;
	const verified = await verifyAssistanceNativeRuntimePayload({
		manifest: assistanceNativeRuntimeManifest,
		targetId,
		outputRoot,
	});
	if (verified.status !== 'built' || verified.moduleSpecifier === null) {
		const error = new Error(verified.blockedBy ?? 'The optional speech runtime is unsupported.');
		error.code = 'MODULE_NOT_FOUND';
		throw error;
	}
	executionProviders = verified.executionProviders;
	const module = await import(verified.moduleSpecifier);
	const addon = await import(new URL('./addon.js', verified.moduleSpecifier).href);
	if (typeof addon.default?.disposeGpuResources === 'function') {
		disposeNativeResources = () => addon.default.disposeGpuResources();
	}
	return module;
}

async function verifyGrantedFile(grant) {
	const before = await lstat(grant.path, { bigint: true });
	const beforeIdentity = nativeChildFileIdentityFromStat(before);
	if (!before.isFile() || before.isSymbolicLink()
		|| beforeIdentity.dev !== grant.identity.dev || beforeIdentity.ino !== grant.identity.ino
		|| before.size !== BigInt(grant.bytes)) {
		throw new Error(`The granted assistance ${grant.role} file no longer matches its captured identity.`);
	}
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(grant.path)) hash.update(chunk);
	const after = await lstat(grant.path, { bigint: true });
	const afterIdentity = nativeChildFileIdentityFromStat(after);
	if (!after.isFile() || after.isSymbolicLink()
		|| beforeIdentity.dev !== afterIdentity.dev || beforeIdentity.ino !== afterIdentity.ino
		|| before.size !== after.size
		|| hash.digest('hex') !== grant.sha256) {
		throw new Error(`The granted assistance ${grant.role} file no longer matches its captured digest.`);
	}
}
