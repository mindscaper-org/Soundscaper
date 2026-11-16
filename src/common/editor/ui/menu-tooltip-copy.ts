/* SPDX-License-Identifier: AGPL-3.0-only */
import { MENU_TOOLTIP_COPY, MENU_TOOLTIP_DEFINITIONS } from '../../i18n/editor-menu-tooltip-copy.ts';
import { EDITOR_ENGLISH_COPY } from '../../i18n/editor-copy-inventory.ts';
import { resolveEditorCopyScope } from '../../i18n/editor-copy-scope.ts';

function normalizedLabel(label: string): string {
	return label.replace(/…|\.{3}/gu, '').replace(/\s+/gu, ' ').trim();
}

/** Dynamic entries retain a stable purpose regardless of their user-provided name. */
function stableId(id: string): string {
	if (id.startsWith('recent-project-')) return 'recent-project';
	if (id.startsWith('window-project-')) return 'window-project';
	if (id.startsWith('workspace-') && !MENU_TOOLTIP_COPY[id]) return 'workspace-custom';
	if (id.startsWith('framescaper-external-display-') && id !== 'framescaper-external-display-none') return 'framescaper-external-display-target';
	if (id.startsWith('macro-library:')) return 'macro-library';
	if (id.startsWith('clip-move-preserve-time-')) return 'clip-move-destination';
	if (id.startsWith('track-label-size-')) return 'context-label-size';
	if (id.startsWith('nyquist:') && !MENU_TOOLTIP_COPY[id]) return 'nyquist-extension';
	return id;
}

/** Bind localized menu labels to their independently owned explanation strings. */
export function createMenuTooltipResolver(copy: Readonly<Record<string, unknown>>) {
	const messages = resolveEditorCopyScope('menuTooltips', MENU_TOOLTIP_COPY, copy);
	const byLabel = new Map<string, string>();
	for (const [id, [label]] of Object.entries(MENU_TOOLTIP_DEFINITIONS)) {
		if (!byLabel.has(normalizedLabel(label))) byLabel.set(normalizedLabel(label), id);
	}
	for (const [key, source] of Object.entries(EDITOR_ENGLISH_COPY)) {
		if (key.startsWith('ui.menuTooltips.')) continue;
		const id = byLabel.get(normalizedLabel(source));
		const translated = copy[key];
		if (id && typeof translated === 'string') byLabel.set(normalizedLabel(translated), id);
	}
	return (label: string, id = ''): string | null => {
		const key = Object.hasOwn(messages, stableId(id)) ? stableId(id) : byLabel.get(normalizedLabel(label));
		return key ? messages[key] ?? null : null;
	};
}
