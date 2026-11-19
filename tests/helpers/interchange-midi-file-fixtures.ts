/* SPDX-License-Identifier: AGPL-3.0-only */

import { AafObjectWriter, AafWriteObject } from '../../src/common/editor/aaf-object-writer.ts';
import { aafUnhex } from '../../src/common/editor/aaf-object-table.ts';

/** Literal SMF type 1, 480 PPQ; tempo changes from 120 to 60 at one quarter note. */
export function exchangeMidiBytes(): Uint8Array<ArrayBuffer> {
	const name = (text: string) => [0, 255, 3, text.length, ...new TextEncoder().encode(text)];
	const tracks = [
		[0, 255, 81, 3, 7, 161, 32, 0, 176, 7, 100, 0x83, 0x60, 255, 81, 3, 15, 66, 64, 0x8b, 0x20, 255, 47, 0],
		[...name('Melody'), 0, 192, 12, 0x83, 0x60, 144, 64, 100, 0x83, 0x60, 128, 64, 32, 0x87, 0x40, 255, 47, 0],
		[...name('Bass'), 0, 193, 33, 0, 145, 48, 90, 0x83, 0x60, 129, 48, 24, 0x8b, 0x20, 255, 47, 0],
	];
	return Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 1, 0, 3, 1, 224,
		...tracks.flatMap(bytes => [77, 84, 114, 107, 0, 0, bytes.length >> 8, bytes.length & 255, ...bytes])]);
}

/** Independent object graph for AS-01 §9.2, without relying on our AAF exporter. */
export function midiAttachmentAaf(options: Readonly<{ embedded?: boolean; mime?: string; offset?: number; duplicate?: boolean }> = {}): Uint8Array<ArrayBuffer> {
	const writer = new AafObjectWriter(), composition = writer.mob(0x35, 'MIDI exchange');
	const auxiliary = (object: AafWriteObject) => {
		const definition = new Uint8Array(writer.component(0x11, 0).properties.get(0x0201)!.data);
		definition.set(aafUnhex('0302030100010000060e2b3404010105'), 5);
		object.raw(0x0201, definition, 0x02); return object;
	};
	const source = writer.mob(0x37, 'Score.mid'), descriptor = new AafWriteObject(0x4e);
	descriptor.text(0x4e11, options.mime ?? 'audio/midi');
	const locator = new AafWriteObject(0x32); locator.text(0x4001, 'MIDI/Score.mid'); descriptor.refs(0x2f01, [locator]);
	source.ref(0x4701, descriptor);
	const staticSlot = (segment: AafWriteObject, id: number) => {
		const slot = new AafWriteObject(0x3a); slot.int(0x4801, id, 4); slot.ref(0x4803, segment); return slot;
	};
	source.refs(0x4403, [staticSlot(auxiliary(writer.sourceClip(0)), 1)]);
	const reference = () => auxiliary(writer.sourceClip(0, source, options.offset ?? 0));
	composition.refs(0x4403, [staticSlot(reference(), 1), ...(options.duplicate ? [staticSlot(reference(), 2)] : [])]);
	writer.content.refs(0x1901, [source, composition], 0x4401);
	if (options.embedded !== false) {
		const essence = new AafWriteObject(0x23); essence.raw(0x2701, source.properties.get(0x4401)!.data); essence.stream(0x2702, exchangeMidiBytes());
		writer.content.refs(0x1902, [essence], 0x2701);
	}
	return new Uint8Array(writer.finish());
}

export function midiReferenceOtio(path = 'Score.mid', kind = 'Audio') {
	const time = (value: number) => ({ value, rate: 48000 });
	return JSON.stringify({ OTIO_SCHEMA: 'Timeline.1', name: 'MIDI exchange', tracks: { OTIO_SCHEMA: 'Stack.1', children: [
		{ OTIO_SCHEMA: 'Track.1', name: 'Score', kind, children: [
			{ OTIO_SCHEMA: 'Gap.1', source_range: { start_time: time(0), duration: time(48000) } },
			{ OTIO_SCHEMA: 'Clip.2', name: 'Phrase', source_range: { start_time: time(24000), duration: time(48000) },
				media_reference: { OTIO_SCHEMA: 'ExternalReference.1', target_url: path } },
		] },
	] } });
}
