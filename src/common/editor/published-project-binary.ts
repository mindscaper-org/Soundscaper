/* SPDX-License-Identifier: AGPL-3.0-only */

type ProjectBinary = Uint8Array | ArrayBuffer;
const binaryReaderOwners = new WeakMap<() => unknown, object>();

/** Keep the original binary type without exposing the snapshot's backing bytes. */
export function definePublishedBinaryProperty(target: object, key: string, value: ProjectBinary): void {
	const snapshot = copyBinary(value);
	const read = () => copyBinary(snapshot);
	Object.defineProperty(target, key, { enumerable: true, get: read });
	binaryReaderOwners.set(read, target);
}

/** Read only accessors installed on this exact snapshot object by the publisher. */
export function projectDataPropertyDescriptor(target: object, key: string): PropertyDescriptor | undefined {
	const descriptor = Object.getOwnPropertyDescriptor(target, key);
	const read: (() => unknown) | undefined = descriptor?.get;
	if (!read || binaryReaderOwners.get(read) !== target) return descriptor;
	return { enumerable: true, configurable: false, writable: false, value: read() };
}

function copyBinary(value: ProjectBinary): ProjectBinary {
	return value instanceof Uint8Array ? new Uint8Array(value) : value.slice(0);
}
