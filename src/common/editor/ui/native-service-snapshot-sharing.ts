/* SPDX-License-Identifier: AGPL-3.0-only */

/** Structural sharing is applied only after a complete native-service response has been normalized. */
export function shareNativeServiceSnapshot<Value>(previous: Value | null, next: Value): Value {
	return share(previous, next) as Value;
}

function share(previous: unknown, next: unknown): unknown {
	if (Object.is(previous, next)) return previous;
	if (Array.isArray(next)) {
		const prior: readonly unknown[] = Array.isArray(previous) ? previous : [];
		const result = next.map((value: unknown, index) => share(prior[index], value));
		return Array.isArray(previous) && prior.length === result.length && result.every((value, index) => value === prior[index])
			? previous : Object.freeze(result);
	}
	if (next !== null && typeof next === 'object') {
		const current = next as Readonly<Record<string, unknown>>;
		const prior = previous !== null && typeof previous === 'object' && !Array.isArray(previous)
			? previous as Readonly<Record<string, unknown>> : null;
		const keys = Object.keys(current);
		const entries = keys.map(key => [key, share(prior?.[key], current[key])] as const);
		return prior !== null && Object.keys(prior).length === keys.length
			&& entries.every(([key, value]) => Object.hasOwn(prior, key) && prior[key] === value)
			? previous : Object.freeze(Object.fromEntries(entries));
	}
	return next;
}
