/* SPDX-License-Identifier: AGPL-3.0-only */

/** Native document identities are data even when they name object prototypes. */
export function setCommandIdentity<Value>(map: Record<string, Value>, id: string, value: Value): Value {
	Object.defineProperty(map, id, { value, enumerable: true, configurable: true, writable: true });
	return value;
}

export function commandIdentity<Value>(map: Readonly<Record<string, Value>> | null | undefined, id: string): Value | undefined {
	return map && Object.hasOwn(map, id) ? map[id] : undefined;
}
