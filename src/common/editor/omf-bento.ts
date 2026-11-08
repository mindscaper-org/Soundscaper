/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bento 1/2 container syntax, independent of the OMF object model. */
const MAGIC = Uint8Array.of(0xa4, 0x43, 0x4d, 0xa5, 0x48, 0x64, 0x72, 0xd7);
const MAX_ENTRIES = 500_000;
const MAX_VALUE_BYTES = 256 * 1024 * 1024;
const decoder = new TextDecoder();

interface Entry { object: number; property: number; type: number; bytes: Uint8Array; referenceList?: number }
export interface OmfBentoProperty {
	readonly object: number;
	readonly property: string;
	readonly type: string;
	readonly bytes: Uint8Array;
	readonly references?: readonly number[];
}
export interface OmfBentoFile {
	readonly littleEndian: boolean;
	readonly dataLittleEndian: boolean;
	readonly objects: readonly number[];
	value: (object: number, property: string) => Uint8Array | undefined;
	text: (object: number, property: string) => string;
	integer: (object: number, property: string, fallback?: number) => number;
	refs: (object: number, property: string, array?: boolean) => readonly number[];
}

export function readOmfBento(bytes: Uint8Array): OmfBentoFile {
	const label = bytes.length - 24;
	if (label < 0 || !MAGIC.every((byte, index) => bytes[label + index] === byte)) throw new TypeError('Invalid OMF Bento label.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const little = bytes[label + 8] === 1 && bytes[label + 9] === 1;
	const u16 = (offset: number) => view.getUint16(offset, little);
	const u32 = (offset: number) => view.getUint32(offset, little);
	const version = u16(label + 12);
	if (version !== 1 && version !== 2) throw new TypeError('Unsupported Bento container version.');
	const start = u32(label + 16), length = u32(label + 20), end = start + length;
	const block = u16(label + 10) * 1024;
	if (start > label || end > label || (version === 2 && block < 1024)) throw new RangeError('OMF Bento TOC is outside the container.');
	const entries: Entry[] = [];
	const continuedParts = new Map<Entry, { chunks: Uint8Array[]; length: number }>();
	let position = start, object = 0, property = 0, type = 0, referenceList: number | undefined;
	let continued = false;
	function take(size: number): number {
		if (position + size > end) throw new RangeError('Truncated OMF Bento TOC record.');
		const offset = position;
		position += size;
		return offset;
	}
	function segment(value: Uint8Array, next: boolean): void {
		const previous = entries.at(-1);
		if (continued && previous && previous.object === object && previous.property === property && previous.type === type) {
			const parts = continuedParts.get(previous) ?? { chunks: [previous.bytes], length: previous.bytes.length };
			if (parts.length + value.length > MAX_VALUE_BYTES) throw new RangeError('OMF Bento value exceeds its limit.');
			parts.chunks.push(value); parts.length += value.length; continuedParts.set(previous, parts);
		} else {
			if (!object || !property || !type || entries.length >= MAX_ENTRIES) throw new RangeError('Invalid or excessive OMF Bento TOC entries.');
			entries.push({ object, property, type, bytes: value, referenceList });
		}
		continued = next;
	}
	function external(offset: number, size: number, next: boolean): void {
		const limit = object === 1 && (property === 4 || property === 5) ? bytes.length : MAX_VALUE_BYTES;
		if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || size > limit || offset + size > bytes.length) throw new RangeError('OMF Bento value is outside the container or exceeds its limit.');
		segment(bytes.subarray(offset, offset + size), next);
	}
	while (position < end) {
		if (version === 1) {
			const p = take(24), flags = u16(p + 22);
			object = u32(p); property = u32(p + 4); type = u32(p + 8); referenceList = undefined;
			if (flags & 1) segment(bytes.subarray(p + 12, p + 12 + Math.min(4, u32(p + 16))), Boolean(flags & 2));
			else external(u32(p + 12), u32(p + 16), Boolean(flags & 2));
			continue;
		}
		const code = bytes[take(1)];
		if (code === 255) continue;
		if (code === 24) { position = Math.min(end, start + Math.ceil((position - start) / block) * block); continue; }
		if (code === 1) { const p = take(12); object = u32(p); property = u32(p + 4); type = u32(p + 8); referenceList = undefined; }
		else if (code === 2) { const p = take(8); property = u32(p); type = u32(p + 4); referenceList = undefined; }
		else if (code === 3) { type = u32(take(4)); referenceList = undefined; }
		else if (code === 4) take(4);
		else if (code === 15) referenceList = u32(take(4));
		else if (code === 5 || code === 6) { const p = take(8); external(u32(p), u32(p + 4), code === 6); }
		else if (code === 7 || code === 8 || code === 25 || code === 26) {
			const p = take(code >= 25 ? 16 : 12);
			// Bento stores 64-bit quantities as high/low 32-bit words in container byte order.
			const offset = u32(p) * 0x1_0000_0000 + u32(p + 4);
			const size = code >= 25 ? u32(p + 8) * 0x1_0000_0000 + u32(p + 12) : u32(p + 8);
			external(offset, size, code === 8 || code === 26);
		} else if (code === 9) segment(new Uint8Array(), false);
		else if (code !== undefined && code >= 10 && code <= 14) { const p = take(4); segment(bytes.subarray(p, p + Math.min(4, code - 9)), code === 14); }
		else throw new TypeError(`Unsupported OMF Bento TOC code ${String(code)}.`);
	}
	if (continued) throw new TypeError('Unterminated OMF Bento continued value.');
	for (const [entry, parts] of continuedParts) entry.bytes = join(parts.chunks);
	const names = new Map<string, number>();
	for (const entry of entries) if (entry.property === 23 || entry.property === 24) names.set(decodeText(entry.bytes), entry.object);
	const indexed = new Map(entries.map((entry) => [`${entry.object}:${entry.property}`, entry]));
	const objectIds = new Set(entries.map((entry) => entry.object));
	const lookup = (id: number, name: string) => indexed.get(`${id}:${names.get(name) ?? -1}`);
	const byteOrder = lookup(1, 'OMFI:HEAD:ByteOrder')?.bytes;
	const dataLittle = byteOrder ? byteOrder[0] === 0x49 && byteOrder[1] === 0x49 : little;
	const integer = (data: Uint8Array): number => {
		if (![1, 2, 4, 8].includes(data.length)) throw new TypeError('Invalid OMF integer width.');
		const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
		const n = data.length === 8 ? Number(v.getBigInt64(0, dataLittle)) : data.length === 4 ? v.getInt32(0, dataLittle) : data.length === 2 ? v.getInt16(0, dataLittle) : data[0] ?? 0;
		if (!Number.isSafeInteger(n)) throw new RangeError('OMF integer exceeds the safe range.');
		return n;
	};
	return {
		littleEndian: little,
		dataLittleEndian: dataLittle,
		objects: [...objectIds],
		value: (id, name) => lookup(id, name)?.bytes,
		text: (id, name) => decodeText(lookup(id, name)?.bytes ?? new Uint8Array()),
		integer: (id, name, fallback = 0) => { const data = lookup(id, name)?.bytes; return data ? integer(data) : fallback; },
		refs: (id, name, array = false) => {
			const entry = lookup(id, name);
			if (!entry) return [];
			const data = entry.bytes, offset = array ? 2 : 0;
			if (data.length < offset || (data.length - offset) % 4 !== 0) throw new TypeError('Invalid OMF object reference array.');
			const mapping = entry.referenceList ? indexed.get(`${entry.referenceList}:31`)?.bytes : undefined;
			const references = new Map<number, number>();
			if (mapping) {
				if (mapping.length % 8 !== 0) throw new TypeError('Invalid Bento reference recording object.');
				const m = new DataView(mapping.buffer, mapping.byteOffset, mapping.byteLength);
				for (let p = 0; p < mapping.length; p += 8) references.set(m.getUint32(p, little), m.getUint32(p + 4, little));
			}
			const values = new DataView(data.buffer, data.byteOffset, data.byteLength), result: number[] = [];
			for (let p = offset; p < data.length; p += 4) {
				const key = values.getUint32(p, little), target = entry.referenceList ? references.get(key) : key;
				if (!target || !objectIds.has(target)) throw new ReferenceError('Undefined OMF object reference.');
				result.push(target);
			}
			return result;
		},
	};
}

