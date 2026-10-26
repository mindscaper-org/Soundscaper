/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveEditorCopyScope } from './editor-copy-scope.ts';

export const ORIGINAL_FILE_OVERWRITE_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze({
		overwriteOriginal: 'Overwrite original file',
		overwriteNamedOriginal: 'Overwrite {filename}',
	}),
});

export function resolveOriginalFileOverwriteCopy(copy: Readonly<Record<string, unknown>> = {}) {
	return resolveEditorCopyScope('originalFileOverwrite', ORIGINAL_FILE_OVERWRITE_COPY_BY_LOCALE.en, copy);
}
