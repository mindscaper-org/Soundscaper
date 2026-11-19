/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveEditorCopyScope } from '../../i18n/editor-copy-scope.ts';
import { TRANSCRIPT_EDITING_COPY_BY_LOCALE } from '../../i18n/editor-transcript-editing-copy.ts';

export function transcriptEditingMenuItem(copy: Readonly<Record<string, string>>, toggle: (panelId: string) => unknown) {
	return { id: 'transcript-based-editing', label: resolveEditorCopyScope('transcriptEditing',
		TRANSCRIPT_EDITING_COPY_BY_LOCALE.en, copy).title, onClick: () => toggle('transcript-editing') };
}
