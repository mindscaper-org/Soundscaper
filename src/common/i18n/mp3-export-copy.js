/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Copy for the MP3 export bit-rate row.
 *
 * Audacity offers four bit-rate strategies and names every preset and quality
 * step it can encode at, so the row is a dozen strings that grow whenever an
 * encoder gains a mode. The main catalog sits at a maintainability ceiling that
 * a per-mode string should not push up, so this family lives behind its own
 * seam like the export menu's does.
 */
const MP3_EXPORT_COPY_ENTRIES = Object.freeze([
	['bitRateMode', 'Bit Rate Mode'],
	['bitRateModePreset', 'Preset'],
	['bitRateModeVariable', 'Variable'],
	['bitRateModeAverage', 'Average'],
	['bitRateModeConstant', 'Constant'],
	['mp3PresetExcessive', 'Excessive, 320 kbps'],
	['mp3PresetExtreme', 'Extreme, 220-260 kbps'],
	['mp3PresetStandard', 'Standard, 170-210 kbps'],
	['mp3PresetMedium', 'Medium, 145-185 kbps'],
	['mp3VariableBest', '220-260 kbps (Best Quality)'],
	['mp3VariableSmallest', '45-85 kbps (Smaller files)'],
]);

export const MP3_EXPORT_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(MP3_EXPORT_COPY_ENTRIES.map(([key, en]) => [key, en]))),
});
