/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzlibSync } from 'fflate';
import seed from './aaf/standard-dictionary.json' with { type: 'json' };
import { type CompoundEntry } from './aaf-compound-reader.ts';
import { writeAafCompound } from './aaf-compound-writer.ts';
import { AafObjectTable, aafInteger, aafPropertyStream, aafUnhex, aafUtf16, type AafProperty } from './aaf-object-table.ts';

export class AafWriteObject {
	readonly properties = new Map<number, AafProperty>();
	readonly children: { name: string; object?: AafWriteObject; data?: Uint8Array }[] = [];
	constructor(readonly classCode: number) {}
	raw(pid: number, data: Uint8Array, format = 0x82): void { this.properties.set(pid, { data, format }); }
	text(pid: number, text: string): void { this.raw(pid, aafUtf16(text)); }
	int(pid: number, value: number, width = 8): void { this.raw(pid, aafInteger(value, width)); }
	rate(pid: number, num: number, den = 1): void {
		if (num < 1 || den < 1 || num > 0x7fff_ffff || den > 0x7fff_ffff) throw new RangeError('Invalid AAF rational rate.');
		const data = new Uint8Array(8); data.set(aafInteger(num, 4)); data.set(aafInteger(den, 4), 4); this.raw(pid, data);
	}
	ref(pid: number, target: AafWriteObject): void {
		const name = `p${pid.toString(16)}`; this.raw(pid, aafUtf16(name), 0x22); this.children.push({ name, object: target });
	}
	refs(pid: number, objects: readonly AafWriteObject[], keyPid?: number): void {
		const name = `p${pid.toString(16)}`, keySize = keyPid ? objects[0]?.properties.get(keyPid)?.data.length ?? 32 : 0;
		if (objects.length > 100_000 || keyPid && ![16, 32].includes(keySize)) throw new RangeError('Invalid AAF collection.');
		const start = keyPid ? 15 : 12, stride = keyPid ? 8 + keySize : 4, bytes = new Uint8Array(start + objects.length * stride), view = new DataView(bytes.buffer);
		view.setUint32(0, objects.length, true); view.setUint32(4, objects.length, true); view.setUint32(8, 0xffff_ffff, true);
		if (keyPid) { view.setUint16(12, keyPid, true); bytes[14] = keySize; }
		objects.forEach((object, i) => {
			view.setUint32(start + i * stride, i, true);
			if (keyPid) {
				const key = object.properties.get(keyPid)?.data;
				if (key?.length !== keySize) throw new TypeError('Invalid AAF set identity.');
				view.setUint32(start + i * stride + 4, 1, true); bytes.set(key, start + i * stride + 8);
			}
			this.children.push({ name: `${name}{${i.toString(16)}}`, object });
		});
		this.raw(pid, aafUtf16(name), keyPid ? 0x3a : 0x32); this.children.push({ name: `${name} index`, data: bytes });
	}
	stream(pid: number, data: Uint8Array): void {
		const name = `p${pid.toString(16)}`, text = aafUtf16(name), value = new Uint8Array(text.length + 1); value[0] = 0x55; value.set(text, 1);
		this.raw(pid, value, 0x42); this.children.push({ name, data });
	}
}

export class AafObjectWriter {
	private readonly entries: CompoundEntry[];
	readonly content = new AafWriteObject(0x18);
	private readonly contentPath: string;
	constructor() {
		const compressed = Uint8Array.from(atob(seed.data), character => character.charCodeAt(0));
		const serialized = JSON.parse(strFromU8(unzlibSync(compressed))) as [string, string, string | null][];
		const entries: CompoundEntry[] = serialized.map(([path, cls, data]) => ({ path, classId: aafUnhex(cls), ...(data !== null ? { data: Uint8Array.from(atob(data), c => c.charCodeAt(0)) } : {}) }));
		const table = new AafObjectTable(entries), header = table.ref(table.object('/'), 2)!;
		const identification = table.refs(header, 0x3b06)[0]!;
		const changed = new Map([[header.path, new Map(header.properties)], [identification.path, new Map(identification.properties)]]);
		changed.get(header.path)!.set(0x3b02, { format: 0x82, data: timestamp() });
		changed.get(identification.path)!.set(0x3c06, { format: 0x82, data: timestamp() });
		changed.get(identification.path)!.set(0x3c09, { format: 0x82, data: globalThis.crypto.getRandomValues(new Uint8Array(16)) });
		this.contentPath = table.ref(header, 0x3b03)!.path;
		this.entries = entries.filter(entry => !entry.path.startsWith(`${this.contentPath}/`)).map(entry => {
			const properties = entry.path.endsWith('/properties') ? changed.get(entry.path.slice(0, -11)) : undefined;
			return properties ? { ...entry, data: aafPropertyStream(properties) } : entry;
		});
	}
	component(classCode: number, length: number, timecode = false): AafWriteObject {
		const object = new AafWriteObject(classCode), definition = aafUnhex(seed.soundDefinition);
		if (timecode) definition.set(aafUnhex('0102030100010000060e2b3404010101'), 5);
		object.raw(0x0201, definition, 0x02); object.int(0x0202, length); return object;
	}
	mob(classCode: number, name: string): AafWriteObject {
		const object = new AafWriteObject(classCode), uid = new Uint8Array(32);
		uid.set(aafUnhex('060a2b340101010501010f2013000000')); globalThis.crypto.getRandomValues(uid.subarray(16));
		object.raw(0x4401, uid); object.text(0x4402, name);
		const date = timestamp(); object.raw(0x4404, date); object.raw(0x4405, date); return object;
	}
	sourceClip(length: number, mob?: AafWriteObject, start = 0): AafWriteObject {
		const object = this.component(0x11, length); object.raw(0x1101, mob?.properties.get(0x4401)?.data ?? new Uint8Array(32));
		object.int(0x1102, mob ? 1 : 0, 4); object.int(0x1201, start); return object;
	}
	slot(segment: AafWriteObject, rate: number, id: number, name: string, denominator = 1): AafWriteObject {
		const slot = new AafWriteObject(0x3b); slot.int(0x4801, id, 4); slot.text(0x4802, name); slot.ref(0x4803, segment);
		slot.rate(0x4b01, rate, denominator); slot.int(0x4b02, 0); return slot;
	}
	finish(): Uint8Array {
		const entries = [...this.entries], seen = new Set<AafWriteObject>();
		const emit = (object: AafWriteObject, path: string, existing = false): void => {
			if (seen.has(object) || entries.length > 100_000) throw new TypeError('Shared or excessive AAF strong object graph.');
			seen.add(object);
			if (!existing) entries.push({ path, classId: aafUnhex(`0101010d010100${object.classCode.toString(16).padStart(2, '0')}060e2b3402060101`) });
			entries.push({ path: `${path}/properties`, classId: new Uint8Array(16), data: aafPropertyStream(object.properties) });
			for (const child of object.children) {
				if (child.object) emit(child.object, `${path}/${child.name}`);
				else entries.push({ path: `${path}/${child.name}`, classId: new Uint8Array(16), data: child.data! });
			}
		};
		emit(this.content, this.contentPath, true); return writeAafCompound(entries);
	}
}

function timestamp(): Uint8Array {
	const date = new Date();
	return Uint8Array.of(date.getUTCFullYear() & 255, date.getUTCFullYear() >> 8, date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), Math.floor(date.getUTCMilliseconds() / 4));
}
