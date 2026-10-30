/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AraFailureCode } from '../../ara-failure.ts';
import { ARA_COPY_BY_LOCALE } from '../../../i18n/editor-ara-copy.ts';
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';
const KEYS = { 'unsupported-plugin': 'unsupportedPlugin', unavailable: 'unavailable', revoked: 'revoked', closed: 'sessionClosed',
	'selection-changed': 'selectionChanged', cancelled: 'cancelled', 'open-failed': 'openingFailed', 'editor-failed': 'editorFailed',
	'render-failed': 'renderFailed', 'discovery-failed': 'discoveryFailed', 'operation-failed': 'operationFailed',
} satisfies Record<AraFailureCode, keyof typeof ARA_COPY_BY_LOCALE.en>;
export function araFailureLabel(code: AraFailureCode | null | undefined, copy: Readonly<Record<string, string | undefined>>): string {
	return resolveEditorCopyScope('ara', ARA_COPY_BY_LOCALE.en, copy)[KEYS[code ?? 'operation-failed']];
}
