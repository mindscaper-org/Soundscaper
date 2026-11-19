/* SPDX-License-Identifier: AGPL-3.0-only */

const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const TYPE = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')!.get!;
const NAME = typeof File === 'undefined' ? undefined : Object.getOwnPropertyDescriptor(File.prototype, 'name')!.get!;
const MODIFIED = typeof File === 'undefined' ? undefined : Object.getOwnPropertyDescriptor(File.prototype, 'lastModified')!.get!;
const ENTRIES = Map.prototype.entries, VALUES = Set.prototype.values;
const CLEAR_MAP = Map.prototype.clear, SET = Map.prototype.set, CLEAR_SET = Set.prototype.clear, ADD = Set.prototype.add;
export const DESKTOP_PHOTO_CLONE_LIMITS_CURRENT_V1 = Object.freeze({ maximumBytes: 134_217_728, maximumObjects: 65_536, maximumFields: 131_072 });
export interface DesktopPhotoCloneHostCurrentV1 {
	readonly placeholder: object;
	readonly blob: Blob;
	readonly kind: 'blob' | 'file';
	readonly type: string;
	readonly size: number;
	readonly name: string | null;
	readonly lastModified: number | null;
}

/** Transform only an already owned native structured clone. Cycles, aliases,
 * insertion order, sparse arrays and own undefined survive the wire graph. */
export function transformDesktopPhotoCloneGraphCurrentV1(value: unknown, hosts: Map<object, Blob> | null, initialBytes = 0, measureOnly = false): Readonly<{
	value: unknown; hosts: readonly DesktopPhotoCloneHostCurrentV1[]; byteLength: number;
}> {
	const pending: object[] = [], seen = new Set<object>(), replacements = new Map<object, object>();
	const found: DesktopPhotoCloneHostCurrentV1[] = [], used = new Set<object>();
	let bytes = initialBytes, fields = 0;
	const charge = (count: number): void => {
		bytes += count; if (!Number.isSafeInteger(bytes) || bytes > DESKTOP_PHOTO_CLONE_LIMITS_CURRENT_V1.maximumBytes) throw new RangeError('Desktop Photo clone exceeds its transfer byte capacity.');
	};
	const visit = (entry: unknown): unknown => {
		if (typeof entry === 'string') charge(entry.length * 2);
		if (typeof entry === 'bigint') charge(entry.toString().length * 2);
		if (entry === null || typeof entry !== 'object') return entry;
		if (hosts?.has(entry)) { used.add(entry); return hosts.get(entry); }
		if (replacements.has(entry)) return replacements.get(entry);
		if (seen.has(entry)) return entry;
		seen.add(entry); charge(64);
		if (seen.size > DESKTOP_PHOTO_CLONE_LIMITS_CURRENT_V1.maximumObjects) throw new RangeError('Desktop Photo clone exceeds its object capacity.');
		if (typeof SharedArrayBuffer !== 'undefined' && (entry instanceof SharedArrayBuffer || (ArrayBuffer.isView(entry) && entry.buffer instanceof SharedArrayBuffer))) throw new TypeError('Desktop Photo clone cannot retain shared memory.');
		if (entry instanceof Blob) {
			if (hosts) throw new TypeError('Desktop Photo clone wire cannot contain native Blob hosts.');
			const size = Reflect.apply(SIZE, entry, []) as number, type = Reflect.apply(TYPE, entry, []) as string;
			charge(size);
			const file = typeof File !== 'undefined' && entry instanceof File;
			const name = file ? Reflect.apply(NAME!, entry, []) as string : null;
			const lastModified = file ? Reflect.apply(MODIFIED!, entry, []) as number : null;
			charge(type.length * 2 + (name?.length ?? 0) * 2);
			const placeholder = {}; replacements.set(entry, placeholder);
			found.push({ placeholder, blob: entry, kind: file ? 'file' : 'blob', type, size, name, lastModified }); return placeholder;
		}
		if (entry instanceof ArrayBuffer) { charge(entry.byteLength); return entry; }
		if (ArrayBuffer.isView(entry)) { visit(entry.buffer); return entry; }
		if (entry instanceof Date || entry instanceof RegExp || entry instanceof Number || entry instanceof Boolean || entry instanceof String
			|| Object.getPrototypeOf(entry) === BigInt.prototype) {
			if (entry instanceof String) charge(String.prototype.valueOf.call(entry).length * 2);
			if (entry instanceof RegExp) charge(entry.source.length * 2);
			if (Object.getPrototypeOf(entry) === BigInt.prototype) charge(BigInt.prototype.valueOf.call(entry).toString().length * 2);
			return entry;
		}
		const prototype: unknown = Object.getPrototypeOf(entry);
		if (!Array.isArray(entry) && !(entry instanceof Map) && !(entry instanceof Set) && !(entry instanceof Error) && prototype !== Object.prototype && prototype !== null) throw new TypeError('Unsupported desktop Photo clone host.');
		pending.push(entry); return entry;
	};
	const property = (entry: unknown): unknown => {
		if (++fields > DESKTOP_PHOTO_CLONE_LIMITS_CURRENT_V1.maximumFields) throw new RangeError('Desktop Photo clone exceeds its field capacity.');
		return visit(entry);
	};
	const root = visit(value);
	while (pending.length) {
		const object = pending.pop()!;
		if (object instanceof Map) {
			const entries = [...Reflect.apply(ENTRIES, object, []) as MapIterator<[unknown, unknown]>]; if (!measureOnly) Reflect.apply(CLEAR_MAP, object, []);
			for (const [key, item] of entries) { const left = property(key), right = property(item); if (!measureOnly) Reflect.apply(SET, object, [left, right]); }
		} else if (object instanceof Set) {
			const entries = [...Reflect.apply(VALUES, object, []) as SetIterator<unknown>]; if (!measureOnly) Reflect.apply(CLEAR_SET, object, []);
			for (const item of entries) { const next = property(item); if (!measureOnly) Reflect.apply(ADD, object, [next]); }
		} else {
			for (const key of Reflect.ownKeys(object)) {
				if (typeof key !== 'string') throw new TypeError('Unsupported desktop Photo clone key.');
				charge(key.length * 2); const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
				if (!Object.hasOwn(descriptor, 'value') && object instanceof Error && key === 'stack') {
					// Node's own native Error clone may retain a lazy intrinsic stack
					// accessor. Materialize it on this owned clone before transport.
					const stack = property(object.stack);
					if (!measureOnly) Object.defineProperty(object, key, { configurable: descriptor.configurable, enumerable: descriptor.enumerable,
						writable: true, value: stack }); continue;
				}
				if (!Object.hasOwn(descriptor, 'value')) throw new TypeError('Desktop Photo clone requires captured own data.');
				const next = property(descriptor.value); if (!measureOnly) Object.defineProperty(object, key, { ...descriptor, value: next });
			}
		}
	}
	if (hosts && used.size !== hosts.size) throw new TypeError('Desktop Photo clone contains unused host records.');
	return { value: root, hosts: found, byteLength: bytes };
}
