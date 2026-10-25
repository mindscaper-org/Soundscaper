/* SPDX-License-Identifier: AGPL-3.0-only */

import { localeLanguage } from './locale.js';

/**
 * Names for the groups the shortcut editor sorts commands into. A command that
 * the running menubar contains is grouped under that menu's own live label; the
 * rest are grouped by the first place the action inventory records them, and
 * these are the names those places carry.
 */
const ENTRIES = Object.freeze([
	['shortcutCategoryFile', 'File'],
	['shortcutCategoryEdit', 'Edit'],
	['shortcutCategorySelect', 'Select'],
	['shortcutCategoryView', 'View'],
	['shortcutCategoryRecord', 'Record'],
	['shortcutCategoryTransport', 'Transport'],
	['shortcutCategoryTracks', 'Tracks'],
	['shortcutCategoryGenerate', 'Generate'],
	['shortcutCategoryEffect', 'Effect'],
	['shortcutCategoryAnalyze', 'Analyze'],
	['shortcutCategoryTools', 'Tools'],
	['shortcutCategoryHelp', 'Help'],
	['shortcutCategoryExtra', 'Extra'],
	['shortcutCategoryNyquist', 'Nyquist'],
	['shortcutCategoryApplication', 'Application'],
	['shortcutCategoryApplicationMenu', 'Application menu'],
	['shortcutCategoryDeveloperMenu', 'Developer menu'],
	['shortcutCategoryDiagnostics', 'Diagnostics'],
	['shortcutCategoryAudioSetup', 'Audio setup'],
	['shortcutCategoryKeyboardNavigation', 'Keyboard navigation'],
	['shortcutCategoryClipContext', 'Clip context menu'],
	['shortcutCategoryTrackContext', 'Track context menu'],
	['shortcutCategoryClipProperties', 'Clip properties'],
	['shortcutCategoryRealtimeEffectContext', 'Realtime effect context menu'],
	['shortcutCategoryRealtimeEffectRack', 'Realtime effect rack'],
	['shortcutCategoryEffectDialog', 'Effect dialog'],
	['shortcutCategoryToolsToolbar', 'Tools toolbar'],
	['shortcutCategoryTransportToolbar', 'Transport toolbar'],
	['shortcutCategoryMixerToolbar', 'Mixer toolbar'],
	['shortcutCategoryMeterToolbar', 'Meter toolbar'],
	['shortcutCategoryTimelineRuler', 'Timeline ruler'],
	['shortcutCategoryCommandInventory', 'Command inventory'],
	['shortcutCategoryOther', 'Other commands'],
]);

export const SHORTCUT_CATEGORY_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))),
});

/** Resolve one category name from a copy catalog or a bare locale. */
export function shortcutCategoryCopyValue(key, copyOrLocale = 'en') {
	const fallback = SHORTCUT_CATEGORY_COPY_BY_LOCALE.en;
	if (copyOrLocale && typeof copyOrLocale === 'object') {
		return copyOrLocale[key] ?? fallback[key] ?? key;
	}
	const catalog = SHORTCUT_CATEGORY_COPY_BY_LOCALE[localeLanguage(copyOrLocale)] || fallback;
	return catalog[key] ?? fallback[key] ?? key;
}
