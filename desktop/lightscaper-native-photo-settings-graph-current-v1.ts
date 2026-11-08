/* SPDX-License-Identifier: AGPL-3.0-only */

import { Blob, File } from 'node:buffer';
import { types } from 'node:util';

type Host = Readonly<{
	placeholder: object; blob: Blob; kind: 'blob' | 'file'; type: string;
	size: number; name: string | null; lastModified: number | null;
}>;

const BLOB_SIZE = nativeGetter(Blob.prototype, 'size');
const BLOB_TYPE = nativeGetter(Blob.prototype, 'type');
const FILE_NAME = nativeGetter(File.prototype, 'name');
const FILE_MODIFIED = nativeGetter(File.prototype, 'lastModified');
const MAP_ENTRIES = Map.prototype.entries;
const MAP_CLEAR = Map.prototype.clear;
const MAP_SET = Map.prototype.set;
const SET_VALUES = Set.prototype.values;
const SET_CLEAR = Set.prototype.clear;
const SET_ADD = Set.prototype.add;

/** Only owned native-clone or deserialized graphs reach this private helper. */
export function captureLightscaperNativePhotoSettingGraphCurrentV1(value: unknown): Readonly<{
	value: unknown; hosts: readonly Host[];
}> {
	const hosts: Host[] = [];
	const graph = transform(value, new Map(), (blob) => {
		const size: unknown = Reflect.apply(BLOB_SIZE, blob, []);
		const type: unknown = Reflect.apply(BLOB_TYPE, blob, []);
		if (!Number.isSafeInteger(size) || (size as number) < 0 || typeof type !== 'string') throw invalidHost();
		const file = blob instanceof File;
		const name: unknown = file ? Reflect.apply(FILE_NAME, blob, []) : null;
		const lastModified: unknown = file ? Reflect.apply(FILE_MODIFIED, blob, []) : null;
		if (file && (typeof name !== 'string' || typeof lastModified !== 'number' || !Number.isFinite(lastModified))) throw invalidHost();
		const placeholder = {};
		hosts.push({ placeholder, blob, kind: file ? 'file' : 'blob', type, size: size as number,
			name: name as string | null, lastModified: lastModified as number | null });
		return placeholder;
	});
	return { value: graph, hosts };
}

export function restoreLightscaperNativePhotoSettingGraphCurrentV1(value: unknown, hosts: Map<object, Blob>): unknown {
	const used = new Set<object>();
	const graph = transform(value, hosts, undefined, used);
	if (used.size !== hosts.size) throw invalidHost();
	return graph;
}

function transform(
	value: unknown, replacements: Map<object, object>, captureBlob?: (blob: Blob) => object, used?: Set<object>,
): unknown {
	const pending: object[] = [];
	const seen = new Set<object>();
	const visit = (entry: unknown): unknown => {
		if (entry === null || typeof entry !== 'object') return entry;
		if (replacements.has(entry)) { used?.add(entry); return replacements.get(entry); }
		if (types.isSharedArrayBuffer(entry) || (ArrayBuffer.isView(entry) && types.isSharedArrayBuffer(entry.buffer))) {
			throw new TypeError('Shared setting memory cannot be captured as an immutable native value.');
		}
		if (entry instanceof Blob) {
			if (!captureBlob) throw invalidHost();
			const placeholder = captureBlob(entry); replacements.set(entry, placeholder); return placeholder;
		}
		if (seen.has(entry)) return entry;
		seen.add(entry);
		if (entry instanceof ArrayBuffer || ArrayBuffer.isView(entry) || types.isDate(entry)
			|| types.isRegExp(entry) || types.isBoxedPrimitive(entry)) return entry;
		if (!Array.isArray(entry) && !types.isMap(entry) && !types.isSet(entry) && !types.isNativeError(entry)) {
			const prototype: unknown = Object.getPrototypeOf(entry);
			if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Unsupported native setting host object.');
		}
		pending.push(entry); return entry;
	};
	const root = visit(value);
	while (pending.length > 0) {
		const object = pending.pop();
		if (object === undefined) throw invalidHost();
		if (types.isMap(object)) {
			const entries = Array.from(Reflect.apply(MAP_ENTRIES, object, []) as MapIterator<[unknown, unknown]>);
			Reflect.apply(MAP_CLEAR, object, []);
			for (const [key, entry] of entries) Reflect.apply(MAP_SET, object, [visit(key), visit(entry)]);
		} else if (types.isSet(object)) {
			const entries = Array.from(Reflect.apply(SET_VALUES, object, []) as SetIterator<unknown>);
			Reflect.apply(SET_CLEAR, object, []);
			for (const entry of entries) Reflect.apply(SET_ADD, object, [visit(entry)]);
		} else {
			for (const key of Reflect.ownKeys(object)) {
				const descriptor = Object.getOwnPropertyDescriptor(object, key);
				if (descriptor && 'value' in descriptor) {
					Object.defineProperty(object, key, { ...descriptor, value: visit(descriptor.value) });
				}
			}
		}
	}
	return root;
}

function nativeGetter(prototype: object, key: string): (this: unknown) => unknown {
	const getter = Object.getOwnPropertyDescriptor(prototype, key)?.get;
	if (typeof getter !== 'function') throw new Error('Native setting host metadata is unavailable.');
	return getter;
}

function invalidHost(): TypeError { return new TypeError('Invalid native setting host record.'); }
