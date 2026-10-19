/* SPDX-License-Identifier: AGPL-3.0-only */

/** Menu entry points for native effects and analyzers. Audio hosts live in Audio settings. */

import {
	resolveSoundscaperNativeServicesCopy,
	type SoundscaperNativeServicesCopy,
} from './soundscaper-native-services-copy.ts';

export const SOUNDSCAPER_NATIVE_SERVICE_SURFACES = Object.freeze([
	'native-effect-manage',
	'native-effect-use',
	'native-analyzer-use',
] as const);

export type SoundscaperNativeServiceSurface =
	(typeof SOUNDSCAPER_NATIVE_SERVICE_SURFACES)[number];

/** Plugin management stays reachable so the user can enable or repair effects. */
export const SOUNDSCAPER_ALWAYS_REACHABLE_SURFACES: readonly SoundscaperNativeServiceSurface[] =
	Object.freeze(['native-effect-manage']);

export interface SoundscaperNativeServicesMenuItem {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	/** Why the entry is disabled, for the accessible name; empty when enabled. */
	readonly disabledReason: string;
	readonly items?: readonly SoundscaperNativeServicesMenuItem[];
	onClick?(): unknown;
}

export interface SoundscaperNativeServicesMenuItems {
	readonly tools: readonly SoundscaperNativeServicesMenuItem[];
	readonly effect: readonly SoundscaperNativeServicesMenuItem[];
	readonly analyze: readonly SoundscaperNativeServicesMenuItem[];
}

/**
 * What the renderer knows about the native tier. It is deliberately a report of
 * status and never of mechanism: no payload path, no backend library name, no
 * plug-in binary path appears here, because none of those ever cross the
 * preload bridge.
 */
export interface SoundscaperNativeServicesSnapshot {
	readonly enabled: boolean;
	readonly quarantined: boolean;
	readonly payloadAvailable: boolean;
	readonly payloadDetail: string;
	readonly pluginEnabled: boolean;
	readonly pluginQuarantined: boolean;
	readonly pluginPayloadAvailable: boolean;
	readonly pluginPayloadDetail: string;
	readonly usableAudioBackends: readonly string[];
	readonly enabledPluginFormats: readonly string[];
}

export interface SoundscaperNativeServicesMenuInput {
	readonly productId: string;
	readonly runtimeAvailable: boolean;
	readonly snapshot: SoundscaperNativeServicesSnapshot | null;
	readonly editingBlocked?: boolean;
	readonly readOnly?: boolean;
	readonly analyzerRuntimeAvailable?: boolean;
	readonly analyzerSelectionAvailable?: boolean;
	readonly copy?: Readonly<Record<string, string | undefined>>;
}

export interface SoundscaperNativeServicesMenuActions {
	open(surface: SoundscaperNativeServiceSurface): unknown;
}

const EMPTY: SoundscaperNativeServicesMenuItems = Object.freeze({
	tools: Object.freeze([]),
	effect: Object.freeze([]),
	analyze: Object.freeze([]),
});

export function createSoundscaperNativeServicesMenuItems(
	input: SoundscaperNativeServicesMenuInput,
	actions: SoundscaperNativeServicesMenuActions,
): SoundscaperNativeServicesMenuItems {
	// A build with no native runtime at all — the browser editor — gets no
	// native entries whatsoever rather than a menu full of permanently grey
	// rows advertising a tier that product cannot have.
	if (input.productId !== 'soundscaper' || !input.runtimeAvailable || input.snapshot === null) return EMPTY;
	const copy = resolveSoundscaperNativeServicesCopy(input.copy);
	const snapshot = input.snapshot;
	const pluginReason = pluginUnavailableReason(copy, snapshot);

	const use = entry({
		id: 'native-effect-use', label: copy.audioPluginEffects,
		disabledReason: pluginReason
			?? (input.editingBlocked === true || input.readOnly === true ? copy.projectReadOnly : null)
			?? (snapshot.enabledPluginFormats.length === 0 ? copy.pluginFormatsBlocked : null),
		open: actions.open,
	});
	const manage = entry({
		id: 'native-effect-manage',
		label: copy.pluginManage,
		disabledReason: null,
		open: actions.open,
	});
	const analyzer = entry({
		id: 'native-analyzer-use',
		label: copy.vampAnalyzers,
		disabledReason: pluginReason
			?? (input.editingBlocked === true || input.readOnly === true ? copy.projectReadOnly : null)
			?? (snapshot.enabledPluginFormats.includes('vamp')
				? null : copy.vampFormatBlocked)
			?? (input.analyzerRuntimeAvailable === false
				? copy.vampRuntimeUnavailable : null)
			?? (input.analyzerSelectionAvailable === true
				? null : input.copy?.timeSelectionRequired ?? 'Select a time range or clip first.'),
		open: actions.open,
	});

	return Object.freeze({
		tools: Object.freeze([]),
		effect: Object.freeze([
			manage, use,
		]),
		analyze: Object.freeze([analyzer]),
	});
}

function pluginUnavailableReason(
	copy: SoundscaperNativeServicesCopy,
	snapshot: SoundscaperNativeServicesSnapshot,
): string | null {
	if (snapshot.pluginQuarantined) return copy.pluginHelperQuarantined;
	if (!snapshot.pluginPayloadAvailable) return snapshot.pluginPayloadDetail || copy.pluginRuntimeUnavailable;
	if (!snapshot.pluginEnabled) return copy.discoveryDisabled;
	return null;
}

function entry({ id, label, disabledReason, open }: Readonly<{
	id: SoundscaperNativeServiceSurface;
	label: string;
	disabledReason: string | null;
	open: (surface: SoundscaperNativeServiceSurface) => unknown;
}>): SoundscaperNativeServicesMenuItem {
	const disabled = disabledReason !== null;
	return Object.freeze({
		id,
		label,
		disabled,
		disabledReason: disabled ? disabledReason : '',
		...(disabled ? {} : { onClick: () => open(id) }),
	});
}
