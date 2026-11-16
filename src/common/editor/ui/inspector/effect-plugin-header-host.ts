/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo, useSyncExternalStore } from 'react';
import type { AudioEditorAdvancedPreferences } from '../../advanced-preferences.ts';
import type { PluginPresetLibrary } from '../../controller/effects/plugin-preset-session.ts';

interface HeaderSnapshot {
	readonly project?: { readonly id?: string } | null;
	readonly preferences?: { readonly advanced?: AudioEditorAdvancedPreferences };
}
export interface EffectPluginHeaderHost {
	getSnapshot(): HeaderSnapshot;
	subscribe(listener: () => void): () => void;
	readonly actions: {
		readonly effects: { readonly presets: PluginPresetLibrary };
		readonly preferences: { update(patch: { readonly advanced: Partial<AudioEditorAdvancedPreferences> }): PromiseLike<unknown> | unknown };
	};
}

const EMPTY: HeaderSnapshot = Object.freeze({});
const noSubscription = (): (() => void) => () => undefined;
const emptySnapshot = (): HeaderSnapshot => EMPTY;

/** Native menu windows also run in a separate React root and subscribe to the same controller. */
export function useEffectPluginHeaderHost(value: unknown) {
	const host = resolveHost(value);
	const ports = useMemo(() => host ? {
		subscribe: (listener: () => void) => host.subscribe(listener),
		snapshot: () => host.getSnapshot(),
	} : { subscribe: noSubscription, snapshot: emptySnapshot }, [host]);
	return { host, snapshot: useSyncExternalStore(ports.subscribe, ports.snapshot, ports.snapshot) };
}

function resolveHost(value: unknown): EffectPluginHeaderHost | null {
	if (!value || typeof value !== 'object') return null;
	const host = value as Partial<EffectPluginHeaderHost>;
	return typeof host.subscribe === 'function' && typeof host.getSnapshot === 'function'
		&& typeof host.actions?.preferences?.update === 'function'
		&& typeof host.actions.effects?.presets?.save === 'function' ? host as EffectPluginHeaderHost : null;
}
