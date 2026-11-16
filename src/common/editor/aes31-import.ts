/* SPDX-License-Identifier: AGPL-3.0-only */
import { adlChannelRange, adlEntries, adlField, adlInteger, readAdlSections, type AdlField } from './aes31-edml.ts';
import { adlClockFromText, parseAdlTime, type AdlClock } from './aes31-time.ts';
import { sequenceTimecodeToFrameCount } from './sequence-timecode.ts';
import { timelineInterchangeMediaName, timelineImportIssue, type TimelineInterchangeClip, type TimelineInterchangeDocument, type TimelineInterchangeMedia, type TimelineInterchangeTrack } from './timeline-interchange-types.ts';
import type { DeliveryReportItem } from './delivery-report.ts';
import { subtractRationals, type Rational } from './timeline-time.ts';

interface AdlSource { readonly path: string; readonly origin: Rational; readonly duration?: Rational; readonly name: string }

export function parseAdlDocument(text: string): TimelineInterchangeDocument {
	const sections = readAdlSections(text.replace(/^\uFEFF/u, ''));
	const version = adlField(sections.get('VERSION') ?? [], 'VER_ADL_VERSION');
	if (!/^01\.(?:00|01|02)(?:\.00)?$/u.test(version)) throw new RangeError('Unsupported ADL version.');
	const sequence = sections.get('SEQUENCE') ?? [];
	const clock = adlClockFromText(adlField(sequence, 'SEQ_SAMPLE_RATE'), adlField(sequence, 'SEQ_FRAME_RATE'));
	const originText = adlField(sequence, 'SEQ_DEST_START', zeroTime(clock));
	const origin = parseAdlTime(originText, clock);
	const issues: DeliveryReportItem[] = [];
	const issue = (code: string, message: string, disposition: 'converted' | 'omitted' = 'omitted') => {
		issues.push(timelineImportIssue('adl', code, message, disposition));
	};
	const sources = new Map<string, AdlSource>();
	for (const fields of adlEntries(sections.get('SOURCE_INDEX') ?? [], 'INDEX')) {
		const id = String(adlInteger(adlField(fields, 'INDEX'), 'source index', 1));
		if (sources.has(id)) throw new SyntaxError('Duplicate ADL source index.');
		const values = fields.find(field => field.key === 'F')?.values;
		if (!values || values.length !== 6) throw new SyntaxError('ADL requires file source entries.');
		const path = values[0]!.replace(/^URL:/iu, '');
		const name = timelineInterchangeMediaName(path.replace(/^file:/iu, ''), values[4] || 'Audio.wav');
		sources.set(id, { path, name, origin: sourceTime(values[2]!, clock),
			...(values[3] !== '_' ? { duration: sourceTime(values[3]!, clock) } : {}) });
	}
	const media = new Map<string, TimelineInterchangeMedia>();
	const tracks = new Map<string, { id: string; name: string; kind: 'audio'; clips: TimelineInterchangeClip[] }>();
	const entryIds = new Set<string>();
	for (const fields of adlEntries(sections.get('EVENT_LIST') ?? [], 'ENTRY')) {
		const id = String(adlInteger(adlField(fields, 'ENTRY'), 'event index', 1));
		if (entryIds.has(id)) throw new SyntaxError('Duplicate ADL event index.');
		entryIds.add(id);
		const cuts = fields.filter(field => field.key === 'CUT');
		if (cuts.length !== 1) throw new SyntaxError('An ADL event requires one Cut.');
		const values = cuts[0]!.values;
		if (values.length !== 8 || values[0] !== 'I') throw new TypeError('Unsupported ADL edit reference.');
		const sourceId = String(adlInteger(values[1], 'source reference', 1)), source = sources.get(sourceId);
		if (!source) throw new ReferenceError('ADL event references an undeclared source.');
		const channels = adlChannelRange(values[2]!), destinations = adlChannelRange(values[3]!);
		if (channels.length !== destinations.length) throw new RangeError('ADL source and destination channel counts differ.');
		const start = parseAdlTime(values[5]!, clock) - origin, end = parseAdlTime(values[6]!, clock) - origin;
		const sourceStart = subtractRationals(sourceTime(values[4]!, clock), source.origin);
		if (start < 0 || end <= start || sourceStart.num < 0) throw new RangeError('Invalid ADL edit range.');
		const mediaId = `${sourceId}:${values[2]}`;
		if (!media.has(mediaId)) media.set(mediaId, { id: mediaId, name: source.name, path: source.path, kind: 'audio',
			channelIndices: channels, ...(source.duration ? { duration: source.duration } : {}) });
		const trackId = `channels-${values[3]}`;
		const track = tracks.get(trackId) ?? { id: trackId, name: `Channels ${values[3]}`, kind: 'audio' as const, clips: [] };
		tracks.set(trackId, track);
		const rem = fields.find(field => field.key === 'REM' && field.values[0] === 'NAME');
		track.clips.push({ id: `event-${id}`, name: rem?.values[1] ?? source.name, mediaId, sourceStart,
			start: { num: start, den: clock.sampleRate }, duration: { num: end - start, den: clock.sampleRate },
			...eventProcessing(fields, clock, end - start, issue) });
		for (const field of fields) if (!['ENTRY', 'CUT', 'REM', 'INFADE', 'OUTFADE', 'GAIN'].includes(field.key)) {
			issue('event-feature-omitted', `ADL event ${id}: ${field.key} is unsupported.`);
		}
	}
	for (const [name, fields] of sections) {
		if (['FADER_LIST', 'PAN_LIST', 'MUTE_LIST', 'MARKER_LIST', 'MARKERS'].includes(name) && fields.length) {
			issue('automation-omitted', `ADL ${name} automation or markers are not imported by this profile.`);
		} else if (!['VERSION', 'PROJECT', 'SYSTEM', 'SEQUENCE', 'SOURCE_INDEX', 'EVENT_LIST'].includes(name) && fields.length) {
			issue('section-omitted', `ADL ${name} is unsupported.`);
		}
	}
	const parts = /^(\d{2}).(\d{2}).(\d{2}).(\d{2})/u.exec(originText)!;
	const startFrameCount = sequenceTimecodeToFrameCount({ negative: false, hours: Number(parts[1]), minutes: Number(parts[2]),
		seconds: Number(parts[3]), frames: Number(parts[4]) }, clock.rate, clock.dropFrame);
	if (Number(originText.slice(-4)) !== 0) issue('sequence-origin-converted', 'The sequence display origin is frame-aligned; edit positions retain the original sample origin.', 'converted');
	return { format: 'adl', title: adlField(sections.get('PROJECT') ?? [], 'PROJ_TITLE', ''), sampleRate: clock.sampleRate,
		rate: clock.rate, dropFrame: clock.dropFrame, startFrameCount,
		tracks: [...tracks.values()] as readonly TimelineInterchangeTrack[], media: [...media.values()], issues };
}

