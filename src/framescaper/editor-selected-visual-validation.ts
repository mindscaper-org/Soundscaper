/* SPDX-License-Identifier: AGPL-3.0-only */
import { fileValidationFailure } from '../common/editor/file-validation-failure.ts';
import { FILE_VALIDATION_COPY } from '../common/i18n/editor-file-validation-copy.ts';
const FIELDS: Readonly<Record<string, readonly [string, string]>> = {
	'mask width': ['ui.selectedVisualAuthoring.width', 'Width'], 'mask height': ['ui.selectedVisualAuthoring.height', 'Height'],
	'adjustment brightness': ['ui.selectedVisualAuthoring.brightness', 'Brightness'],
};
export function visualAuthoringBoundFailure(error: RangeError, name: string, minimum: number, maximum: number): RangeError {
	const [key, fallback] = Object.hasOwn(FIELDS, name) ? FIELDS[name]! : ['ui.fileValidation.visualParameter', FILE_VALIDATION_COPY.visualParameter];
	return fileValidationFailure(error, 'editor-input', 'visual-numeric-bounds', 'visualBounds', { field: { key: key!, fallback: fallback! }, minimum, maximum });
}

export function boundedVisualAuthoringValue(value: unknown, minimum: number, maximum: number, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw visualAuthoringBoundFailure(new RangeError(`${name} is outside its finite bound.`), name, minimum, maximum);
	}
	return Object.is(value, -0) ? 0 : value;
}
