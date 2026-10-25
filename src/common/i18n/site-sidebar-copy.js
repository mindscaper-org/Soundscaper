/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Copy owned by the shared product sidebar.
 *
 * English navigation copy; translations live in the per-locale JSON catalogs.
 */
const SITE_SIDEBAR_COPY_ENTRIES = Object.freeze([
	['sidebarNavigation', 'Soundscaper navigation'],
	['sidebarSettings', 'Settings'],
	['audioEditorLink', 'Audio editor'],
	['joinUsLink', 'Join us'],
	['downloadLink', 'Download'],
	['legalLink', 'Privacy policy'],
	['reportIssueLink', 'Report an issue'],
	['githubProjectLink', 'GitHub project'],
	['themeToggle', 'Switch color theme'],
	['lightTheme', 'Light'],
	['darkTheme', 'Dark'],
	['collapseNavigation', 'Collapse navigation'],
	['expandNavigation', 'Expand navigation'],
	['languageLabel', 'Language'],
]);

export const SITE_SIDEBAR_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(SITE_SIDEBAR_COPY_ENTRIES.map(([key, en]) => [key, en]))),
});
