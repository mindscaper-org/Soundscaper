/* SPDX-License-Identifier: AGPL-3.0-only */

import { addRationals, subtractRationals, divideRationals, compareRationals, normalizeRational, roundRational, multiplyRationals, type Rational } from './timeline-time.ts';
import { rationalFromDouble } from './dawproject-format.ts';
import { timelineImportIssue, timelineInterchangeMediaName, TIMELINE_INTERCHANGE_MAXIMUM_DEPTH, TIMELINE_INTERCHANGE_MAXIMUM_ITEMS,
	type TimelineInterchangeDocument, type TimelineInterchangeMedia, type TimelineInterchangeTrack, type TimelineInterchangeClip } from './timeline-interchange-types.ts';

type RecordValue = Readonly<Record<string, unknown>>;
interface Segment { tracks: TimelineInterchangeTrack[]; duration: Rational }
const ZERO: Rational = Object.freeze({ num: 0, den: 1 });
const NAMESPACE = 'media.kw.soundscaper';

export function parseOtioTimeline(text: string): TimelineInterchangeDocument {
	const root = record(JSON.parse(text));
	if (schema(root) !== 'Timeline') throw new TypeError('The OTIO document must contain a Timeline.');
	const issues: TimelineInterchangeDocument['issues'][number][] = [];
	const media = new Map<string, TimelineInterchangeMedia>();
	const metadata = record(record(root.metadata)[NAMESPACE]);
	const start = record(root.global_start_time);
	let visited = 0;
	let firstVideoRate: Rational | undefined;
	const walk = (node: RecordValue, kind: 'audio' | 'video', name: string, depth: number): Segment => {
		if (depth > TIMELINE_INTERCHANGE_MAXIMUM_DEPTH) throw new RangeError('OTIO nesting depth limit exceeded.');
		const index = ++visited;
		if (index > TIMELINE_INTERCHANGE_MAXIMUM_ITEMS) throw new RangeError('OTIO item limit exceeded.');
		const type = schema(node);
		const range = record(node.source_range);
		const duration = range.duration ? time(record(range.duration)) : null;
		const sourceStart = range.start_time ? time(record(range.start_time)) : ZERO;
		if (Array.isArray(node.effects) && node.effects.length) issues.push(timelineImportIssue('otio', 'effects-omitted', 'OTIO effects and time warps are omitted.'));
		if (Array.isArray(node.markers) && node.markers.length) issues.push(timelineImportIssue('otio', 'markers-omitted', 'OTIO item markers are omitted.'));
		if (type === 'Transition') {
			issues.push(timelineImportIssue('otio', 'transition-omitted', 'OTIO transitions are imported as cuts.'));
			return { tracks: [], duration: ZERO };
		}
		if (type === 'Clip' || type === 'Gap') {
			const references = record(node.media_references);
			const reference = record(node.media_reference ?? references[String(node.active_media_reference_key ?? 'DEFAULT_MEDIA')]);
			const available = record(reference.available_range);
			const clipDuration = duration ?? (available.duration ? time(record(available.duration)) : null);
			if (!clipDuration || clipDuration.num <= 0) throw new RangeError('An OTIO item needs a positive duration.');
			if (type === 'Gap') return { tracks: [], duration: clipDuration };
			if (node.enabled === false) {
				issues.push(timelineImportIssue('otio', 'disabled-clip-omitted', 'A disabled OTIO clip is omitted; its duration remains a gap.'));
				return { tracks: [], duration: clipDuration };
			}
			const availableStart = available.start_time ? time(record(available.start_time)) : ZERO;
			const relativeSourceStart = range.start_time ? subtractRationals(sourceStart, availableStart) : ZERO;
			if (relativeSourceStart.num < 0) throw new RangeError('An OTIO source range begins before its media origin.');
			if (sourceStart.num < 0) throw new RangeError('An OTIO clip source start cannot be negative.');
			const path = String(reference.target_url ?? '');
			const key = `${kind}\0${path || String(reference.name ?? node.name ?? visited)}`;
			let entry = media.get(key);
			if (!entry) {
				const id = [...media.values()].some(item => item.id === path) ? `${kind}:${path}` : path || `missing-${visited}`;
				const sourceRate = record(available.duration).rate ?? record(range.duration).rate;
				entry = { id, path, name: timelineInterchangeMediaName(path, String(reference.name ?? node.name ?? '')), kind,
					aliases: [String(record(record(reference.metadata)[NAMESPACE]).sourceName ?? reference.name ?? '')].filter(Boolean),
					...(sourceRate ? { rate: rateFromDouble(Number(sourceRate)) } : {}),
					...(available.duration ? { duration: time(record(available.duration)) } : {}) };
				media.set(key, entry);
			}
			if (kind === 'video' && !firstVideoRate && record(range.duration).rate) firstVideoRate = rateFromDouble(Number(record(range.duration).rate));
			const clip: TimelineInterchangeClip = { id: `clip-${index}`, name: String(node.name ?? ''), mediaId: entry.id, start: ZERO, duration: clipDuration, sourceStart: relativeSourceStart };
			return { tracks: [{ id: `track-${index}`, kind, name, clips: [clip], mute: node.enabled === false }], duration: clipDuration };
		}
		if (type !== 'Track' && type !== 'Stack') {
			issues.push(timelineImportIssue('otio', 'item-omitted', `Unsupported OTIO ${type || 'item'} is omitted.`));
			return { tracks: [], duration: duration ?? ZERO };
		}
		const children = node.children;
		if (!Array.isArray(children)) throw new TypeError('OTIO containers need a children array.');
		const childKind = type === 'Track' ? node.kind === 'Video' ? 'video' : 'audio' : kind;
		const trackName = String(node.name ?? name);
		let cursor = ZERO;
		const tracks: TimelineInterchangeTrack[] = [];
		const directClips: TimelineInterchangeClip[] = [];
		for (const childValue of children) {
			const child = record(childValue);
			const segment = walk(child, childKind, trackName, depth + 1);
			for (const track of segment.tracks) {
				const clips = track.clips.map(clip => ({ ...clip, start: addRationals(clip.start, type === 'Track' ? cursor : ZERO) }));
				if (type === 'Track' && schema(child) === 'Clip') directClips.push(...clips);
				else tracks.push({ ...track, clips, mute: Boolean(track.mute || node.enabled === false) });
			}
			cursor = type === 'Track' ? addRationals(cursor, segment.duration)
				: compareRationals(cursor, segment.duration) < 0 ? segment.duration : cursor;
		}
		if (directClips.length) tracks.unshift({ id: `track-${index}`, name: trackName, kind: childKind, clips: directClips, mute: node.enabled === false });
		const result = { tracks, duration: cursor };
		return duration ? trimSegment(result, sourceStart, duration) : result;
	};
	const segment = walk(record(root.tracks), 'video', 'Track', 0);
	const metadataRate = record(metadata.sequenceRate);
	const rate = metadataRate.num && metadataRate.den ? normalizeRational({ num: Number(metadataRate.num), den: Number(metadataRate.den) })
		: start.rate ? rateFromDouble(Number(start.rate)) : firstVideoRate ?? { num: 30, den: 1 };
	if (rate.num <= 0) throw new RangeError('OTIO sequence rate must be positive.');
	const origin = start.rate ? multiplyRationals(time(start), rate) : ZERO;
	const startFrameCount = roundRational(origin.num, origin.den, 'point');
	const sampleRate = metadata.sampleRate === undefined ? 48000 : Number(metadata.sampleRate);
	if (!Number.isSafeInteger(sampleRate) || sampleRate < 1) throw new RangeError('OTIO sample rate must be positive.');
	return { format: 'otio', title: String(root.name ?? 'OTIO timeline'), sampleRate, rate, dropFrame: Boolean(metadata.dropFrame), startFrameCount, tracks: segment.tracks, media: [...media.values()], issues };
}

