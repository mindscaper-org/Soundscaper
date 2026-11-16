/* SPDX-License-Identifier: AGPL-3.0-only */

import { aafHex, type AafObject, type AafObjectTable } from './aaf-object-table.ts';
import { MIDI_FILE_MAX_BYTES } from './midi-file-types.ts';
import { timelineImportIssue, timelineInterchangeMediaName, type TimelineInterchangeDocument,
	type TimelineInterchangeMedia, type TimelineInterchangeTrack } from './timeline-interchange-types.ts';

const AUXILIARY = '0302030100010000060e2b3404010105';
export function isAafAuxiliarySegment(object: AafObject): boolean {
	return aafHex(object.properties.get(0x0201)?.data.subarray(-16) ?? new Uint8Array()) === AUXILIARY;
}

/** AS-01 §9.2: an audio/midi AuxiliaryDescriptor carries a complete, co-timed SMF. */
export function readAafMidiAttachment(file: AafObjectTable, slot: AafObject, mobs: ReadonlyMap<string, AafObject>,
	embedded: ReadonlyMap<string, Uint8Array>, media: Map<string, TimelineInterchangeMedia>,
	attachments: NonNullable<TimelineInterchangeDocument['midiAttachments']>[number][], issues: TimelineInterchangeDocument['issues'][number][]): TimelineInterchangeTrack | null {
	let currentSlot = slot, segment = file.ref(slot, 0x4803);
	const seen = new Set<string>();
	let offset = 0;
	for (let depth = 0; depth < 32; depth++) {
		if (!segment || ![0x10, 0x11].includes(segment.classCode) || !isAafAuxiliarySegment(segment)) return null;
		if (seen.has(segment.path)) throw new RangeError('Cyclic AAF MIDI source reference.');
		seen.add(segment.path);
		offset += file.integer(segment, 0x1201) + file.integer(currentSlot, currentSlot.classCode === 0x39 ? 0x4902 : 0x4b02);
		const sourceId = segment.properties.get(0x1101)?.data;
		if (sourceId?.length !== 32) throw new TypeError('AAF MIDI source MobID must have 32 bytes.');
		const key = aafHex(sourceId), source = mobs.get(key);
		if (!source) return null;
		const target = file.refs(source, 0x4403).find(candidate => file.integer(candidate, 0x4801) === file.integer(segment!, 0x1102));
		if (!target) return null;
		const descriptor = file.ref(source, 0x4701);
		if (!descriptor) { currentSlot = target; segment = file.ref(target, 0x4803); continue; }
		if (descriptor.classCode !== 0x4e || file.text(descriptor, 0x4e11).toLowerCase() !== 'audio/midi') return null;
		const targetSegment = file.ref(target, 0x4803);
		if (!targetSegment || !isAafAuxiliarySegment(targetSegment)) throw new TypeError('AAF MIDI target slot must contain auxiliary data.');
		const name = file.text(source, 0x4402) || file.text(slot, 0x4802) || 'MIDI.mid';
		const track: TimelineInterchangeTrack = { id: `aaf-midi-track-${file.integer(slot, 0x4801)}`, name, kind: 'audio', midi: true, clips: [] };
		if (offset !== 0 || file.integer(target, target.classCode === 0x39 ? 0x4902 : 0x4b02) !== 0) {
			issues.push(timelineImportIssue('aaf', 'midi-offset-omitted', 'An auxiliary MIDI file with a nonzero source offset cannot use the co-timed AAF MIDI profile; its notes are omitted.'));
			return track;
		}
		if (attachments.some(item => item.mediaId === `aaf-midi-${key}`)) {
			issues.push(timelineImportIssue('aaf', 'midi-duplicate-omitted', 'A repeated reference to the same auxiliary MIDI file is imported once.'));
			return null;
		}
		if (attachments.length) throw new RangeError('The AAF edit protocol permits only one MIDI auxiliary file per composition.');
		const bytes = embedded.get(key);
		if (bytes && bytes.length > MIDI_FILE_MAX_BYTES) throw new RangeError('AAF MIDI essence exceeds the 16 MiB MIDI import limit.');
		let path = '';
		for (const locator of file.refs(descriptor, 0x2f01)) {
			path = file.text(locator, locator.classCode === 0x32 ? 0x4001 : 0x4101); if (path) break;
		}
		const id = `aaf-midi-${key}`;
		media.set(id, { id, path, name: timelineInterchangeMediaName(path, name), kind: 'audio', midi: true,
			...(bytes ? { blob: new Blob([new Uint8Array(bytes)], { type: 'audio/midi' }) } : {}) });
		attachments.push({ trackId: track.id, mediaId: id, name });
		return track;
	}
	throw new RangeError('AAF MIDI source traversal exceeds its depth limit.');
}
