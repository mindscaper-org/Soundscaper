/* SPDX-License-Identifier: AGPL-3.0-only */
import { FORMAT_FILE_FAILURE_COPY } from '../i18n/editor-format-file-failure-copy.ts';
import { formatFileFailure, withFormatFileFailure } from './format-file-failure.ts';

const labelReasons: Readonly<Record<string, keyof typeof FORMAT_FILE_FAILURE_COPY>> = {
	INVALID_UTF8: 'labelEncoding', INVALID_CHARACTER: 'labelCharacter', INVALID_TXT_ROW: 'labelTxtRow',
	MISSING_WEBVTT_HEADER: 'labelVttHeader', MISSING_CUE_TIMING: 'labelCueTiming', INVALID_CUE_TIMING: 'labelCueTiming',
	INVALID_TIMESTAMP: 'labelTimestamp', INVALID_TIME: 'labelTimestamp', TIME_RANGE: 'labelTimestamp',
	REVERSED_RANGE: 'labelReversed', DUPLICATE_LABEL_ID: 'labelDuplicateId',
};
export function annotateLabelParserFailure(error: Error, code: string, details: Readonly<Record<string, unknown>>): void {
	const key = labelReasons[code] ?? (code.endsWith('_LIMIT') ? 'labelLimit' : 'labelInvalid');
	const line = typeof details.line === 'number' && Number.isSafeInteger(details.line) ? details.line : null;
	withFormatFileFailure(error, { family: 'labels', reason: code, message: {
		key: `ui.formatFileFailure.${key}`, fallback: FORMAT_FILE_FAILURE_COPY[key],
		...(line === null ? {} : { append: [' ', { key: 'ui.formatFileFailure.lineLocation', parameters: { line }, fallback: FORMAT_FILE_FAILURE_COPY.lineLocation }] }),
	} });
}
export function effectPresetImportFailure<Failure>(error: Failure, reason: 'JSON' | 'SCHEMA' | 'RECORD' | 'EMPTY'): Failure {
	if (!(error instanceof Error) || formatFileFailure(error)) return error;
	const key = reason === 'JSON' ? 'presetJson' : reason === 'SCHEMA' ? 'presetSchema' : reason === 'EMPTY' ? 'presetEmpty' : 'presetRecord';
	return withFormatFileFailure(error, { family: 'effect-preset', reason,
		message: { key: `ui.formatFileFailure.${key}`, fallback: FORMAT_FILE_FAILURE_COPY[key] } });
}
