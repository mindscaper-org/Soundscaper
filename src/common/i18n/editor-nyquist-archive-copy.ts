/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveEditorCopyScope } from './editor-copy-scope.ts';

export const NYQUIST_ARCHIVE_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze({
		getEffects: 'Get effects',
		description: 'Browse the archived Audacity Nyquist catalog. These third-party plug-ins may need Audacity features unavailable in the browser. Installed source stays in this browser; run it later from a Nyquist menu.',
		searchEffects: 'Search effects',
		effectCount: '{count} effects',
		installEffect: 'Install',
		removeEffect: 'Remove',
	}),
});

export function resolveNyquistArchiveCopy(copy = {}) {
	return resolveEditorCopyScope('nyquistArchive', NYQUIST_ARCHIVE_COPY_BY_LOCALE.en, copy);
}
