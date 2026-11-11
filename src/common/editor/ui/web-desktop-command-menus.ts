/* SPDX-License-Identifier: AGPL-3.0-only */

import { iconNameToChar } from '../audacity-iconcodes.js';
import { mergeAssistanceTaskMenus, type AssistanceMenuEntry } from './assistance-task-catalog.ts';
import { mergeCorridorKeyMenu } from './corridorkey-menu.ts';
import { createFramescaperNativeServicesMenuItems } from './framescaper-native-services-menu.ts';
import { createLocalAssistanceMenuItems } from './local-assistance-menu.ts';
import { createLocalModelManagerMenuItems } from './local-model-manager-menu.ts';
import { resolveSoundscaperNativeServicesCopy } from './soundscaper-native-services-copy.ts';
import { resolveOriginalFileOverwriteCopy } from '../../i18n/editor-original-file-overwrite-copy.ts';
import { resolveBlenderCopy } from '../../i18n/editor-blender-copy.ts';
import { organizeNativePreferences } from './local-processing-menus.ts';

const DESKTOP_COMMAND_ICON = iconNameToChar('DESKTOP_MONITOR');
type Entry = AssistanceMenuEntry;
interface DesktopOffer {
	readonly id?: string;
	readonly label?: string;
	readonly items?: readonly DesktopOffer[];
}
interface WebDesktopCommandOptions {
	readonly productId: string;
	readonly locale: string;
	readonly copy: Readonly<Record<string, string | undefined>>;
	readonly organization?: string;
	readonly onUnavailable: () => unknown;
}

/** Build presentation offers only; no desktop bridge or runtime is created. */
function desktopOffers({ productId, copy, locale, organization, onUnavailable }: WebDesktopCommandOptions): Entry[] {
	const leaf = (id: string, label: string | undefined): Entry => ({ id, label });
	const describe = ({ id, label, items }: DesktopOffer): Entry => ({
		id, label, ...(items ? { items: items.map(describe) } : {}),
	});
	const branch = (id: string, label: string | undefined, items: readonly DesktopOffer[]): Entry => ({
		id, label, items: items.map(describe),
	});
	const native = createFramescaperNativeServicesMenuItems({
		productId, runtimeAvailable: true, snapshot: null, project: null, editingBlocked: true, copy,
	}, { open: onUnavailable, openExternalDisplay: onUnavailable });
	const soundscaper = productId === 'soundscaper';
	const plugins = resolveSoundscaperNativeServicesCopy(copy);
	const blender = resolveBlenderCopy(copy);
	const services = [
		...(soundscaper ? [leaf('blender-start-live-sync', blender.startSync),
			leaf('blender-stop-live-sync', blender.stopSync)] : []),
		leaf('desktop-clear-audio-helper-quarantine', copy.clearAudioHelperQuarantine),
		leaf('desktop-discover-native-effects', copy.discoverNativeEffects),
		...(soundscaper ? [leaf('desktop-mcp-connection', copy['ui.desktopMcp.connection'] || 'MCP connection')] : []),
	];
	const menus: Entry[] = [
		branch('file', copy.fileMenu, [
			leaf('overwrite-original-file', resolveOriginalFileOverwriteCopy(copy).overwriteOriginal),
			...native.fileImport,
			branch('export-other', copy.exportOther, [
				...(soundscaper ? [leaf('blender-export-tracks', blender.exportTracks)] : []),
				...native.fileExport,
			]),
		]),
		branch('edit', copy.editMenu, []),
		branch('view', copy.viewMenu, [
			leaf('desktop-reload', copy.reloadApplication),
			leaf('desktop-toggle-dev-tools', copy.toggleDeveloperTools),
			// Web browsers cannot enumerate desktop displays, so offer the command itself.
			...native.view.map(item => leaf(item.id, item.label)),
		]),
		branch('generate', copy.generateMenu, [leaf('text-to-speech', copy['ui.textToSpeech.title'])]),
		branch('effect', copy.effectMenu, [
			leaf('ara-clip-editor', copy['ui.ara.clipEditor']),
			...(soundscaper ? [leaf('native-effect-manage', plugins.pluginManage)] : []),
			...native.effect,
		]),
		branch('analyze', copy.analyzeMenu, soundscaper ? [leaf('native-analyzer-use', plugins.vampAnalyzers)] : []),
		branch('tools', copy.toolsMenu, [
			...createLocalAssistanceMenuItems({ desktopAvailable: true, capabilityActive: true, copy },
				{ open: onUnavailable, openIndexedSearch: onUnavailable }),
			...createLocalModelManagerMenuItems({ desktopAvailable: true, copy }, { open: onUnavailable }),
			...native.tools,
			branch('desktop-services', copy.desktopServices, services),
		]),
		branch('window', copy.windowMenu, soundscaper ? [] : [leaf('panel-web-vcr', copy.webVcrTitle)]),
		branch('help', copy.helpMenu, [
			leaf('desktop-product-help', copy.productHelp?.replace('{product}', copy.title ?? productId)),
			leaf('desktop-check-updates', copy.checkUpdates),
			leaf('desktop-view-source', copy.viewSource),
		]),
	];
	return mergeCorridorKeyMenu(mergeAssistanceTaskMenus(menus, {
		productId, copy, locale, organization, available: true, open: onUnavailable,
	}), { productId, copy, open: onUnavailable });
}

/** Preserve working web commands while exposing desktop commands in their menu families. */
export function exposeWebDesktopCommands(menus: readonly Entry[], options: WebDesktopCommandOptions): Entry[] {
	const offer = (entry: Entry): Entry => entry.items ? {
		id: entry.id, label: entry.label, disabled: false, disabledReason: '', items: entry.items.map(offer),
	} : {
		id: entry.id, label: entry.label, preserveLabel: true,
		icon: DESKTOP_COMMAND_ICON, disabled: false, onClick: options.onUnavailable,
	};
	const merge = (current: readonly Entry[], additions: readonly Entry[]): Entry[] => {
		const result = [...current];
		for (const addition of additions) {
			// Empty categories carry no offer and must not replace a working command.
			if (addition.items?.length === 0) continue;
			const index = result.findIndex(item => item.id === addition.id);
			const existing = index < 0 ? undefined : result[index];
			const next = existing && addition.items ? {
				...existing, disabled: false, disabledReason: '',
				items: merge(existing.items ?? [], addition.items),
			} : offer(addition);
			if (index < 0) result.push(next);
			else result[index] = next;
		}
		return result;
	};
	const result = merge(menus, desktopOffers(options));
	const order = ['file', 'edit', 'select', 'view', 'tracks', 'generate', 'effect', 'analyze', 'tools', 'window', 'help'];
	return organizeNativePreferences(result.sort((a, b) => order.indexOf(a.id ?? '') - order.indexOf(b.id ?? '')),
		options.copy.desktopServices);
}
