/* SPDX-License-Identifier: AGPL-3.0-only */

import { FORMAT_FILE_FAILURE_COPY } from '../i18n/editor-format-file-failure-copy.ts';
import { withFormatFileFailure, formatFileFailure, type FormatFileFailureFamily } from './format-file-failure.ts';

const cueReasons: Readonly<Record<string, keyof typeof FORMAT_FILE_FAILURE_COPY>> = {
	INVALID_TIMESTAMP: 'cueTimestamp', MISSING_INDEX: 'cueMissingIndex', MULTI_FILE_UNSUPPORTED: 'cueMultipleFiles',
	CUE_LIMIT: 'cueLimit', INPUT_LIMIT: 'cueLimit', NON_CHRONOLOGICAL_INDEX: 'cueOrder', INVALID_TRACK: 'cueTrack',
	INVALID_INDEX: 'cueIndex', DUPLICATE_INDEX: 'cueDuplicateIndex', INVALID_UTF8: 'cueUtf8', INVALID_CHARACTER: 'cueCharacter',
	INVALID_FILE: 'cueFile', INVALID_TITLE: 'cueTitle', INVALID_PERFORMER: 'cuePerformer',
};
const legacyReasons: Readonly<Record<string, keyof typeof FORMAT_FILE_FAILURE_COPY>> = {
	INVALID_PROJECT_XML: 'legacyXml', MISSING_BLOCK_FILES: 'legacyMissingBlocks', AMBIGUOUS_BLOCK_FILE: 'legacyAmbiguousBlocks',
	CORRUPT_BLOCK_FILE: 'legacyCorruptBlocks', CORRUPT_BLOCK_FILES: 'legacyCorruptBlocks',
	PROJECT_BLOCK_SIZE_MISMATCH: 'legacyCorruptBlocks', INVALID_BLOCK_FILE_SIZE: 'legacyCorruptBlocks',
	UNSUPPORTED_ALIAS_BLOCK: 'legacyAlias', UNSUPPORTED_SAMPLE_FORMAT: 'legacySampleFormat',
	INVALID_SAMPLE_RATE: 'legacySampleRate', CORRUPT_LINKED_TRACK: 'legacyLinkedTrack',
};
const audacityReasons: Readonly<Record<string, keyof typeof FORMAT_FILE_FAILURE_COPY>> = {
	NOT_AUP4: 'audacityInvalidDatabase', INVALID_DATABASE: 'audacityInvalidDatabase', CORRUPT_DATABASE: 'audacityCorruptDatabase',
	INVALID_PROJECT_XML: 'audacityInvalidXml', EMPTY_PROJECT: 'audacityInvalidXml', UNSAFE_SCHEMA: 'audacityUnsupported',
	UNSUPPORTED_SCHEMA: 'audacityUnsupported', UNSUPPORTED_VERSION: 'audacityUnsupported',
	MISSING_SAMPLEBLOCK: 'audacityMissingAudio', MISSING_SAMPLE_BLOCK: 'audacityMissingAudio',
	INVALID_SAMPLE_BLOCK: 'audacityMissingAudio', CORRUPT_SEQUENCE: 'audacityMissingAudio',
	REFERENCE_LIMIT: 'audacityLimit', CORRUPT_SAMPLEBLOCK: 'audacityMissingAudio', PROJECT_TOO_LARGE: 'audacityLimit', TIMEOUT: 'audacityTimeout',
};

export function annotateFormatFileFailure<Failure>(error: Failure,
	family: 'dawproject' | 'sesx' | 'audacity-database' | 'scape' | 'legacy-aup' | 'cue' | 'edl',
	reason: string): Failure {
	if (!(error instanceof Error) || formatFileFailure(error)) return error;
	const key = reasonKey(family, reason);
	withFormatFileFailure(error, { family, reason,
		message: { key: `ui.formatFileFailure.${key}`, fallback: FORMAT_FILE_FAILURE_COPY[key] } });
	return error;
}
function reasonKey(family: FormatFileFailureFamily, reason: string): keyof typeof FORMAT_FILE_FAILURE_COPY {
	switch (family) {
		case 'dawproject': return reason === 'XML' ? 'dawprojectXml' : 'dawprojectArchive';
		case 'sesx': return reason === 'DESKTOP_REQUIRED' ? 'sesxDesktopRequired' : 'sesxUnavailable';
		case 'scape': return reason === 'REIMPORT_REQUIRED' ? 'scapeReimport' : 'scapeArchive';
		case 'cue': return cueReasons[reason] ?? 'cueInvalid';
		case 'legacy-aup': return legacyReasons[reason] ?? (reason.endsWith('_LIMIT') || reason.endsWith('_TOO_LARGE') ? 'legacyLimit' : 'legacyRead');
		case 'audacity-database': return audacityReasons[reason] ?? (/UNSUPPORTED|UNSAFE/u.test(reason) ? 'audacityUnsupported' : 'audacityRead');
		case 'edl': return reason === 'RATE' ? 'edlRate' : reason === 'FRAME_FIELDS' ? 'edlFrameFields'
			: reason === 'EVENT_LIMIT' ? 'edlEventLimit' : reason === 'DROP_FRAME' ? 'edlDropFrame' : 'edlTimecode';
		default: throw new TypeError('This parser failure family needs its own presentation owner.');
	}
}

export function withFormatFileParserFailure<Value>(family: Parameters<typeof annotateFormatFileFailure>[1], reason: string, action: () => Value): Value {
	try { return action(); } catch (error) { throw annotateFormatFileFailure(error, family, reason); }
}
export async function withFormatFileParserFailureAsync<Value>(family: Parameters<typeof annotateFormatFileFailure>[1], reason: string, action: () => Promise<Value>): Promise<Value> {
	try { return await action(); } catch (error) { throw annotateFormatFileFailure(error, family, reason); }
}
