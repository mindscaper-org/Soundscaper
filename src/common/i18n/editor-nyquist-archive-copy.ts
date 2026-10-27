/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveEditorCopyScope } from './editor-copy-scope.ts';

export const NYQUIST_ARCHIVE_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze({
		downloadHttp: "Unable to download the Nyquist archive (HTTP {status}).",
		downloadFailed: "The Nyquist archive could not be downloaded.",
		tooLarge: "The Nyquist archive download exceeds its size limit.",
		missingBody: "The Nyquist archive download is empty.",
		integrity: "The Nyquist archive failed its integrity check.",
		invalidCatalog: "The Nyquist archive catalog is invalid.",
		unsupportedPlugin: "This Nyquist plug-in needs features unavailable in the browser.",
		storageUnavailable: "Browser storage is unavailable for Nyquist plug-ins.",
		storageQuota: "Browser storage is full. Remove stored data before installing another plug-in.",
		storageFailed: "The Nyquist plug-in could not be saved in browser storage.",
		installFailed: "The Nyquist plug-in could not be installed.",
		removeFailed: "The Nyquist plug-in could not be removed.",
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
