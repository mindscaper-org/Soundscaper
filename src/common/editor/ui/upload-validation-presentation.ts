/* SPDX-License-Identifier: AGPL-3.0-only */
import { UPLOAD_VALIDATION_COPY } from './workspace/upload-validation-copy.ts';
import { uploadValidationFailure, type UploadValidationFailure } from '../upload-validation-failure.ts';
import { formatLocalizedTemplate } from './localization-template.ts';

export function uploadFailureLabel(failure: UploadValidationFailure | undefined, copy: Readonly<Record<string, string>>, fallback: string): string {
	if (!failure) return fallback;
	const key = `uploadValidation${failure.reason[0]!.toUpperCase()}${failure.reason.slice(1)}` as keyof typeof UPLOAD_VALIDATION_COPY;
	const template = copy[key] ?? UPLOAD_VALIDATION_COPY[key];
	const parameters = { ...failure.parameters };
	if ((failure.reason === 'fieldRequired' || failure.reason === 'fieldTooLong') && typeof parameters.field === 'string') {
		const field = parameters.field;
		parameters.field = field === 'title' ? copy.uploadTitle ?? copy.title ?? 'title'
			: field === 'description' ? copy.uploadDescription ?? copy.description ?? 'description'
				: field === 'category' ? copy.uploadCategory ?? copy.category ?? 'category'
					: field === 'tag' ? formatLocalizedTemplate(copy.uploadValidationTagField ?? UPLOAD_VALIDATION_COPY.uploadValidationTagField, { index: parameters.index ?? '' })
						: field === 'upload filename' ? copy.uploadValidationUploadFilename ?? UPLOAD_VALIDATION_COPY.uploadValidationUploadFilename : field;
	}
	return template ? formatLocalizedTemplate(template, parameters) : fallback;
}
export function uploadErrorLabel(error: unknown, copy: Readonly<Record<string, string>>, fallback: string): string {
	return uploadFailureLabel(uploadValidationFailure(error), copy, fallback);
}
