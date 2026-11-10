/* SPDX-License-Identifier: AGPL-3.0-only */

/** Reviewed enhancement choices shared by effect settings and native admission. */
export const SPEECH_ENHANCEMENT_MODELS = Object.freeze([
	{ modelId: 'deepfilternet3', version: '3.0.0', label: 'DeepFilterNet3', sampleRate: 48_000 },
	{ modelId: 'gtcrn', version: '1.0.0', label: 'GTCRN — lightweight noise reduction', sampleRate: 16_000 },
	{ modelId: 'dpdfnet2-48khz', version: '1.0.0', label: 'DPDFNet2 — 48 kHz noise reduction', sampleRate: 48_000 },
	{ modelId: 'voxlock', version: '1.1.1', label: 'VoxLock — isolate the main voice', sampleRate: 16_000 },
] as const);
export type SpeechEnhancementModelId = typeof SPEECH_ENHANCEMENT_MODELS[number]['modelId'];
export type SherpaEnhancementModelId = Exclude<SpeechEnhancementModelId, 'deepfilternet3'>;

export function speechEnhancementModel(modelId: unknown) {
	return SPEECH_ENHANCEMENT_MODELS.find((model) => model.modelId === modelId);
}

export function isSherpaEnhancementModel(modelId: unknown): modelId is SherpaEnhancementModelId {
	return modelId !== 'deepfilternet3' && speechEnhancementModel(modelId) !== undefined;
}
