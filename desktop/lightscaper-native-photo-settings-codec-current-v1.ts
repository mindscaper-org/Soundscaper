/* SPDX-License-Identifier: AGPL-3.0-only */

import { Blob, File } from 'node:buffer';
import { createHash, timingSafeEqual } from 'node:crypto';
import { types } from 'node:util';
import { Serializer, Deserializer } from 'node:v8';
import {
	captureLightscaperNativePhotoSettingGraphCurrentV1,
	restoreLightscaperNativePhotoSettingGraphCurrentV1,
} from './lightscaper-native-photo-settings-graph-current-v1.ts';

const CLONE = globalThis.structuredClone;
const BLOB_BYTES = Blob.prototype.arrayBuffer;
const MAGIC = new TextEncoder().encode('LSSET001');
const HEADER_BYTES = 48;
const WRITE_HEADER = Serializer.prototype.writeHeader;
const WRITE_VALUE = Serializer.prototype.writeValue;
const RELEASE_BUFFER = Serializer.prototype.releaseBuffer;
const READ_HEADER = Deserializer.prototype.readHeader;
const READ_VALUE = Deserializer.prototype.readValue;
const READ_RAW = Deserializer.prototype.readRawBytes;

type HostWire = readonly [object, 'blob' | 'file', string, number, string | null, number | null, Uint8Array];

/** Snapshot before the first await. Blob reads are sequential and fully joined;
 * the owner registers and drains this promise before it retires SQLite. */
export async function captureLightscaperNativePhotoSettingCurrentV1(value: unknown): Promise<Uint8Array> {
	const snapshot: unknown = CLONE(value);
	const graph = captureLightscaperNativePhotoSettingGraphCurrentV1(snapshot);
	const hosts: HostWire[] = [];
	try {
		for (const host of graph.hosts) {
			const body: unknown = await Reflect.apply(BLOB_BYTES, host.blob, []);
			if (!types.isArrayBuffer(body)) throw invalid();
			const bytes = new Uint8Array(body);
			if (bytes.byteLength !== host.size) { bytes.fill(0); throw invalid(); }
			hosts.push([host.placeholder, host.kind, host.type, host.size, host.name, host.lastModified, bytes]);
		}
		const serializer = new Serializer(); Reflect.apply(WRITE_HEADER, serializer, []);
		if (!Reflect.apply(WRITE_VALUE, serializer, [[1, graph.value, hosts]])) throw invalid();
		const payload = Reflect.apply(RELEASE_BUFFER, serializer, []) as Buffer;
		try {
			const bytes = new Uint8Array(HEADER_BYTES + payload.byteLength);
			bytes.set(MAGIC); new DataView(bytes.buffer).setBigUint64(8, BigInt(payload.byteLength), true);
			bytes.set(createHash('sha256').update(payload).digest(), 16); bytes.set(payload, HEADER_BYTES);
			return bytes;
		} finally { payload.fill(0); }
	} finally {
		for (const host of hosts) host[6].fill(0);
	}
}

/** Decode one complete private format. Payload digests detect corruption and
 * never replace the separate owning canonicalKeyValueComparison CAS grammar. */
export function decodeLightscaperNativePhotoSettingCurrentV1(bytes: Uint8Array): unknown {
	if (!types.isUint8Array(bytes) || types.isSharedArrayBuffer(bytes.buffer) || bytes.byteLength < HEADER_BYTES) throw invalid();
	for (let index = 0; index < MAGIC.length; index += 1) if (bytes[index] !== MAGIC[index]) throw invalid();
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getBigUint64(8, true) !== BigInt(bytes.byteLength - HEADER_BYTES)) throw invalid();
	const payload = new Uint8Array(bytes.subarray(HEADER_BYTES));
	if (!timingSafeEqual(createHash('sha256').update(payload).digest(), bytes.subarray(16, HEADER_BYTES))) throw invalid();
	try {
		const deserializer = new Deserializer(payload);
		if (!Reflect.apply(READ_HEADER, deserializer, [])) throw invalid();
		const wire: unknown = Reflect.apply(READ_VALUE, deserializer, []);
		let trailing = false;
		try { Reflect.apply(READ_RAW, deserializer, [1]); trailing = true; } catch { /* Native EOF is required. */ }
		if (trailing) throw invalid();
		const tuple = readTuple(wire, 3);
		if (tuple[0] !== 1 || !Array.isArray(tuple[2])) throw invalid();
		const hosts = new Map<object, Blob>();
		for (const entry of tuple[2] as unknown[]) {
			const host = readTuple(entry, 7);
			const placeholder = host[0];
			if (!isPlaceholder(placeholder) || hosts.has(placeholder)) throw invalid();
			const kind = host[1]; const type = host[2]; const size = host[3]; const name = host[4]; const lastModified = host[5]; const body = host[6];
			if ((kind !== 'blob' && kind !== 'file') || typeof type !== 'string' || !Number.isSafeInteger(size)
				|| (size as number) < 0 || !types.isUint8Array(body) || types.isSharedArrayBuffer(body.buffer) || body.byteLength !== size) throw invalid();
			const bodyPart = new Uint8Array(body);
			let blob: Blob;
			if (kind === 'blob') {
				if (name !== null || lastModified !== null) throw invalid();
				blob = new Blob([bodyPart], { type });
			} else {
				if (typeof name !== 'string' || typeof lastModified !== 'number' || !Number.isFinite(lastModified)) throw invalid();
				const file = new File([bodyPart], name, { type, lastModified });
				if (file.name !== name || !Object.is(file.lastModified, lastModified)) throw invalid();
				blob = file;
			}
			if (blob.size !== size || blob.type !== type) throw invalid();
			hosts.set(placeholder, blob);
		}
		const graph = restoreLightscaperNativePhotoSettingGraphCurrentV1(tuple[1], hosts);
		return CLONE(graph);
	} finally { payload.fill(0); }
}

function readTuple(value: unknown, length: number): readonly unknown[] {
	if (!Array.isArray(value) || value.length !== length || Object.keys(value).length !== length) throw invalid();
	for (let index = 0; index < length; index += 1) if (!Object.hasOwn(value, index)) throw invalid();
	return value as unknown[];
}

function isPlaceholder(value: unknown): value is object {
	return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === 0;
}

function invalid(): TypeError { return new TypeError('Invalid native Photo setting payload.'); }
