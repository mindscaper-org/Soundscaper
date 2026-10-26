/* SPDX-License-Identifier: AGPL-3.0-only */

/** A temporary first-match projection of dense immutable data identities. */
export function frozenRecordIdIndex<Item extends { readonly id: string }>(value: readonly Item[]): ReadonlyMap<string, Item> | null {
	if (!Object.isFrozen(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| ['find', 'filter', 'some', 'constructor', Symbol.iterator].some(key => Object.hasOwn(value, key))) return null;
	const index = new Map<string, Item>();
	for (let slot = 0; slot < value.length; slot++) {
		const entry = Object.getOwnPropertyDescriptor(value, String(slot));
		if (!entry || !Object.hasOwn(entry, 'value')) return null;
		const item = entry.value as unknown;
		if (!item || typeof item !== 'object' || !Object.isFrozen(item)) return null;
		const id = Object.getOwnPropertyDescriptor(item, 'id');
		if (!id || !Object.hasOwn(id, 'value') || typeof id.value !== 'string') return null;
		if (!index.has(id.value)) index.set(id.value, item as Item);
	}
	return index;
}

/** Check publication replacement without invoking a newly installed getter. */
export function hasOwnDataValue(value: object, key: string, expected: unknown): boolean {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return Boolean(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.value === expected);
}
