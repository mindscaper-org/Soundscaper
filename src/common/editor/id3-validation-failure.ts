/* SPDX-License-Identifier: AGPL-3.0-only */
import type { LocalizedPresentationMessage } from '../i18n/presentation-message.ts';
import { ID3_METADATA_COPY_BY_LOCALE } from '../i18n/editor-id3-metadata-copy.ts';
import { FILE_VALIDATION_COPY } from '../i18n/editor-file-validation-copy.ts';
import { ID3_DESCRIPTIVE_FIELDS } from './id3-descriptive-fields.ts';
import { fileValidationFailure } from './file-validation-failure.ts';
const FIELDS = new Map(ID3_DESCRIPTIVE_FIELDS.map(field => [field.key.toLowerCase().replace(/[^a-z0-9]/gu, ''), field.key]));
const FRAMES = new Map([...ID3_DESCRIPTIVE_FIELDS].reverse().map(field => [field.frame, field.key]));
export function id3FieldForFrame(frame: string): string { return FRAMES.get(frame) ?? ''; }
function fieldMessage(name: string): string | LocalizedPresentationMessage {
	const canonical = FIELDS.get(name.toLowerCase().replace(/[^a-z0-9]/gu, ''));
	const copy = ID3_METADATA_COPY_BY_LOCALE.en as Readonly<Record<string, string>>;
	return canonical && copy[canonical] ? { key: `ui.id3Metadata.${canonical}`, fallback: copy[canonical] } : name || { key: 'ui.fileValidation.id3Field', fallback: FILE_VALIDATION_COPY.id3Field };
}
export function id3ValidationFailure<Failure extends Error>(error: Failure, key: Extract<keyof typeof FILE_VALIDATION_COPY, `id3${string}`>, field = '', parameters?: LocalizedPresentationMessage['parameters']): Failure {
	return fileValidationFailure(error, 'editor-input', `id3-${key}`, key, { field: fieldMessage(field), ...parameters });
}
