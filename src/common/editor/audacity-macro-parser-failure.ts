/* SPDX-License-Identifier: AGPL-3.0-only */
import { FORMAT_FILE_FAILURE_COPY } from '../i18n/editor-format-file-failure-copy.ts';
import { withFormatFileFailure } from './format-file-failure.ts';

export type AudacityMacroFailureReason = 'TEXT' | 'SIZE' | 'LINES' | 'LINE_LIMIT' | 'COMMAND' | 'PARAMETER_LIMIT'
	| 'EQUALS' | 'PARAMETER_NAME' | 'QUOTED_VALUE' | 'ESCAPE' | 'UNTERMINATED' | 'UNEXPECTED_TEXT' | 'PARAMETERS'
	| 'PRESET_LINE' | 'PRESET_EFFECT';
const keys = { TEXT: 'macroText', SIZE: 'macroSize', LINES: 'macroLines', LINE_LIMIT: 'macroLineLimit', COMMAND: 'macroCommand',
	PARAMETER_LIMIT: 'macroParameterLimit', EQUALS: 'macroEquals', PARAMETER_NAME: 'macroParameterName', QUOTED_VALUE: 'macroQuotedValue',
	ESCAPE: 'macroEscape', UNTERMINATED: 'macroUnterminated', UNEXPECTED_TEXT: 'macroUnexpectedText', PARAMETERS: 'macroParameters',
	PRESET_LINE: 'audacityPresetLine', PRESET_EFFECT: 'audacityPresetEffect' } as const;
export function audacityMacroParserFailure<Failure extends Error>(error: Failure, reason: AudacityMacroFailureReason,
	line = 0, parameter = ''): Failure {
	const key = keys[reason];
	return withFormatFileFailure(error, { family: 'audacity-preset', reason,
		message: { key: `ui.formatFileFailure.${key}`, fallback: FORMAT_FILE_FAILURE_COPY[key],
			parameters: { line, parameter: parameter.slice(0, 128) } } });
}
export function macroSyntaxError(lineNumber: number, message: string, cause?: unknown,
	reason: AudacityMacroFailureReason = 'PARAMETERS', parameter = ''): SyntaxError {
	return audacityMacroParserFailure(new SyntaxError(`Invalid effect macro line ${String(lineNumber)}: ${message}`,
		cause ? { cause } : undefined), reason, lineNumber, parameter);
}
export function audacityMacroFileLimitError(): RangeError {
	return audacityMacroParserFailure(new RangeError('File exceeds the 1 MiB macro import limit.'), 'SIZE');
}
