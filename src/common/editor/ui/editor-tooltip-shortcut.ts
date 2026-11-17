/* SPDX-License-Identifier: AGPL-3.0-only */

import { localizedAudacityParityLabel } from '../../i18n/action-parity.js';
import { audacityActionDefinition, resolveAudacityActionId } from '../audacity-action-parity.js';
import { transportShortcutDisplayActionId } from '../transport-shortcut-display.ts';

export interface TooltipShortcutMenu {
	readonly id?: string;
	readonly label?: string;
	readonly shortcut?: string;
	readonly items?: readonly TooltipShortcutMenu[];
}
export type TooltipShortcutResolver = (label: string, id?: string, target?: Element) => string;

const ACTION_ATTRIBUTES = ['data-action-id', 'data-editor-action', 'data-transport', 'data-edit'] as const;
const ACTION_SELECTOR = ACTION_ATTRIBUTES.map(attribute => `[${attribute}]`).join(', ');
const TOOLBAR_ACTIONS: Readonly<Record<string, string>> = {
	jumpStart: 'action://playback/rewind-start', jumpEnd: 'action://playback/rewind-end',
	spectrogramView: 'action://trackedit/global-view-spectrogram', clipGain: 'volume-automation',
};
const SCOPE = '[role="menu"], [role="dialog"], [role="alertdialog"]';
const localizedLabel = localizedAudacityParityLabel as (label: string, copy: unknown) => string;
const canonicalId = (id: string): string => transportShortcutDisplayActionId(resolveAudacityActionId(id === 'play' ? 'action://playback/play' : id));
const normalizedLabel = (label: string): string => label.trim().replace(/(?:…|\.{3})$/u, '').replace(/\s+/gu, ' ');

/** Index current assignments once; labels are a fallback for controls without command metadata. */
export function createEditorTooltipShortcutResolver(
	menus: readonly TooltipShortcutMenu[] = [],
	shortcuts: Readonly<Record<string, readonly string[]>> = {},
	copy: Readonly<Record<string, unknown>> = {},
): TooltipShortcutResolver {
	const bindings = new Map<string, string>();
	const labels = new Map<string, Set<string>>();
	const addLabel = (label: string, id: string): void => {
		const key = normalizedLabel(label);
		if (!key) return;
		const candidates = labels.get(key) ?? new Set<string>();
		candidates.add(id);
		labels.set(key, candidates);
	};
	for (const [id, keys] of Object.entries(shortcuts)) {
		const canonical = canonicalId(id);
		// Pause displays Play's keys even if an old profile still contains a separate pause entry.
		if (transportShortcutDisplayActionId(resolveAudacityActionId(id)) !== resolveAudacityActionId(id)) continue;
		bindings.set(canonical, keys.join(', '));
		const definition = audacityActionDefinition(id);
		if (definition) addLabel(localizedLabel(definition.label, copy), canonical);
	}
	const visit = (items: readonly TooltipShortcutMenu[]): void => {
		for (const item of items) {
			if (item.items?.length) { visit(item.items); continue; }
			if (!item.id) continue;
			const id = canonicalId(item.id);
			if (!bindings.has(id)) bindings.set(id, item.shortcut ?? '');
			if (item.label) addLabel(item.label, id);
		}
	};
	visit(menus);
	return (label, id = '', target) => {
		const local = target?.getAttribute('aria-keyshortcuts')?.trim();
		if (local) return local;
		const marker = target?.closest(ACTION_SELECTOR);
		if (!id && marker && marker.closest(SCOPE) === target?.closest(SCOPE)) {
			id = ACTION_ATTRIBUTES.map(attribute => marker.getAttribute(attribute)).find(Boolean) ?? '';
			if (marker.getAttribute('data-transport') === 'record'
				&& [copy.pauseRecording, copy.resumeRecording].includes(label)) id = 'action://record/pause';
			if (marker.getAttribute('data-transport') === 'record' && label === copy.stopRecording) id = 'action://record/stop';
			return bindings.get(canonicalId(id)) ?? '';
		}
		if (!id && target?.closest('[data-editor-tool-toolbar]')) {
			const command = Object.entries(TOOLBAR_ACTIONS).find(([key]) => copy[key] === label)?.[1];
			if (command) return bindings.get(command) ?? '';
		}
		if (!id && target?.closest('[data-track-row]') && target.closest('.track-control-panel')) {
			if (label === copy.mute) return bindings.get('track-mute') ?? '';
			if (label === copy.solo) return bindings.get('track-solo') ?? '';
			if (label === copy.effects) return bindings.get('add-realtime-effects') ?? '';
		}
		if (id) {
			const canonical = canonicalId(id);
			if (bindings.has(canonical) || audacityActionDefinition(id)) return bindings.get(canonical) ?? '';
		}
		const candidates = labels.get(normalizedLabel(label));
		return candidates?.size === 1 ? bindings.get([...candidates][0]!) ?? '' : '';
	};
}
