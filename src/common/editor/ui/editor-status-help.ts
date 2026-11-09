/* SPDX-License-Identifier: AGPL-3.0-only */

import { formatLocalizedTemplate } from './localization-template.ts';

export interface StatusHelpMenu {
	readonly id: string;
	readonly label?: string;
	readonly shortcut?: string;
	readonly items?: readonly StatusHelpMenu[];
}

const CONTROL = 'button, input, select, textarea, [role="slider"], [role="menuitem"], [role="menuitemcheckbox"], [role="checkbox"], [role="radio"]';
const SURFACES = [
	['[data-clip-fade-handle]', 'statusHelpFade'],
	['[data-clip-trim-handle]', 'statusHelpTrim'],
	['[data-clip-stretch-handle]', 'statusHelpStretch'],
	['.timeline-ruler, [data-musical-map-ruler], [data-sequence-timecode-ruler]', 'statusHelpRuler'],
	['[data-clip-id]', 'statusHelpClip'],
	['.track-control-panel', 'statusHelpTrack'],
] as const;

/** Resolve the actual named control and current menu binding, never a fixed key map. */
export function editorStatusHelp(target: Element | null, root: Element, copy: Readonly<Record<string, string>>, menus: readonly StatusHelpMenu[]): string | null {
	if (!target || !root.contains(target)) return null;
	const edge = target.closest('[data-selection-pointer-edge]')?.getAttribute('data-selection-pointer-edge');
	if (edge === 'start' || edge === 'end') return copy[edge === 'start' ? 'statusHelpSelectionStart' : 'statusHelpSelectionEnd'] ?? null;
	const envelope = target.closest('[data-envelope-hover]')?.getAttribute('data-envelope-hover');
	if (envelope) return copy[envelope === 'point' ? 'statusHelpEnvelopePoint' : 'statusHelpEnvelopeCurve'] ?? null;
	const control = target.closest(CONTROL);
	if (control && root.contains(control)) {
		const label = controlLabel(control);
		if (label) {
			const value = control.getAttribute('aria-valuetext') ?? control.getAttribute('aria-valuenow')
				?? (control.tagName === 'INPUT' && ['range', 'number'].includes(control.getAttribute('type') ?? '') ? (control as HTMLInputElement).value : null);
			if (value) return formatLocalizedTemplate(copy.statusHelpValue ?? '{label}: {value}', { label, value });
			const action = control.closest('[data-action-id], [data-editor-action], [data-transport]');
			const id = action?.getAttribute('data-action-id') ?? action?.getAttribute('data-editor-action') ?? action?.getAttribute('data-transport');
			const menu = findMenu(menus, id, label);
			const shortcut = menu?.shortcut ?? control.getAttribute('aria-keyshortcuts');
			return shortcut ? formatLocalizedTemplate(copy.statusHelpShortcut ?? '{label} ({shortcut})', { label, shortcut }) : label;
		}
	}
	for (const [selector, key] of SURFACES) if (target.closest(selector)) return copy[key] ?? null;
	return null;
}

function controlLabel(control: Element): string {
	const ids = control.getAttribute('aria-labelledby');
	const referenced = ids?.split(/\s+/u).map(id => control.ownerDocument.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
	return referenced || control.getAttribute('aria-label')?.trim() || control.getAttribute('title')?.trim()
		|| (control.tagName === 'BUTTON' || ['menuitem', 'menuitemcheckbox'].includes(control.getAttribute('role') ?? '') ? control.textContent?.replace(/\p{Co}/gu, '').trim() : '') || '';
}

function findMenu(menus: readonly StatusHelpMenu[], id: string | null | undefined, label: string): StatusHelpMenu | undefined {
	for (const menu of menus) {
		if ((id && menu.id === id) || menu.label === label) return menu;
		const child = menu.items && findMenu(menu.items, id, label);
		if (child) return child;
	}
	return undefined;
}

export function statusHelpTransportCue(state: string, rate: number, recording: boolean, copy: Readonly<Record<string, string>>, locale: string): string {
	if (recording) return copy.recording ?? '';
	const label = copy[state === 'playing' ? 'statusHelpPlaying' : state === 'paused' ? 'statusHelpPaused' : 'statusHelpStopped'] ?? '';
	if (!Number.isFinite(rate) || rate <= 0 || Math.abs(rate - 1) < 0.0005) return label;
	return formatLocalizedTemplate(copy.statusHelpSpeed ?? '{state} · {speed}', { state: label,
		speed: new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(rate) });
}
