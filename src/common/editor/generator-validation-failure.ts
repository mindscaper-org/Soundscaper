/* SPDX-License-Identifier: AGPL-3.0-only */
import type { LocalizedPresentationMessage } from '../i18n/presentation-message.ts';
import { GENERATOR_COPY_BY_LOCALE } from '../i18n/generator-copy.js';
import { FILE_VALIDATION_COPY } from '../i18n/editor-file-validation-copy.ts';
import { fileValidationFailure } from './file-validation-failure.ts';
import { formatFileFailure, withFormatFileFailure, type FormatFileFailure } from './format-file-failure.ts';
const FIELDS: Readonly<Record<string, readonly [string, string]>> = {
	sampleRate: ['sampleRate', 'Sample rate'], channelCount: ['rawPcmChannelCount', 'Channels'],
	durationSeconds: ['generatorDuration', GENERATOR_COPY_BY_LOCALE.en.generatorDuration], amplitude: ['generatorAmplitude', GENERATOR_COPY_BY_LOCALE.en.generatorAmplitude],
	frequency: ['generatorFrequency', GENERATOR_COPY_BY_LOCALE.en.generatorFrequency], startFrequency: ['generatorStartFrequency', GENERATOR_COPY_BY_LOCALE.en.generatorStartFrequency],
	endFrequency: ['generatorEndFrequency', GENERATOR_COPY_BY_LOCALE.en.generatorEndFrequency], waveform: ['generatorWaveform', GENERATOR_COPY_BY_LOCALE.en.generatorWaveform],
	startAmplitude: ['generatorStartAmplitude', 'Start amplitude (0–1)'], endAmplitude: ['generatorEndAmplitude', 'End amplitude (0–1)'],
	interpolation: ['generatorInterpolation', GENERATOR_COPY_BY_LOCALE.en.generatorInterpolation], color: ['generatorNoiseColor', GENERATOR_COPY_BY_LOCALE.en.generatorNoiseColor],
	toneSeconds: ['generatorToneDuration', GENERATOR_COPY_BY_LOCALE.en.generatorToneDuration], silenceSeconds: ['generatorSilenceDuration', GENERATOR_COPY_BY_LOCALE.en.generatorSilenceDuration],
	wordsPerMinute: ['generatorMorseSpeed', GENERATOR_COPY_BY_LOCALE.en.generatorMorseSpeed],
};
export function generatorFieldMessage(name: string): LocalizedPresentationMessage {
	const [key, fallback] = Object.hasOwn(FIELDS, name) ? FIELDS[name]! : ['ui.fileValidation.generatorParameter', FILE_VALIDATION_COPY.generatorParameter];
	return { key: key!, fallback: fallback! };
}
export function generatorValidationFailure<Failure extends Error>(error: Failure, key: Extract<keyof typeof FILE_VALIDATION_COPY, `generator${string}`>, parameters?: LocalizedPresentationMessage['parameters']): Failure {
	return fileValidationFailure(error, 'editor-input', `generator-${key}`, key, parameters);
}
export interface GeneratorWorkerFailure {
	readonly name: string; readonly message: string; readonly failure?: FormatFileFailure;
}
export function serializeGeneratorFailure(error: unknown): GeneratorWorkerFailure {
	const failure = formatFileFailure(error);
	return { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error), ...(failure ? { failure } : {}) };
}
export function restoreGeneratorFailure(data: Partial<GeneratorWorkerFailure> | undefined): Error {
	const Constructor = data?.name === 'RangeError' ? RangeError : data?.name === 'TypeError' ? TypeError : data?.name === 'SyntaxError' ? SyntaxError : Error;
	const error = new Constructor(data?.message || 'Generator stream failed.'); error.name = data?.name || 'Error';
	return data?.failure?.family === 'editor-input' && data.failure.reason.startsWith('generator-') ? withFormatFileFailure(error, data.failure) : error;
}
