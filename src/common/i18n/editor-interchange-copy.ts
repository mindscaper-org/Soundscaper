/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveEditorCopyScope } from './editor-copy-scope.ts';

export const INTERCHANGE_COPY_BY_LOCALE = Object.freeze({ en: Object.freeze({ exportOmf: 'Export OMF', exportAaf: 'Export AAF',
	imported: 'Timeline imported. Review File > Delivery Report for conversions and missing media.',
	cleanupFailed: 'Interchange media cleanup failed.',
}) });
export function resolveInterchangeCopy(copy: Readonly<Record<string, unknown>> = {}) {
	return resolveEditorCopyScope('interchange', INTERCHANGE_COPY_BY_LOCALE.en, copy);
}
