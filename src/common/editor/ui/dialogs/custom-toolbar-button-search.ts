/* SPDX-License-Identifier: AGPL-3.0-only */
import type { CustomToolbarButtonAction } from '../toolbar/custom-toolbar-button-actions.ts';

const MAXIMUM_PREPARED_ENTRIES = 16_384;
const MAXIMUM_PREPARED_CHARACTERS = 4_194_304;

/** Only the current frozen action inventory owns prepared text; mutable and excess rows stay fresh. */
export function prepareCustomToolbarActionSearch(actions: readonly CustomToolbarButtonAction[]) {
	const text = new Map<CustomToolbarButtonAction, string>();
	let characters = 0;
	if (Object.isFrozen(actions)) for (const action of actions) {
		if (text.size >= MAXIMUM_PREPARED_ENTRIES || characters >= MAXIMUM_PREPARED_CHARACTERS) break;
		if (!Object.isFrozen(action)) continue;
		const path = action.path;
		if (!Object.isFrozen(path)) continue;
		const normalized = `${path.join(' ')} ${action.actionId}`.toLowerCase();
		if (characters + normalized.length > MAXIMUM_PREPARED_CHARACTERS) continue;
		text.set(action, normalized); characters += normalized.length;
	}
	return (query: string) => {
		const needle = query.trim().toLowerCase();
		return actions.filter(action => (text.get(action) ?? `${action.path.join(' ')} ${action.actionId}`.toLowerCase()).includes(needle));
	};
}
export function prepareCustomToolbarSymbolSearch(symbols: readonly string[]) {
	const text = new Map<string, string>();
	let characters = 0;
	if (Object.isFrozen(symbols)) for (const symbol of symbols) {
		if (text.size >= MAXIMUM_PREPARED_ENTRIES || characters >= MAXIMUM_PREPARED_CHARACTERS) break;
		const normalized = symbol.replaceAll('_', ' ').toLowerCase();
		if (characters + normalized.length > MAXIMUM_PREPARED_CHARACTERS) continue;
		text.set(symbol, normalized); characters += normalized.length;
	}
	return (query: string) => {
		const needle = query.trim().replaceAll('_', ' ').toLowerCase();
		return symbols.filter(symbol => (text.get(symbol) ?? symbol.replaceAll('_', ' ').toLowerCase()).includes(needle));
	};
}
