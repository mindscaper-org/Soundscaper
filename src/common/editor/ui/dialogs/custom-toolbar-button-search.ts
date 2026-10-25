/* SPDX-License-Identifier: AGPL-3.0-only */
import type { CustomToolbarButtonAction } from '../toolbar/custom-toolbar-button-actions.ts';

const MAXIMUM_PREPARED_ENTRIES = 16_384;
const MAXIMUM_PREPARED_CHARACTERS = 4_194_304;
const NATIVE_FILTER = Array.prototype.filter;
const NATIVE_ITERATOR = Array.prototype[Symbol.iterator];

/** Only current dense frozen inventories own prepared text; untrusted and excess rows stay fresh. */
export function prepareCustomToolbarActionSearch(actions: readonly CustomToolbarButtonAction[]) {
	const text = new Map<CustomToolbarButtonAction, string>();
	let characters = 0;
	if (canonicalArray(actions)) for (let index = 0; index < actions.length; index++) {
		const action = actions[index];
		if (characters >= MAXIMUM_PREPARED_CHARACTERS) break;
		if (!action || typeof action !== 'object' || !Object.isFrozen(action)
			|| !dataField(action, 'actionId') || !dataField(action, 'path')) continue;
		const path = action.path;
		const pathLength = canonicalPathLength(path);
		if (pathLength === null || pathLength + 1 + action.actionId.length > MAXIMUM_PREPARED_CHARACTERS - characters) continue;
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
	if (canonicalArray(symbols)) for (let index = 0; index < symbols.length; index++) {
		const symbol = symbols[index];
		if (characters >= MAXIMUM_PREPARED_CHARACTERS) break;
		if (typeof symbol !== 'string' || symbol.length > MAXIMUM_PREPARED_CHARACTERS - characters) continue;
		const normalized = symbol.replaceAll('_', ' ').toLowerCase();
		if (characters + normalized.length > MAXIMUM_PREPARED_CHARACTERS) continue;
		text.set(symbol, normalized); characters += normalized.length;
	}
	return (query: string) => {
		const needle = query.trim().replaceAll('_', ' ').toLowerCase();
		return symbols.filter(symbol => (text.get(symbol) ?? symbol.replaceAll('_', ' ').toLowerCase()).includes(needle));
	};
}
function canonicalArray(values: readonly unknown[]): boolean {
	if (!Array.isArray(values) || !Object.isFrozen(values) || values.length > MAXIMUM_PREPARED_ENTRIES
		|| Object.getPrototypeOf(values) !== Array.prototype || Object.hasOwn(values, 'filter')
		|| Object.hasOwn(values, Symbol.iterator) || values.filter !== NATIVE_FILTER || values[Symbol.iterator] !== NATIVE_ITERATOR) return false;
	for (let index = 0; index < values.length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(values, index);
		if (!descriptor || !('value' in descriptor)) return false;
	}
	return true;
}
function dataField(owner: object, field: string): boolean {
	const descriptor = Object.getOwnPropertyDescriptor(owner, field);
	return Boolean(descriptor && 'value' in descriptor && (field !== 'actionId' || typeof descriptor.value === 'string'));
}
function canonicalPathLength(path: readonly string[]): number | null {
	if (!Array.isArray(path) || !Object.isFrozen(path) || Object.getPrototypeOf(path) !== Array.prototype
		|| Object.hasOwn(path, Symbol.iterator) || Object.hasOwn(path, 'join')) return null;
	let length = Math.max(0, path.length - 1);
	for (let index = 0; index < path.length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(path, index);
		if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') return null;
		length += descriptor.value.length;
	}
	return length;
}
