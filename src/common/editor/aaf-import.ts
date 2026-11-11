/* SPDX-License-Identifier: AGPL-3.0-only */

import { readAafCompound } from './aaf-compound-reader.ts';
import { AafObjectTable, aafHex, aafText, type AafObject } from './aaf-object-table.ts';
import { aafWaveSummary } from './aaf-wave.ts';
import { addRationals, compareRationals, divideRationals, subtractRationals, type Rational } from './timeline-time.ts';
import { timelineImportIssue, type TimelineInterchangeDocument, type TimelineInterchangeMedia, type TimelineInterchangeTrack, type TimelineInterchangeClip } from './timeline-interchange-types.ts';
import type { DeliveryReportItem } from './delivery-report.ts';

/** Read standard AAF audio compositions. Unsupported components keep their duration as gaps. */
export function parseAafDocument(bytes: Uint8Array): TimelineInterchangeDocument {
	const file = new AafObjectTable(readAafCompound(bytes)), root = file.object('/'), header = file.ref(root, 2), content = header && file.ref(header, 0x3b03);
	if (!header || header.classCode !== 0x2f || !content || content.classCode !== 0x18) throw new TypeError('AAF header or content storage is missing.');
	const mobs = file.refs(content, 0x1901), compositions = mobs.filter(mob => mob.classCode === 0x35), mobByUid = new Map<string, AafObject>();
	const issues: DeliveryReportItem[] = [], media = new Map<string, TimelineInterchangeMedia>();
	const uid = (object: AafObject, pid: number): string => {
		const data = object.properties.get(pid)?.data;
		if (data?.length !== 32) throw new TypeError('AAF MobID must have 32 bytes.');
		return aafHex(data);
	};
	for (const mob of mobs) {
		const key = uid(mob, 0x4401); if (mobByUid.has(key)) throw new TypeError('Duplicate AAF MobID.'); mobByUid.set(key, mob);
	}
	const primary = header.properties.get(0x3b08)?.data;
	const composition = compositions.find(mob => primary && uid(mob, 0x4401) === aafHex(primary.subarray(-32)))
		?? compositions.find(mob => aafHex(mob.properties.get(0x4408)?.data ?? new Uint8Array()) === '0201010d01010007060e2b3404010101') ?? compositions[0];
	if (!composition) throw new TypeError('AAF file contains no composition mob.');
	function issue(code: string, message: string, disposition: DeliveryReportItem['disposition'] = 'omitted', data: Readonly<Record<string, unknown>> = {}): void {
		if (issues.length >= 100_000) throw new RangeError('AAF report exceeds its item limit.');
		issues.push(timelineImportIssue('aaf', code, message, disposition, data));
	}
	if (compositions.length > 1) issue('additional-compositions-omitted', 'Only the primary or first top-level composition is imported.', 'omitted', { compositions: compositions.length });
	const embedded = new Map<string, Uint8Array>();
	for (const essence of file.refs(content, 0x1902)) {
		const data = file.dataStream(essence, 0x2702), key = uid(essence, 0x2701);
		if (embedded.has(key)) throw new TypeError('Duplicate AAF essence MobID.');
		if (data) embedded.set(key, data);
	}
	let visits = 0;
	function visit(depth: number): void { if (++visits > 100_000 || depth > 32) throw new RangeError('AAF composition traversal exceeds its limit.'); }
	const length = (object: AafObject) => nonNegative(file.integer(object, 0x0202), 'component length');
	const slotRate = (slot: AafObject) => file.rate(slot, slot.classCode === 0x39 ? 0x4901 : 0x4b01);
	const kind = (object: AafObject) => aafHex(object.properties.get(0x0201)?.data.subarray(-16) ?? new Uint8Array());
	const soundKinds = new Set(['0202030100020000060e2b3404010101', 'e1ebe178ef6cd211807d006008143e6f']);
	function unprocessed(object: AafObject): AafObject | undefined {
		if (object.classCode === 0x0a) {
			issue('effect-omitted', 'AAF effect processing is omitted; a single input retains its audio cuts.');
			const inputs = file.refs(object, 0x0b02); return inputs.length === 1 ? inputs[0] : undefined;
		}
		if (object.classCode === 0x0e) { issue('alternates-omitted', 'Only the selected AAF alternative is imported.'); return file.ref(object, 0x0f01); }
		return undefined;
	}
	function offline(object: AafObject, rate: Rational, offset: Rational, duration: Rational): { mediaId: string; start: Rational; name: string } {
		const key = uid(object, 0x1101), id = `aaf-offline-${key}-${file.integer(object, 0x1102)}`, start = addRationals(offset, divideRationals(nonNegative(file.integer(object, 0x1201), 'source offset'), rate));
		const name = `Offline audio ${key.slice(-8)}.wav`;
		const extent = addRationals(start, duration), existing = media.get(id);
		if (!existing) {
			media.set(id, { id, path: name, name, kind: 'audio', rate, duration: extent });
			issue('source-chain-missing', 'The source chain is unavailable; an offline reference retains the audio cut.', 'missing', { mediaId: id });
		} else if (existing.duration && compareRationals(extent, existing.duration) > 0) media.set(id, { ...existing, duration: extent });
		return { mediaId: id, start, name };
	}
	function source(object: AafObject, rate: Rational, offset: Rational, duration: Rational, depth: number): { mediaId: string; start: Rational; name: string } | null {
		visit(depth);
		if (object.classCode === 0x0f) {
			let cursor: Rational = { num: 0, den: 1 };
			for (const child of file.refs(object, 0x1001)) {
				const end = addRationals(cursor, divideRationals(length(child), rate));
				if (compareRationals(offset, cursor) >= 0 && compareRationals(offset, end) < 0) {
					if (compareRationals(addRationals(offset, duration), end) > 0) { issue('source-span-omitted', 'A source reference crossing nested edit boundaries cannot be represented as one cut.'); return null; }
					return source(child, rate, subtractRationals(offset, cursor), duration, depth + 1);
				}
				cursor = end;
			}
			return null;
		}
		if (object.classCode !== 0x11) {
			const input = unprocessed(object); return input ? source(input, rate, offset, duration, depth + 1) : null;
		}
		const mob = mobByUid.get(uid(object, 0x1101)), slotId = file.integer(object, 0x1102);
		const slot = mob && file.refs(mob, 0x4403).find(slot => file.integer(slot, 0x4801) === slotId);
		if (!mob || !slot) return offline(object, rate, offset, duration);
		const targetRate = slotRate(slot), origin = file.integer(slot, 0x4b02);
		// AAF StartTime is in the referenced slot's units, independent of the cut's edit rate.
		const start = addRationals(offset, divideRationals(file.integer(object, 0x1201) + origin, targetRate));
		if (compareRationals(start, 0) < 0) throw new RangeError('AAF source offset is negative.');
		let descriptor = file.ref(mob, 0x4701);
		if (!descriptor) {
			const segment = file.ref(slot, 0x4803); return segment ? source(segment, targetRate, start, duration, depth + 1) : offline(object, targetRate, offset, duration);
		}
		if (descriptor.classCode === 0x44) descriptor = file.refs(descriptor, 0x3f01).find(item => file.integer(item, 0x3006) === slotId);
		if (!descriptor) return offline(object, targetRate, offset, duration);
		const id = `aaf-media-${uid(mob, 0x4401)}`;
		if (!media.has(id)) {
			let path = '';
			for (const locator of file.refs(descriptor, 0x2f01)) { path = file.text(locator, locator.classCode === 0x32 ? 0x4001 : 0x4101); if (path) break; }
			const sourceRate = file.rate(descriptor, descriptor.properties.has(0x3d03) ? 0x3d03 : 0x3001), frames = nonNegative(file.integer(descriptor, 0x3002), 'source length');
			const body = embedded.get(uid(mob, 0x4401));
			let blob: Blob | undefined;
			if (body) {
				if (descriptor.classCode === 0x2c || descriptor.classCode === 0x26) blob = new Blob([new Uint8Array(body)], { type: descriptor.classCode === 0x2c ? 'audio/wav' : 'audio/aiff' });
				else if (descriptor.classCode === 0x48 && sourceRate.den === 1 && uncompressed(descriptor)) {
					const channels = file.integer(descriptor, 0x3d07), bits = file.integer(descriptor, 0x3d01);
					const summary = aafWaveSummary(sourceRate.num, channels, frames, bits);
					if (body.length !== frames * channels * bits / 8) throw new RangeError('AAF PCM essence disagrees with its descriptor.');
					blob = new Blob([new Uint8Array(summary), new Uint8Array(body), ...(body.length & 1 ? [new Uint8Array(1)] : [])], { type: 'audio/wav' });
				} else issue('essence-unsupported', 'Embedded essence cannot be decoded by this audio profile; the source remains available for relinking.', 'missing', { descriptor: descriptor.classCode });
			}
			const name = file.text(mob, 0x4402) || path.split(/[\\/]/u).at(-1) || 'Audio.wav';
			media.set(id, { id, name, path: path || name, kind: 'audio', rate: sourceRate, duration: divideRationals(frames, file.rate(descriptor, 0x3001)), ...(blob ? { blob } : {}) });
			if (!blob && !path) issue('media-missing', 'An audio source has no usable locator or supported essence.', 'missing', { mediaId: id });
		}
		return { mediaId: id, start, name: file.text(mob, 0x4402) };
	}
	function uncompressed(descriptor: AafObject): boolean {
		const compression = descriptor.properties.get(0x3d06)?.data;
		return !compression || compression.every(byte => byte === 0) || aafHex(compression) === '007f000400000000060e2b3404010101';
	}
	const tracks: TimelineInterchangeTrack[] = [];
	let sampleRate = 48_000, sequenceRate: Rational = { num: 25, den: 1 }, startFrameCount = 0, dropFrame = false;
	for (const slot of file.refs(composition, 0x4403)) {
		const segment = file.ref(slot, 0x4803); if (!segment) continue;
		if (![0x3b, 0x39].includes(slot.classCode)) { issue('slot-kind-omitted', 'A non-timeline AAF slot is omitted.'); continue; }
		const rate = slotRate(slot);
		const timecode = segment.classCode === 0x14 ? segment : segment.classCode === 0x0f ? file.refs(segment, 0x1001).find(item => item.classCode === 0x14) : undefined;
		if (timecode) {
			sequenceRate = rate; startFrameCount = nonNegative(file.integer(timecode, 0x1501), 'timecode start'); dropFrame = file.integer(timecode, 0x1503) !== 0; continue;
		}
		if (!soundKinds.has(kind(segment))) { issue('track-kind-omitted', 'Only AAF audio tracks are imported.', 'omitted', { kind: kind(segment) }); continue; }
		if (rate.den === 1 && rate.num >= 8_000 && rate.num <= 384_000) sampleRate = rate.num;
		const clips: TimelineInterchangeClip[] = [];
		function walk(object: AafObject, start: Rational, depth: number): Rational {
			visit(depth);
			const duration = divideRationals(length(object), rate);
			if (object.classCode === 0x0f) {
				let cursor = start;
				for (const child of file.refs(object, 0x1001)) {
					if (child.classCode === 0x17) { cursor = subtractRationals(cursor, divideRationals(length(child), rate)); issue('transition-omitted', 'AAF transitions are imported as overlapping audio cuts.'); }
					else cursor = walk(child, cursor, depth + 1);
				}
			} else if (object.classCode === 0x11 && length(object) > 0) {
				const resolved = source(object, rate, { num: 0, den: 1 }, duration, 0);
				if (resolved) clips.push({ id: `aaf-clip-${visits}`, name: clipName(object) || resolved.name || 'Audio', mediaId: resolved.mediaId, start, duration, sourceStart: resolved.start });
				else issue('source-span-omitted', 'A source segment cannot be represented as a single audio cut.');
				if (file.integer(object, 0x1202) || file.integer(object, 0x1204)) issue('fades-omitted', 'AAF source-clip fades are omitted.');
			} else if (object.classCode !== 0x09) {
				const input = unprocessed(object);
				if (input) walk(input, start, depth + 1);
				else issue('component-omitted', 'An unsupported AAF component retains its timeline duration as a gap.', 'omitted', { classCode: object.classCode });
			}
			return addRationals(start, duration);
		}
		walk(segment, { num: 0, den: 1 }, 0);
		if (file.integer(slot, 0x4b02)) issue('composition-origin-converted', 'Composition slot origin is normalized to the start of its segment.', 'converted');
		tracks.push({ id: `aaf-track-${tracks.length}`, kind: 'audio', name: file.text(slot, 0x4802) || 'Audio', clips });
	}
	function clipName(object: AafObject): string {
		for (const tag of file.refs(object, 0x0204)) {
			if (file.text(tag, 0x5001) !== 'Soundscaper.ClipName') continue;
			const data = tag.properties.get(0x5003)?.data;
			if (data && data[0] === 0x4c && aafHex(data.subarray(1, 17)) === '0002100100000000060e2b3401040101') return aafText(data.subarray(17));
		}
		return '';
	}
	if (!tracks.length) throw new TypeError('AAF composition contains no supported audio tracks.');
	return { format: 'aaf', title: file.text(composition, 0x4402) || 'AAF timeline', sampleRate, rate: sequenceRate, startFrameCount, dropFrame, tracks, media: [...media.values()], issues };
}

function nonNegative(value: number, name: string): number { if (value < 0) throw new RangeError(`AAF ${name} is negative.`); return value; }
