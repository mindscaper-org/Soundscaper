/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CompoundEntry } from './aaf-compound-reader.ts';
import type { Rational } from './timeline-time.ts';

export interface AafProperty { readonly format: number; readonly data: Uint8Array }
export interface AafObject { readonly path: string; readonly classCode: number; readonly properties: ReadonlyMap<number, AafProperty> }
export const aafHex = (bytes: Uint8Array): string => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
export function aafUnhex(text: string): Uint8Array { return Uint8Array.from(text.match(/../gu) ?? [], value => Number.parseInt(value, 16)); }
export function aafText(bytes: Uint8Array): string {
	if (bytes.length % 2 || bytes.length < 2 || bytes.at(-1) || bytes.at(-2)) throw new TypeError('Invalid AAF UTF-16 property.');
	return new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(0, -2));
}
export function aafUtf16(text: string): Uint8Array {
	if (text.length > 32_000 || text.includes('\0')) throw new RangeError('AAF text exceeds its property limit.');
	const bytes = new Uint8Array((text.length + 1) * 2), view = new DataView(bytes.buffer);
	for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true);
	return bytes;
}
export function aafInteger(value: number, width = 8): Uint8Array {
	if (!Number.isSafeInteger(value)) throw new RangeError('AAF integer exceeds the exact numeric range.');
	const bytes = new Uint8Array(width), view = new DataView(bytes.buffer);
	if (width === 8) view.setBigInt64(0, BigInt(value), true);
	else if (width === 4 && value >= 0 && value <= 0xffff_ffff) view.setUint32(0, value, true);
	else if (width === 2 && value >= 0 && value <= 0xffff) view.setUint16(0, value, true);
	else if (width === 1 && value >= 0 && value <= 255) view.setUint8(0, value);
	else throw new RangeError('AAF integer exceeds its storage width.');
	return bytes;
}
export function aafPropertyStream(properties: ReadonlyMap<number, AafProperty>): Uint8Array {
	const bytes = new Uint8Array(4 + properties.size * 6 + [...properties.values()].reduce((sum, p) => sum + p.data.length, 0)), view = new DataView(bytes.buffer);
	if (properties.size > 65_535) throw new RangeError('Excessive AAF property count.');
	bytes[0] = 0x4c; bytes[1] = 0x20; view.setUint16(2, properties.size, true);
	let index = 4, offset = 4 + properties.size * 6;
	for (const [pid, property] of properties) {
		if (property.data.length > 65_535) throw new RangeError('AAF property exceeds its storage width.');
		view.setUint16(index, pid, true); view.setUint16(index + 2, property.format, true); view.setUint16(index + 4, property.data.length, true);
		bytes.set(property.data, offset); index += 6; offset += property.data.length;
	}
	return bytes;
}

