/* SPDX-License-Identifier: AGPL-3.0-only */
import React, { useMemo, type ReactNode } from 'react';
import { ComponentCopyProvider } from '@soundscaper/design-system/contexts/ComponentCopyContext';
import { DESIGN_SYSTEM_COPY } from '../../i18n/editor-design-system-copy.ts';
import { resolveEditorCopyScope } from '../../i18n/editor-copy-scope.ts';

export function EditorComponentCopyProvider({ copy, locale, children }: {
	readonly copy: Readonly<Record<string, unknown>>;
	readonly locale: string;
	readonly children: ReactNode;
}) {
	const messages = useMemo(() => resolveEditorCopyScope('designSystem', DESIGN_SYSTEM_COPY.en, {
		...copy,
		...Object.fromEntries(Object.entries(DESIGN_SYSTEM_COPY.aliases).map(([key, alias]) => [key, copy[alias]])),
	}), [copy]);
	return <ComponentCopyProvider copy={messages} locale={locale}>{children}</ComponentCopyProvider>;
}