function trimSegment(segment: Segment, start: Rational, duration: Rational): Segment {
	if (duration.num <= 0 || start.num < 0) throw new RangeError('An OTIO container range must be positive.');
	const end = addRationals(start, duration);
	return { duration, tracks: segment.tracks.map(track => ({ ...track, clips: track.clips.flatMap(clip => {
		const clipEnd = addRationals(clip.start, clip.duration);
		const visibleStart = compareRationals(clip.start, start) < 0 ? start : clip.start;
		const visibleEnd = compareRationals(clipEnd, end) > 0 ? end : clipEnd;
		if (compareRationals(visibleEnd, visibleStart) <= 0) return [];
		return [{ ...clip, start: subtractRationals(visibleStart, start), duration: subtractRationals(visibleEnd, visibleStart), sourceStart: addRationals(clip.sourceStart, subtractRationals(visibleStart, clip.start)) }];
	}) })) };
}

function schema(value: RecordValue): string { return String(value.OTIO_SCHEMA ?? '').split('.')[0]!; }
function record(value: unknown): RecordValue { return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}; }
function time(value: RecordValue): Rational {
	const amount = Number(value.value), rate = Number(value.rate);
	if (!Number.isFinite(amount) || Math.abs(amount) > Number.MAX_SAFE_INTEGER || !Number.isFinite(rate) || rate <= 0) throw new RangeError('An OTIO RationalTime must have finite values and a positive rate.');
	return divideRationals(rationalFromDouble(amount), rateFromDouble(rate));
}
function rateFromDouble(value: number): Rational {
	if (!Number.isFinite(value) || value <= 0) throw new RangeError('An OTIO rate must be positive.');
	for (const rate of [{ num: 24000, den: 1001 }, { num: 30000, den: 1001 }, { num: 60000, den: 1001 }, { num: 120000, den: 1001 }]) {
		if (Math.abs(rate.num / rate.den - value) < 1e-9) return rate;
	}
	return rationalFromDouble(value);
}
