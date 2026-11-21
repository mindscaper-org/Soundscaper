/* SPDX-License-Identifier: AGPL-3.0-only */

import { definePublishedBinaryProperty } from '../../../../published-project-binary.ts';

/** Detach plain snapshot data from recursive read-only state proxies. */
export function materializeSnapshotValue<Value>(
	value: Value,
	seen = new WeakMap<object, object>(),
	strict = false,
): Value {
	if (value === null || typeof value !== 'object') return value;
	const existing = seen.get(value);
	if (existing) return existing as Value;
	if (Array.isArray(value)) {
		const copy: unknown[] = [];
		seen.set(value, copy);
		for (const [index, entry] of value.entries()) defineSnapshotProperty(copy, String(index), entry, seen, strict);
		return Object.freeze(copy) as Value;
	}
	if (value instanceof Map) {
		const copy = new Map<unknown, unknown>();
		seen.set(value, copy);
		for (const [key, entry] of value) {
			copy.set(materializeSnapshotValue(key, seen, strict), materializeSnapshotValue(entry, seen, strict));
		}
		Object.defineProperties(copy, {
			set: { value: rejectSnapshotMutation },
			delete: { value: rejectSnapshotMutation },
			clear: { value: rejectSnapshotMutation },
		});
		return Object.freeze(copy) as Value;
	}
	if (value instanceof Set) {
		const copy = new Set<unknown>();
		seen.set(value, copy);
		for (const entry of value) copy.add(materializeSnapshotValue(entry, seen, strict));
		Object.defineProperties(copy, {
			add: { value: rejectSnapshotMutation },
			delete: { value: rejectSnapshotMutation },
			clear: { value: rejectSnapshotMutation },
		});
		return Object.freeze(copy) as Value;
	}
	const prototype = Object.getPrototypeOf(value) as object | null;
	if (prototype !== null && prototype !== Object.prototype) {
		if (strict) throw new TypeError('A published document contains a mutable non-plain value.');
		return value;
	}
	const copy = Object.create(prototype) as Record<string, unknown>;
	seen.set(value, copy);
	for (const key of Object.keys(value)) {
		defineSnapshotProperty(copy, key, (value as Record<string, unknown>)[key], seen, strict);
	}
	return Object.freeze(copy) as Value;
}

function defineSnapshotProperty(
	target: object, key: string, value: unknown, seen: WeakMap<object, object>, strict: boolean,
): void {
	if (strict && ((value instanceof Uint8Array && Object.getPrototypeOf(value) === Uint8Array.prototype)
		|| (value instanceof ArrayBuffer && Object.getPrototypeOf(value) === ArrayBuffer.prototype))) {
		definePublishedBinaryProperty(target, key, value);
		return;
	}
	Object.defineProperty(target, key, {
		value: materializeSnapshotValue(value, seen, strict),
		enumerable: true, configurable: true, writable: true,
	});
}

function rejectSnapshotMutation(): never {
	throw new TypeError('Published snapshot collections are read-only.');
}