export class AafObjectTable {
	private readonly entries: ReadonlyMap<string, CompoundEntry>;
	private readonly objects = new Map<string, AafObject>();
	constructor(entries: readonly CompoundEntry[]) { this.entries = new Map(entries.map(entry => [entry.path, entry])); }
	stream(path: string): Uint8Array {
		const data = this.entries.get(path)?.data;
		if (!data) throw new ReferenceError(`Missing AAF stream ${path}.`);
		return data;
	}
	object(path: string): AafObject {
		const cached = this.objects.get(path); if (cached) return cached;
		const entry = this.entries.get(path);
		if (!entry || entry.data) throw new ReferenceError(`Missing AAF object ${path}.`);
		const bytes = this.stream(`${path === '/' ? '' : path}/properties`), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		if (bytes.length < 4 || bytes[0] !== 0x4c || bytes[1] !== 0x20) throw new TypeError('Unsupported AAF property stream encoding.');
		const count = view.getUint16(2, true), properties = new Map<number, AafProperty>();
		let offset = 4 + count * 6;
		if (offset > bytes.length) throw new RangeError('Truncated AAF property index.');
		for (let i = 0; i < count; i++) {
			const pos = 4 + i * 6, pid = view.getUint16(pos, true), format = view.getUint16(pos + 2, true), size = view.getUint16(pos + 4, true);
			if (offset + size > bytes.length || properties.has(pid)) throw new TypeError('Truncated or duplicate AAF property.');
			properties.set(pid, { format, data: bytes.subarray(offset, offset + size) }); offset += size;
		}
		if (offset !== bytes.length) throw new TypeError('Unexpected data after AAF properties.');
		const standard = aafHex(entry.classId).startsWith('0101010d010100');
		const object = { path, classCode: standard ? entry.classId[7]! : -1, properties };
		this.objects.set(path, object); return object;
	}
	text(object: AafObject, pid: number): string { const p = object.properties.get(pid); return p ? aafText(p.data) : ''; }
	integer(object: AafObject, pid: number, fallback = 0): number {
		const p = object.properties.get(pid); if (!p) return fallback;
		const v = new DataView(p.data.buffer, p.data.byteOffset, p.data.length);
		const value = p.data.length === 8 ? Number(v.getBigInt64(0, true)) : p.data.length === 4 ? v.getUint32(0, true) : p.data.length === 2 ? v.getUint16(0, true) : p.data.length === 1 ? v.getUint8(0) : NaN;
		if (!Number.isSafeInteger(value)) throw new RangeError('Invalid or excessive AAF integer property.');
		return value;
	}
	rate(object: AafObject, pid: number): Rational {
		const p = object.properties.get(pid);
		if (p?.data.length !== 8) throw new TypeError('AAF edit rate requires an exact rational.');
		const v = new DataView(p.data.buffer, p.data.byteOffset, p.data.length), num = v.getInt32(0, true), den = v.getInt32(4, true);
		if (num <= 0 || den <= 0) throw new RangeError('AAF edit rate must be positive.');
		return { num, den };
	}
	ref(object: AafObject, pid: number): AafObject | undefined {
		const p = object.properties.get(pid); if (!p) return undefined;
		if (p.format !== 0x22) throw new TypeError('Invalid AAF strong reference format.');
		return this.object(this.childPath(object, aafText(p.data)));
	}
	refs(object: AafObject, pid: number): AafObject[] {
		const p = object.properties.get(pid); if (!p) return [];
		if (p.format !== 0x32 && p.format !== 0x3a) throw new TypeError('Invalid AAF reference collection format.');
		const name = aafText(p.data), bytes = this.stream(this.childPath(object, `${name} index`)), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
		if (bytes.length < 12) throw new RangeError('Truncated AAF reference index.');
		const count = view.getUint32(0, true), set = p.format === 0x3a, start = set ? 15 : 12, keySize = set ? bytes[14]! : 0, stride = set ? keySize + 8 : 4;
		if (set && ![16, 32].includes(keySize) || count > 100_000 || start + count * stride !== bytes.length) throw new RangeError('Invalid or excessive AAF reference index.');
		const keys = new Set<number>();
		return Array.from({ length: count }, (_, i) => {
			const key = view.getUint32(start + i * stride, true);
			if (keys.has(key)) throw new TypeError('Duplicate AAF reference index key.');
			keys.add(key); return this.object(this.childPath(object, `${name}{${key.toString(16)}}`));
		});
	}
	dataStream(object: AafObject, pid: number): Uint8Array | undefined {
		const p = object.properties.get(pid); if (!p) return undefined;
		if (p.format !== 0x42 || p.data[0] !== 0x55) throw new TypeError('Unsupported AAF essence stream format.');
		return this.stream(this.childPath(object, aafText(p.data.subarray(1))));
	}
	private childPath(object: AafObject, name: string): string {
		if (!name || /[/\\\0]/u.test(name) || name === '.' || name === '..') throw new TypeError('Invalid AAF storage reference.');
		return `${object.path === '/' ? '' : object.path}/${name}`;
	}
}
