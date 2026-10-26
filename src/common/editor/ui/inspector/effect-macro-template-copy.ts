/* SPDX-License-Identifier: AGPL-3.0-only */

import { EFFECT_MACRO_TEMPLATE_COPY_BY_LOCALE } from '../../../i18n/editor-effect-macro-template-copy.ts';
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';

export interface EffectMacroTemplateCopy {
	readonly profileRequired: string;
}


/** Keep the macro noise-profile hint localized without growing the legacy catalog. */
export function resolveEffectMacroTemplateCopy(_locale?: string, copy: Readonly<Record<string, string | undefined>> = {}): EffectMacroTemplateCopy {
	const base = EFFECT_MACRO_TEMPLATE_COPY_BY_LOCALE.en;
	return resolveEditorCopyScope('effectMacroTemplate', base, copy);
}