export function omfUint(value: number, width = 4): Uint8Array {
	const data = new Uint8Array(width), view = new DataView(data.buffer);
	if (width === 8) view.setBigInt64(0, BigInt(value), true);
	else if (width === 2) view.setUint16(0, value, true);
	else view.setUint32(0, value, true);
	return data;
}

export function writeOmfBento(properties: readonly OmfBentoProperty[]): Uint8Array {
	if (properties.length > MAX_ENTRIES) throw new RangeError('OMF Bento property count exceeds its limit.');
	const records: Entry[] = [], dictionary = new Map<string, number>();
	let seed = properties.reduce((next, entry) => Math.max(next, entry.object + 1), 65_536);
	function nameId(name: string, kind: 23 | 24): number {
		const key = `${kind}:${name}`, known = dictionary.get(key);
		if (known !== undefined) return known;
		const id = seed++; dictionary.set(key, id);
		records.push({ object: id, property: kind, type: 21, bytes: new TextEncoder().encode(`${name}\0`) });
		return id;
	}
	for (const entry of properties) {
		const property = nameId(entry.property, 24), type = nameId(entry.type, 23);
		const references = entry.references?.length ? [...new Set(entry.references)] : null;
		const referenceList = references ? seed++ : undefined;
		if (references && referenceList) records.push({ object: referenceList, property: 31, type: 32,
			bytes: join(references.flatMap((id) => [omfUint(id), omfUint(id)])) });
		records.push({ object: entry.object, property, type, bytes: entry.bytes, referenceList });
	}
	records.push(...[2, 3, 4, 5, 6].map((property) => ({ object: 1, property, type: 19,
		bytes: property === 2 ? omfUint(seed) : property === 3 ? omfUint(65_536) : new Uint8Array(property === 4 || property === 5 ? 8 : 4) })));
	records.sort((a, b) => a.object - b.object || a.property - b.property);
	const bodies: Uint8Array[] = [], positions = new Map<Entry, number>();
	let bodyLength = 0;
	for (const record of records) if (record.bytes.length > 4 && !(record.object === 1 && (record.property === 4 || record.property === 5))) { positions.set(record, bodyLength); bodies.push(record.bytes); bodyLength += record.bytes.length; }
	function toc(tocLength = 0): Uint8Array {
		const chunks: Uint8Array[] = []; let size = 0;
		for (const record of records) {
			const entry = join([Uint8Array.of(1), omfUint(record.object), omfUint(record.property), omfUint(record.type), Uint8Array.of(4), omfUint(1),
				...(record.referenceList ? [Uint8Array.of(15), omfUint(record.referenceList)] : []),
				...(record.object === 1 && (record.property === 4 || record.property === 5)
					? [Uint8Array.of(5), omfUint(record.property === 4 ? bodyLength : 0), omfUint(record.property === 4 ? tocLength : bodyLength + tocLength + 24)]
					: record.bytes.length === 0 ? [Uint8Array.of(9)] : record.bytes.length <= 4 ? [Uint8Array.of(9 + record.bytes.length), padded(record.bytes)] : [Uint8Array.of(5), omfUint(positions.get(record) ?? 0), omfUint(record.bytes.length)])]);
			const remainder = 65_536 - size % 65_536;
			if (entry.length > remainder) { const pad = new Uint8Array(remainder).fill(255); pad[0] = 24; chunks.push(pad); size += remainder; }
			chunks.push(entry); size += entry.length;
		}
		return join(chunks);
	}
	const contents = toc(toc().length);
	return join([...bodies, contents, MAGIC, omfUint(0x0101, 2), omfUint(64, 2), omfUint(2, 2), omfUint(0, 2), omfUint(bodyLength), omfUint(contents.length)]);
}

function padded(bytes: Uint8Array): Uint8Array { const result = new Uint8Array(4); result.set(bytes); return result; }
function decodeText(bytes: Uint8Array): string { return decoder.decode(bytes).replace(/\0.*$/su, ''); }
function join(chunks: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
	let offset = 0;
	for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
	return result;
}
