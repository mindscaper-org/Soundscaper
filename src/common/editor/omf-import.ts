/* SPDX-License-Identifier: AGPL-3.0-only */

import { readOmfBento, type OmfBentoFile } from './omf-bento.ts';
import { addRationals, compareRationals, divideRationals, multiplyRationals, subtractRationals, type Rational } from './timeline-time.ts';
import { timelineImportIssue, type TimelineInterchangeDocument, type TimelineInterchangeMedia, type TimelineInterchangeTrack, type TimelineInterchangeClip } from './timeline-interchange-types.ts';
import type { DeliveryReportItem } from './delivery-report.ts';

/** Read OMF2 audio compositions, following standard composition/master/source mob chains. */
export function parseOmfDocument(bytes: Uint8Array): TimelineInterchangeDocument {
	if (bytes.length > 512 * 1024 * 1024) throw new RangeError('OMF input exceeds the 512 MiB limit.');
	const file = readOmfBento(bytes);
	const version = file.value(1, 'OMFI:HEAD:Version');
	if (!version || version[0] !== 2) throw new TypeError('Only OMF 2.x interchange is supported.');
	const issues: DeliveryReportItem[] = [], media = new Map<string, TimelineInterchangeMedia>();
	const objectClass = (id: number) => file.text(id, 'OMFI:OOBJ:ObjClass');
	const mobs = file.refs(1, 'OMFI:HEAD:Mobs', true);
	const uid = (id: number, property: string) => hex(file.value(id, property));
	const mobByUid = new Map(mobs.map((id) => [uid(id, 'OMFI:MOBJ:MobID'), id]));
	const compositions = [...file.refs(1, 'OMFI:HEAD:PrimaryMobs', true), ...mobs].filter((id, index, all) => objectClass(id) === 'CMOB' && all.indexOf(id) === index);
	const composition = compositions[0];
	if (composition === undefined) throw new TypeError('OMF file contains no composition mob.');
	if (compositions.length > 1) issues.push(timelineImportIssue('omf', 'additional-compositions-omitted', 'Only the first primary composition is imported.', 'omitted', { compositions: compositions.length }));
	const embedded = new Map<string, { bytes: Uint8Array; extension: string; mime: string }>();
	for (const id of file.refs(1, 'OMFI:HEAD:MediaData', true)) {
		const kind = objectClass(id), essence = file.value(id, kind === 'WAVE' ? 'OMFI:WAVE:AudioData' : 'OMFI:AIFC:AudioData');
		if ((kind === 'WAVE' || kind === 'AIFC') && essence) embedded.set(uid(id, 'OMFI:MDAT:MobID'), { bytes: essence, extension: kind === 'WAVE' ? '.wav' : '.aif', mime: kind === 'WAVE' ? 'audio/wav' : 'audio/aiff' });
	}
	let visits = 0;
	function visit(depth: number): void { if (++visits > 100_000 || depth > 32) throw new RangeError('OMF composition traversal exceeds its limit.'); }
	function firstRef(id: number, property: string): number | undefined { return file.refs(id, `OMFI:${property}`)[0]; }
	function rateOf(slot: number): Rational { return rational(file, slot, 'OMFI:MSLT:EditRate'); }
	function dataKind(segment: number): string { const kind = firstRef(segment, 'CPNT:DataKind'); return kind === undefined ? '' : file.text(kind, 'OMFI:DDEF:DataKindID'); }
	function slotOf(mob: number, trackId: number): number | undefined {
		return file.refs(mob, 'OMFI:MOBJ:Slots', true).find((slot) => {
			const description = firstRef(slot, 'MSLT:TrackDesc');
			return description !== undefined && file.integer(description, 'OMFI:TRKD:TrackID') === trackId;
		});
	}
	function source(segment: number, rate: Rational, offset: Rational, requestedDuration: Rational, depth: number): { mediaId: string; start: Rational; name: string } | null {
		visit(depth);
		const classId = objectClass(segment);
		if (classId === 'SEQU') {
			let cursor: Rational = { num: 0, den: 1 };
			for (const child of file.refs(segment, 'OMFI:SEQU:Components', true)) {
				const duration = divideRationals(nonNegative(file.integer(child, 'OMFI:CPNT:Length'), 'component length'), rate);
				const end = addRationals(cursor, duration);
				if (compareRationals(offset, cursor) >= 0 && compareRationals(offset, end) < 0) {
					if (compareRationals(addRationals(offset, requestedDuration), end) > 0) {
						issues.push(timelineImportIssue('omf', 'source-span-omitted', 'A source reference crosses nested edit boundaries and cannot be represented as one audio cut.'));
						return null;
					}
					return source(child, rate, subtractRationals(offset, cursor), requestedDuration, depth + 1);
				}
				cursor = end;
			}
			return null;
		}
		if (classId !== 'SCLP') return null;
		const mob = mobByUid.get(uid(segment, 'OMFI:SCLP:SourceID'));
		if (mob === undefined) return null;
		const slot = slotOf(mob, file.integer(segment, 'OMFI:SCLP:SourceTrackID'));
		if (slot === undefined) return null;
		const targetRate = rateOf(slot), description = firstRef(slot, 'MSLT:TrackDesc');
		const origin = description === undefined ? 0 : file.integer(description, 'OMFI:TRKD:Origin');
		const start = addRationals(addRationals(offset, divideRationals(file.integer(segment, 'OMFI:SCLP:StartTime'), rate)), divideRationals(origin, targetRate));
		if (compareRationals(start, 0) < 0) throw new RangeError('OMF source offset is negative.');
		const descriptor = firstRef(mob, 'SMOB:MediaDescription');
		if (descriptor === undefined) {
			const child = firstRef(slot, 'MSLT:Segment'); return child === undefined ? null : source(child, targetRate, start, requestedDuration, depth + 1);
		}
		const id = `omf-media-${mob}`, mobName = file.text(mob, 'OMFI:MOBJ:Name');
		if (!media.has(id)) {
			const body = embedded.get(uid(mob, 'OMFI:MOBJ:MobID'));
			const locators = file.refs(descriptor, 'OMFI:MDES:Locator', true);
			let path = '';
			for (const locator of locators) {
				const kind = objectClass(locator);
				path = file.text(locator, `OMFI:${kind}:PathName`) || file.text(locator, 'OMFI:NETL:URLString');
				if (path) break;
			}
			const descriptorKind = objectClass(descriptor);
			if (!body && !path) issues.push(timelineImportIssue('omf', 'media-missing', 'An audio source has no usable locator or embedded essence.', 'missing', { mediaId: id }));
			if (descriptorKind !== 'WAVD' && descriptorKind !== 'AIFD') issues.push(timelineImportIssue('omf', 'media-descriptor-unverified', 'An unfamiliar media descriptor may require relinking.', 'converted', { descriptorKind }));
			const sourceRate = rational(file, descriptor, 'OMFI:MDFL:SampleRate', targetRate);
			const duration = divideRationals(nonNegative(file.integer(descriptor, 'OMFI:MDFL:Length'), 'source length'), sourceRate);
			const name = mobName || path.split(/[\\/]/u).at(-1) || `Audio${body?.extension ?? '.wav'}`;
			media.set(id, { id, name, path: path || name, kind: 'audio', rate: sourceRate, duration,
				...(body ? { blob: new Blob([new Uint8Array(body.bytes)], { type: body.mime }) } : {}) });
		}
		return { mediaId: id, start, name: mobName };
	}
	const tracks: TimelineInterchangeTrack[] = [];
	let sampleRate = 48_000;
	let sequenceRate: Rational = { num: 25, den: 1 }, startFrameCount = 0, dropFrame = false;
	for (const slot of file.refs(composition, 'OMFI:MOBJ:Slots', true)) {
		const segment = firstRef(slot, 'MSLT:Segment'); if (segment === undefined) continue;
		const rate = rateOf(slot), kind = dataKind(segment), description = firstRef(slot, 'MSLT:TrackDesc');
		const timecode = objectClass(segment) === 'TCCP' ? segment : objectClass(segment) === 'SEQU'
			? file.refs(segment, 'OMFI:SEQU:Components', true).find((id) => objectClass(id) === 'TCCP') : undefined;
		if (timecode !== undefined) { sequenceRate = rate; startFrameCount = nonNegative(file.integer(timecode, 'OMFI:TCCP:Start'), 'timecode start'); dropFrame = file.integer(timecode, 'OMFI:TCCP:Drop') !== 0; continue; }
		if (kind !== 'omfi:data:Sound' && kind !== 'omfi:data:StereoSound') {
			issues.push(timelineImportIssue('omf', 'track-kind-omitted', 'Only OMF audio tracks are imported.', 'omitted', { kind })); continue;
		}
		if (rate.den === 1 && rate.num >= 8_000 && rate.num <= 384_000) sampleRate = rate.num;
		const clips: TimelineInterchangeClip[] = [], trackId = `omf-track-${slot}`;
		function walk(id: number, start: Rational, depth: number): Rational {
			visit(depth);
			const duration = divideRationals(nonNegative(file.integer(id, 'OMFI:CPNT:Length'), 'component length'), rate), classId = objectClass(id);
			if (classId === 'SEQU') {
				let cursor = start;
				for (const child of file.refs(id, 'OMFI:SEQU:Components', true)) {
					if (objectClass(child) === 'TRAN') {
						cursor = subtractRationals(cursor, divideRationals(nonNegative(file.integer(child, 'OMFI:CPNT:Length'), 'transition length'), rate));
						issues.push(timelineImportIssue('omf', 'transition-omitted', 'OMF transitions are imported as overlapping audio cuts.')); continue;
					}
					cursor = walk(child, cursor, depth + 1);
				}
				return addRationals(start, duration);
			}
			if (classId === 'SCLP') {
				const resolved = source(id, rate, { num: 0, den: 1 }, duration, 0);
				if (resolved) clips.push({ id: `omf-clip-${id}-${clips.length}`, name: file.text(id, 'OMFI:CPNT:Name') || resolved.name || 'Audio', mediaId: resolved.mediaId, start, duration, sourceStart: resolved.start });
				else issues.push(timelineImportIssue('omf', 'source-chain-missing', 'A source clip has no resolvable audio source.', 'missing', { object: id }));
				if (file.integer(id, 'OMFI:SCLP:FadeInLength') || file.integer(id, 'OMFI:SCLP:FadeOutLength')) issues.push(timelineImportIssue('omf', 'fades-omitted', 'OMF source-clip fades are not imported.'));
			} else if (classId !== 'FILL') issues.push(timelineImportIssue('omf', 'component-omitted', 'An unsupported OMF component retains its timeline duration as a gap.', 'omitted', { classId }));
			return addRationals(start, duration);
		}
		walk(segment, { num: 0, den: 1 }, 0);
		tracks.push({ id: trackId, kind: 'audio', name: description === undefined ? 'Audio' : file.text(description, 'OMFI:TRKD:TrackName') || 'Audio', clips });
	}
	if (!tracks.length) throw new TypeError('OMF composition contains no supported audio tracks.');
	if (sampleRate === 48_000) {
		const first = [...media.values()][0]?.rate;
		if (first && first.den === 1 && first.num >= 8_000 && first.num <= 384_000) sampleRate = first.num;
	}
	return { format: 'omf', title: file.text(composition, 'OMFI:MOBJ:Name') || 'OMF timeline', sampleRate,
		rate: sequenceRate, dropFrame, startFrameCount, tracks, media: [...media.values()], issues };
}

function rational(file: OmfBentoFile, object: number, property: string, fallback?: Rational): Rational {
	const bytes = file.value(object, property); if (!bytes && fallback) return fallback;
	if (!bytes || bytes.length !== 8) throw new TypeError('OMF edit rate requires an exact rational.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), num = view.getInt32(0, file.dataLittleEndian), den = view.getInt32(4, file.dataLittleEndian);
	if (num <= 0 || den <= 0) throw new RangeError('OMF edit rate must be positive.');
	return multiplyRationals({ num, den }, 1);
}
function hex(bytes: Uint8Array | undefined): string { return bytes ? [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('') : ''; }
function nonNegative(value: number, name: string): number { if (value < 0) throw new RangeError(`OMF ${name} is negative.`); return value; }