function sourceTime(value: string, clock: AdlClock): Rational {
	const sampleRate = value[11] === '|' ? 44_100 : 48_000;
	return { num: value === '_' ? 0 : parseAdlTime(value, { ...clock, sampleRate }), den: sampleRate };
}

function zeroTime(clock: AdlClock): string {
	const separator = clock.dropFrame ? ':' : clock.rate.num === 24 ? '=' : clock.rate.num === 25 ? '.' : '|';
	return `00${separator}00${separator}00${clock.dropFrame ? ',' : separator}00${clock.sampleRate === 44_100 ? '|' : '/'}0000`;
}

function eventProcessing(fields: readonly AdlField[], clock: AdlClock, duration: number,
	issue: (code: string, message: string, disposition?: 'converted' | 'omitted') => void,
): Pick<TimelineInterchangeClip, 'gain' | 'fadeIn' | 'fadeOut'> {
	const result: { gain?: number; fadeIn?: Rational; fadeOut?: Rational } = {};
	for (const [key, property] of [['INFADE', 'fadeIn'], ['OUTFADE', 'fadeOut']] as const) {
		const entries = fields.filter(field => field.key === key);
		if (entries.length > 1) throw new SyntaxError('Duplicate ADL fade.');
		const values = entries[0]?.values;
		if (!values) continue;
		const length = parseAdlTime(values[0]!, clock);
		if (length > duration) throw new RangeError('ADL fade exceeds its event.');
		if (values.length !== 5 || values[1] !== 'LIN' || values.slice(2).some(value => value !== '_')) {
			issue('fade-omitted', 'An unsupported ADL fade curve was omitted.'); continue;
		}
		result[property] = { num: length, den: clock.sampleRate };
	}
	const gains = fields.filter(field => field.key === 'GAIN');
	if (gains.length > 1) throw new SyntaxError('Duplicate ADL gain.');
	if (gains[0]) {
		const values = gains[0].values, db = values[1] === '_' ? 0 : Number(values[1]);
		if (values.length !== 2 || values[0] !== '_' || !Number.isFinite(db)) throw new TypeError('Unsupported ADL gain.');
		const gain = Math.pow(10, db / 20);
		if (gain > 16) { result.gain = 16; issue('gain-converted', 'ADL clip gain was limited to the supported maximum of 16.', 'converted'); }
		else result.gain = gain;
	}
	return result;
}
