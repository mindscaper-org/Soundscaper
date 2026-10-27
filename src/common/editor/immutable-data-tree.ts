/* SPDX-License-Identifier: AGPL-3.0-only */

/** A snapshot can retain derived facts only while every reachable data property is immutable. */
export function isImmutableDataTree(root: object): boolean {
	const pending: unknown[] = [root], seen = new Set<object>();
	while (pending.length) {
		const value = pending.pop();
		if (typeof value === 'function') return false;
		if (!value || typeof value !== 'object' || seen.has(value)) continue;
		seen.add(value);
		const prototype = Object.getPrototypeOf(value) as unknown;
		if (!Object.isFrozen(value) || (prototype !== Object.prototype && prototype !== null
			&& !(Array.isArray(value) && prototype === Array.prototype))) return false;
		for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
			if (!Object.hasOwn(descriptor, 'value')) return false;
			pending.push(descriptor.value as unknown);
		}
	}
	return true;
}
