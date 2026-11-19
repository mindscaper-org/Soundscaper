/* SPDX-License-Identifier: AGPL-3.0-only */

import { omfUint, writeOmfBento, type OmfBentoProperty } from './omf-bento.ts';

/** Standard OMF2 objects and properties; byte order is explicitly little endian. */
export class OmfObjectWriter {
	private nextId = 256;
	private readonly values: OmfBentoProperty[] = [];
	private readonly mobIds = new Map<number, Uint8Array>();
	object(classId: string, id = this.nextId++): number { this.raw(id, 'OOBJ:ObjClass', 'ClassID', new TextEncoder().encode(classId)); return id; }
	raw(id: number, property: string, type: string, bytes: Uint8Array): void {
		this.values.push({ object: id, property: `OMFI:${property}`, type: `omfi:${type}`, bytes });
	}
	text(id: number, property: string, text: string, type = 'String'): void { this.raw(id, property, type, new TextEncoder().encode(`${text}\0`)); }
	int(id: number, property: string, value: number, type = 'Length32', width = 4): void { this.raw(id, property, type, omfUint(value, width)); }
	ref(id: number, property: string, targets: readonly number[], array = false): void {
		const bytes = new Uint8Array((array ? 2 : 0) + targets.length * 4);
		if (array) bytes.set(omfUint(Math.min(targets.length, 65_535), 2));
		targets.forEach((target, index) => bytes.set(omfUint(target), (array ? 2 : 0) + index * 4));
		this.values.push({ object: id, property: `OMFI:${property}`, type: array ? 'omfi:ObjRefArray' : 'omfi:ObjRef', bytes, references: targets });
	}
	rate(id: number, property: string, num: number, den = 1): void {
		const bytes = new Uint8Array(8); bytes.set(omfUint(num)); bytes.set(omfUint(den), 4); this.raw(id, property, 'Rational', bytes);
	}
	uid(id: number, property: string, unique: number): void {
		let bytes = this.mobIds.get(unique);
		if (!bytes) {
			const generated = new Uint8Array(12);
			if (unique !== 0) { generated.set(omfUint(0xffff_ffff)); globalThis.crypto.getRandomValues(generated.subarray(4)); }
			bytes = generated;
			this.mobIds.set(unique, bytes);
		}
		this.raw(id, property, 'UID', bytes);
	}
	mob(classId: string, name: string): number {
		const id = this.object(classId); this.uid(id, 'MOBJ:MobID', id); this.text(id, 'MOBJ:Name', name);
		this.raw(id, 'MOBJ:CreationTime', 'TimeStamp', Uint8Array.of(0, 0, 0, 0, 1));
		this.raw(id, 'MOBJ:LastModified', 'TimeStamp', Uint8Array.of(0, 0, 0, 0, 1)); return id;
	}
	component(classId: string, kind: number, duration: number): number {
		const id = this.object(classId); this.ref(id, 'CPNT:DataKind', [kind]); this.int(id, 'CPNT:Length', duration); return id;
	}
	sourceClip(kind: number, duration: number, mob: number, start = 0): number {
		const id = this.component('SCLP', kind, duration); this.uid(id, 'SCLP:SourceID', mob);
		this.int(id, 'SCLP:SourceTrackID', mob === 0 ? 0 : 1, 'UInt32'); this.int(id, 'SCLP:StartTime', start, 'Position32'); return id;
	}
	slot(segment: number, sampleRate: number, trackId: number, name: string, denominator = 1): number {
		const descriptor = this.object('TRKD'); this.int(descriptor, 'TRKD:TrackID', trackId, 'UInt32');
		this.int(descriptor, 'TRKD:Origin', 0, 'Position32'); this.text(descriptor, 'TRKD:TrackName', name);
		const slot = this.object('MSLT'); this.rate(slot, 'MSLT:EditRate', sampleRate, denominator);
		this.ref(slot, 'MSLT:Segment', [segment]); this.ref(slot, 'MSLT:TrackDesc', [descriptor]); return slot;
	}
	finish(): Uint8Array { return writeOmfBento(this.values); }
}

export function omfWaveSummary(sampleRate: number, channels: number, frameCount: number, sampleFormat = 'float32'): Uint8Array {
	const bytes = new Uint8Array(44), view = new DataView(bytes.buffer), encoder = new TextEncoder();
	const valid = /^(?:int(?:8|16|24|32)|float(?:32|64))$/u.test(sampleFormat) ? sampleFormat : 'float32';
	const bits = Number(valid.match(/\d+$/u)?.[0] ?? 32), alignment = channels * bits / 8;
	bytes.set(encoder.encode('RIFF')); view.setUint32(4, Math.min(0xffff_ffff, 36 + frameCount * alignment), true);
	bytes.set(encoder.encode('WAVEfmt '), 8); view.setUint32(16, 16, true); view.setUint16(20, valid.startsWith('float') ? 3 : 1, true);
	view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * alignment, true);
	view.setUint16(32, alignment, true); view.setUint16(34, bits, true); bytes.set(encoder.encode('data'), 36);
	view.setUint32(40, Math.min(0xffff_ffff, frameCount * alignment), true); return bytes;
}
