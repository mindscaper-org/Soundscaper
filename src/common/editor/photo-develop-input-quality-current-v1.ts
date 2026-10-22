/* SPDX-License-Identifier: AGPL-3.0-only */
/** Presentation input only. Preview derivatives never become Originals or
 * authorize full-resolution rendering, delivery or RAW source processing. */
export type PhotoDevelopInputQualityCurrentV1 = 'original' | 'preview-derivative';
export function preparePhotoDevelopInputQualityCurrentV1(value: unknown): PhotoDevelopInputQualityCurrentV1 {
	if (value === undefined) return 'original';
	if (value !== 'original' && value !== 'preview-derivative') throw new TypeError('Unknown Develop input quality.');
	return value;
}
