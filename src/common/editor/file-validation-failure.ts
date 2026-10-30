/* SPDX-License-Identifier: AGPL-3.0-only */
import { FILE_VALIDATION_COPY } from '../i18n/editor-file-validation-copy.ts';
import type { LocalizedPresentationMessage } from '../i18n/presentation-message.ts';
import { withFormatFileFailure, type FormatFileFailureFamily } from './format-file-failure.ts';
export function fileValidationFailure<Failure extends Error>(error: Failure, family: FormatFileFailureFamily,
	reason: string, key: keyof typeof FILE_VALIDATION_COPY, parameters?: LocalizedPresentationMessage['parameters']): Failure {
	return withFormatFileFailure(error, { family, reason, message: { key: `ui.fileValidation.${key}`, fallback: FILE_VALIDATION_COPY[key], ...(parameters ? { parameters } : {}) } });
}
