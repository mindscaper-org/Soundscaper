/* SPDX-License-Identifier: AGPL-3.0-only */

const PLANS = new WeakSet<object>(), SETTINGS = new WeakSet<object>();

export function captureOwnedExportPlan<Value extends object>(value: Value): Value {
	const captured = capture(value);
	if (captured) PLANS.add(captured);
	return captured ?? value;
}
export function captureOwnedExportSettings<Value extends object>(value: Value): Value {
	const captured = capture(value);
	if (captured) SETTINGS.add(captured);
	return captured ?? value;
}
export function ownsImmutableExportRenderInputs(plan: object, settings: object): boolean {
	return PLANS.has(plan) && SETTINGS.has(settings);
}

/** Detach only plain inert data; opaque injected inputs retain their original structural fences. */
function capture<Value extends object>(value: Value): Value | null {
	const pending: unknown[] = [value], seen = new Set<object>();
	while (pending.length) {
		const item = pending.pop();
		if (item === null || ['undefined', 'string', 'number', 'boolean'].includes(typeof item)) continue;
		if (typeof item !== 'object') return null;
		if (seen.has(item)) continue;
		seen.add(item);
		const prototype = Object.getPrototypeOf(item) as unknown;
		if (prototype !== Object.prototype && prototype !== null && !(Array.isArray(item) && prototype === Array.prototype)) return null;
		for (const key of Reflect.ownKeys(item)) {
			if (typeof key !== 'string') return null;
			const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
			if (!Object.hasOwn(descriptor, 'value') || (!descriptor.enumerable && !(Array.isArray(item) && key === 'length'))) return null;
			pending.push(descriptor.value as unknown);
		}
	}
	const copied = structuredClone(value);
	pending.push(copied); seen.clear();
	while (pending.length) {
		const item = pending.pop();
		if (!item || typeof item !== 'object' || seen.has(item)) continue;
		seen.add(item); for (const child of Object.values(item)) pending.push(child); Object.freeze(item);
	}
	return copied;
}
