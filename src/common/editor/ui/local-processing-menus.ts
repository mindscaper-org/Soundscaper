/* SPDX-License-Identifier: AGPL-3.0-only */
import { mergeCorridorKeyMenu } from './corridorkey-menu.ts';
import { LOCAL_ASSISTANCE_MENU_ICON, mergeAssistanceTaskMenus, type AssistanceDialogRequest, type AssistanceMenuEntry } from './assistance-task-catalog.ts';

export interface NativePreferenceEntry extends AssistanceMenuEntry {
	readonly section: 'audio' | 'media' | 'effects' | 'advanced';
}
interface NativePreferenceMenu extends AssistanceMenuEntry {
	readonly nativePreferences?: readonly NativePreferenceEntry[];
}
export function organizeNativePreferences(
	menus: readonly NativePreferenceMenu[], desktopServicesLabel = 'Desktop services',
): NativePreferenceMenu[] {
	const sectionFor = (id: string): NativePreferenceEntry['section'] | null => {
		if (id === 'parallel-stack-processing') return 'advanced';
		if (id === 'native-audio' || id.includes('audio-helper')) return 'audio';
		if (id === 'framescaper-native-media-preferences' || id.includes('probe-helper')) return 'media';
		if (id === 'desktop-discover-native-effects') return 'effects';
		return null;
	};
	return menus.map((menu) => {
		if (menu.id !== 'tools') return menu;
		const preferences = new Map((menu.nativePreferences ?? []).map(entry => [entry.id, entry]));
		const items: AssistanceMenuEntry[] = [];
		const services: AssistanceMenuEntry[] = [];
		let servicesMenu: AssistanceMenuEntry | undefined;
		for (const item of menu.items ?? []) {
			const desktopServices = item.id === 'desktop-services';
			if (desktopServices) servicesMenu = item;
			const candidates = desktopServices ? item.items ?? [] : [item];
			for (const candidate of candidates) {
				const section = sectionFor(candidate.id ?? '');
				if (section) preferences.set(candidate.id, { ...candidate, section });
				else if (desktopServices || candidate.id === 'blender-start-live-sync'
					|| candidate.id === 'blender-stop-live-sync') services.push(candidate);
				else items.push(candidate);
			}
		}
		if (services.length) items.push({ ...servicesMenu, id: 'desktop-services',
			label: servicesMenu?.label ?? desktopServicesLabel, items: services });
		return { ...menu, items, nativePreferences: [...preferences.values()] };
	});
}

/** Apply local-processing destinations before shortcut annotation and product filtering. */
export function prepareLocalProcessingMenus(menus: readonly AssistanceMenuEntry[], input: {
	readonly productId: string;
	readonly locale: string;
	readonly copy: Readonly<Record<string, string | undefined>>;
	readonly capabilities: { readonly assistanceAssets?: boolean };
	readonly editBlocked?: boolean;
	readonly snapshot: { readonly preferences?: { readonly effects?: { readonly menuOrganization?: string } } };
	readonly actions: {
		readonly openLocalAssistance?: (request: AssistanceDialogRequest) => unknown;
		readonly openTextToSpeech?: () => unknown;
		readonly openCorridorKey?: () => unknown;
	};
}): AssistanceMenuEntry[] {
	const available = input.capabilities.assistanceAssets === true;
	const assistanceMenus = mergeAssistanceTaskMenus(menus, {
		productId: input.productId, copy: input.copy, locale: input.locale,
		organization: input.snapshot.preferences?.effects?.menuOrganization,
		available: available && typeof input.actions.openLocalAssistance === 'function',
		open: (request) => input.actions.openLocalAssistance?.(request),
	});
	const textToSpeechMenus = available && typeof input.actions.openTextToSpeech === 'function'
		? assistanceMenus.map((menu) => menu.id === 'generate' ? {
			...menu, items: [...(menu.items ?? []), {
				id: 'text-to-speech', label: input.copy['ui.textToSpeech.title'] || 'Text to Speech',
				icon: LOCAL_ASSISTANCE_MENU_ICON,
				assistanceTask: true,
				disabled: input.editBlocked === true, onClick: input.actions.openTextToSpeech,
			}],
		} : menu)
		: assistanceMenus;
	return organizeNativePreferences(mergeCorridorKeyMenu(textToSpeechMenus, {
		productId: input.productId, copy: input.copy, open: available ? input.actions.openCorridorKey : undefined,
	}), input.copy.desktopServices);
}
