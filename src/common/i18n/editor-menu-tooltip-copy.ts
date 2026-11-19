/* SPDX-License-Identifier: AGPL-3.0-only */
import { MENU_TOOLTIP_COMMANDS } from './editor-menu-tooltip-commands-copy.ts';
import { MENU_TOOLTIP_CONTEXT_DEFINITIONS } from './editor-menu-tooltip-context-copy.ts';

export const MENU_TOOLTIP_DEFINITIONS = Object.freeze({ ...MENU_TOOLTIP_CONTEXT_DEFINITIONS, ...MENU_TOOLTIP_COMMANDS });
export const MENU_TOOLTIP_COPY: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(
	Object.entries(MENU_TOOLTIP_DEFINITIONS).map(([id, [, description]]) => [id, description]),
));
