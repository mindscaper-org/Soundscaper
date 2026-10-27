/* SPDX-License-Identifier: AGPL-3.0-only */

import { isCanonicalAudioEditorEffectPresets, listAudioEditorEffectPresets } from '../../../effect-presets.js';
import { ownsEffectLibraries } from './owned-effect-library-state.ts';

export function createOwnedEffectPresetCatalog<State extends { readonly effectPresets: unknown }, Preset>(
	state: State, list: (collection: State['effectPresets'], type: string) => Preset[],
): (type: string) => Preset[] {
	let collection: unknown;
	const catalogs = new Map<string, Preset[]>();
	return type => {
		const current = state.effectPresets;
		if (!ownsEffectLibraries(state) || list !== listAudioEditorEffectPresets || !isCanonicalAudioEditorEffectPresets(current)) return list(current, type);
		if (current !== collection) { collection = current; catalogs.clear(); }
		let catalog = catalogs.get(type);
		if (!catalog) {
			catalog = list(current, type);
			if (catalogs.size >= 64) catalogs.clear();
			catalogs.set(type, catalog);
		}
		return detach(catalog);
	};
}

/** Public catalogs retain their existing frozen shapes and detached mutable curve arrays. */
function detach<Value>(value: Value): Value {
	if (value === null || typeof value !== 'object') return value;
	const copy = Array.isArray(value) ? value.map((entry: unknown) => detach(entry))
		: Object.fromEntries(Object.entries(value).map(([key, entry]: [string, unknown]) => [key, detach(entry)]));
	return (Object.isFrozen(value) ? Object.freeze(copy) : copy) as Value;
}
