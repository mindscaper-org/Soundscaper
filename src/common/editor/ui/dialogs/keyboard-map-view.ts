/* SPDX-License-Identifier: AGPL-3.0-only */
import { KEYBOARD_MAP_ROWS, type KeyboardMapBinding } from './keyboard-map-model.ts';

interface KeyBindings {
	readonly states: Map<string, KeyboardMapBinding[]>;
	readonly contexts: Map<string, KeyboardMapBinding[]>;
}
const EMPTY_BINDINGS: readonly KeyboardMapBinding[] = Object.freeze([]);
const MAXIMUM_INDEXED_BINDINGS = 16_384;

/** One current visible projection; excess inventories retain the direct predicates. */
export function createKeyboardMapBindingView(bindings: readonly KeyboardMapBinding[]) {
	if (bindings.length > MAXIMUM_INDEXED_BINDINGS) return {
		at: (key: string, state: string) => bindings.filter(binding => binding.key === key && binding.state === state),
		has: (key: string) => bindings.some(binding => binding.key === key),
		inContext: (key: string, context: string) => bindings.filter(binding => binding.key === key && binding.context === context),
	};
	const keys = new Map<string, KeyBindings>();
	for (const binding of bindings) {
		const key = binding.key;
		let entry = keys.get(key);
		if (!entry) { entry = { states: new Map(), contexts: new Map() }; keys.set(key, entry); }
		append(entry.states, binding.state, binding);
		append(entry.contexts, binding.context, binding);
	}
	return {
		at: (key: string, state: string): readonly KeyboardMapBinding[] => keys.get(key)?.states.get(state) ?? EMPTY_BINDINGS,
		has: (key: string) => keys.has(key),
		inContext: (key: string, context: string): readonly KeyboardMapBinding[] => keys.get(key)?.contexts.get(context) ?? EMPTY_BINDINGS,
	};
}
function append(map: Map<string, KeyboardMapBinding[]>, key: string, binding: KeyboardMapBinding) {
	const entries = map.get(key);
	if (entries) entries.push(binding);
	else map.set(key, [binding]);
}
export function keyboardMapViewRows(bindings: readonly KeyboardMapBinding[]) {
	const layoutKeys = new Set(KEYBOARD_MAP_ROWS.flat());
	const extra = [...new Set(bindings.map(binding => binding.key))].filter(key => !layoutKeys.has(key));
	return extra.length ? [...KEYBOARD_MAP_ROWS, extra] : KEYBOARD_MAP_ROWS;
}
