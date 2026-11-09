/* SPDX-License-Identifier: AGPL-3.0-only */

import { divideRationals, normalizeRational, type Rational } from './timeline-time.ts';
import { parseSequenceTimecode, sequenceTimecodeToFrameCount } from './sequence-timecode.ts';
import { timelineImportIssue, TIMELINE_INTERCHANGE_MAXIMUM_ITEMS, type TimelineInterchangeDocument,
	type TimelineInterchangeTrack, type TimelineInterchangeMedia } from './timeline-interchange-types.ts';

interface Event {
	readonly id: string;
	readonly reel: string;
	readonly kind: 'video' | 'audio';
	readonly sourceIn: number;
	readonly sourceOut: number;
	readonly recordIn: number;
	readonly recordOut: number;
	name: string;
	path: string;
}

export function parseEdlTimeline(text: string, requestedRate?: Rational): TimelineInterchangeDocument {
	const dropFrame = /^FCM:\s*DROP FRAME\s*$/imu.test(text);
	const declaredRate = text.match(/^\*?\s*(?:FPS|FRAME RATE):\s*(\d+)(?:\/(\d+))?\s*$/imu);
	const rate = normalizeRational(requestedRate ?? (declaredRate
		? { num: Number(declaredRate[1]), den: Number(declaredRate[2] ?? 1) }
		: dropFrame ? { num: 30000, den: 1001 } : { num: 30, den: 1 }));
	if (rate.num <= 0) throw new RangeError('An EDL rate must be positive.');
	const issues: TimelineInterchangeDocument['issues'][number][] = [];
	if (!requestedRate && !declaredRate) issues.push(timelineImportIssue('edl', 'rate-assumed',
		`CMX3600 does not declare a frame rate; ${rate.num}/${rate.den} was used.`, 'converted', { rate }));
	const events: Event[] = [];
	let previous: Event[] = [];
	for (const line of text.split(/\r?\n/u)) {
		if (/^\s*\d+\s/u.test(line)) {
			const match = line.trim().match(/^(\d+)\s+(\S+)\s+(\S+)\s+(C|D|W\d+)(?:\s+\d+)?\s+(\d{2}:\d{2}:\d{2}[:;]\d{2})\s+(\d{2}:\d{2}:\d{2}[:;]\d{2})\s+(\d{2}:\d{2}:\d{2}[:;]\d{2})\s+(\d{2}:\d{2}:\d{2}[:;]\d{2})$/u);
			if (!match) throw new TypeError('Malformed CMX3600 event record.');
			if (events.length >= TIMELINE_INTERCHANGE_MAXIMUM_ITEMS) throw new RangeError('EDL event limit exceeded.');
			const frame = (value: string) => sequenceTimecodeToFrameCount(parseSequenceTimecode(value, rate, dropFrame), rate, dropFrame);
			const sourceIn = frame(match[5]!), sourceOut = frame(match[6]!);
			const recordIn = frame(match[7]!), recordOut = frame(match[8]!);
			if (sourceOut <= sourceIn || recordOut <= recordIn) throw new RangeError('An EDL event requires positive ranges.');
			if (sourceOut - sourceIn !== recordOut - recordIn) issues.push(timelineImportIssue('edl', 'retime-omitted', 'Unequal source and record durations are imported at record duration with unity playback.'));
			if (match[4] !== 'C') issues.push(timelineImportIssue('edl', 'transition-omitted', 'EDL transitions are imported as cuts.'));
			const kinds: Event['kind'][] = [];
			if (match[3]!.includes('V')) kinds.push('video');
			if (match[3]!.includes('A')) kinds.push('audio');
			if (!kinds.length) throw new TypeError('An EDL event has an unsupported track selector.');
			previous = [];
			for (const kind of kinds) {
				const event: Event = { id: `${match[1]}-${kind}-${events.length}`, reel: match[2]!, kind, sourceIn, sourceOut, recordIn, recordOut, name: match[2]!, path: match[2]! };
				events.push(event);
				previous.push(event);
			}
		} else if (previous.length) {
			const clipName = line.match(/^\*\s*FROM CLIP NAME:\s*(.+?)\s*$/iu);
			const sourceFile = line.match(/^\*\s*(?:SOURCE FILE|FROM FILE):\s*(.+?)\s*$/iu);
			if (clipName) for (const event of previous) { event.name = clipName[1]!; event.path = clipName[1]!; }
			if (sourceFile) for (const event of previous) event.path = sourceFile[1]!;
			if (/^M2\s/u.test(line)) issues.push(timelineImportIssue('edl', 'motion-omitted', 'EDL M2 motion records are omitted.'));
		}
	}
	if (!events.length) throw new TypeError('The EDL contains no supported event records.');
	const declaredStart = text.match(/^\*\s*SEQUENCE START:\s*(\d+)\s*$/imu);
	const startFrameCount = declaredStart ? Number(declaredStart[1])
		: events.reduce((minimum, event) => Math.min(minimum, event.recordIn), Number.MAX_SAFE_INTEGER);
	if (!Number.isSafeInteger(startFrameCount) || events.some(event => event.recordIn < startFrameCount)) throw new RangeError('EDL sequence origin must precede its events.');
	const seconds = (frames: number) => divideRationals(frames, rate);
	const tracks: TimelineInterchangeTrack[] = [];
	const media: TimelineInterchangeMedia[] = [];
	for (const kind of ['video', 'audio'] as const) {
		const clips: TimelineInterchangeTrack['clips'][number][] = [];
		for (const event of events.filter(event => event.kind === kind)) {
			if (event.reel === 'BL') continue;
			const mediaId = `${kind}:${event.path}`;
			if (!media.some(item => item.id === mediaId)) media.push({ id: mediaId, path: event.path, name: event.name, kind, rate });
			clips.push({ id: event.id, name: event.name, mediaId, start: seconds(event.recordIn - startFrameCount), duration: seconds(event.recordOut - event.recordIn), sourceStart: seconds(event.sourceIn) });
		}
		if (clips.length) tracks.push({ id: kind, name: kind === 'video' ? 'Video' : 'Audio', kind, clips });
	}
	return { format: 'edl', title: text.match(/^TITLE:\s*(.*?)\s*$/imu)?.[1] || 'EDL timeline', sampleRate: 48000, rate, dropFrame, startFrameCount, tracks, media, issues };
}
