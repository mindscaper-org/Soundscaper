/* SPDX-License-Identifier: AGPL-3.0-only */

/** No getters or custom array callbacks may mutate the selected identities mid-scan. */
function dataArray(value: unknown): value is readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| ['some', 'filter', 'map', 'includes', 'constructor', Symbol.iterator].some(key => Object.hasOwn(value, key))) return false;
	for (let index = 0; index < value.length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
	}
	return true;
}

function ownData(value: unknown, key: string): PropertyDescriptor | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return key in value ? null : { value: undefined };
	return Object.hasOwn(descriptor, 'value') ? descriptor : null;
}

export function clipSelectionMembership(tracks: readonly unknown[], selected: readonly unknown[]): ReadonlySet<string> | null {
	if (!dataArray(tracks) || !dataArray(selected)) return null;
	for (const track of tracks) {
		const descriptor = ownData(track, 'clipIds');
		if (!descriptor) return null;
		const members = descriptor.value as unknown;
		if (members === undefined || members === null) continue;
		if (!dataArray(members) || members.some(id => typeof id !== 'string')) return null;
	}
	const ids = new Set<string>();
	for (const value of selected) {
		const id = typeof value === 'string' ? value : ownData(value, 'id')?.value as unknown;
		if (typeof id !== 'string') return null;
		ids.add(id);
	}
	return ids;
}
