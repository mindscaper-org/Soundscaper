/* SPDX-License-Identifier: AGPL-3.0-only */

const ENTRIES = Object.freeze([
	['arrangePanel', 'Arrange panel'],
	['arrangeBefore', 'Before'],
	['arrangeTab', 'As tab'],
	['arrangeAfter', 'After'],
	['panelMenu', 'Panel menu'],
	['timecode', 'Timecode'],
	['snapInterval', 'Snap interval'],
	['layout', 'Layout'],
	['layoutAuto', 'Automatic'],
	['layoutCompact', 'Compact (menus and track headers in drawers)'],
	['layoutDesktop', 'Desktop'],
	['defaultTrackView', 'Default view'],
	['defaultTrackViewNote', 'How tracks are drawn until one is given a display of its own.'],
	['chromeMenu', 'Menu'],
	['chromeMenuClose', 'Close menu'],
	['trackHeaders', 'Track headers'],
	['trackHeadersShow', 'Show track headers'],
	['trackHeadersHide', 'Hide track headers'],
]);

export const WORKSPACE_CHROME_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))),
});
