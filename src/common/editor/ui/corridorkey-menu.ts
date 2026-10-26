/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AssistanceMenuEntry } from './assistance-task-catalog.ts';

/** Keep the tool in the existing video-effects submenu, including while models are unavailable. */
export function mergeCorridorKeyMenu(menus: readonly AssistanceMenuEntry[], options: Readonly<{
	productId: string; open?: () => unknown; copy: Readonly<Record<string, string | undefined>>;
}>): AssistanceMenuEntry[] {
	if (options.productId !== 'framescaper' || !options.open) return [...menus];
	const entry: AssistanceMenuEntry = { id: 'corridorkey-2.0', label: 'CorridorKey 2.0',
		assistanceTask: true, onClick: options.open };
	return menus.map((menu) => {
		if (menu.id !== 'effect') return menu;
		const items = [...(menu.items ?? [])];
		const index = items.findIndex(({ id }) => id === 'framescaper-video-effects');
		if (index < 0) items.push({ id: 'framescaper-video-effects', label: options.copy.videoEffects || 'Video effects', items: [entry] });
		else items[index] = { ...items[index], disabled: false, disabledReason: '', items: [...(items[index]?.items ?? []), entry] };
		return { ...menu, items };
	});
}
