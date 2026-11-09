/* SPDX-License-Identifier: AGPL-3.0-only */

import { addRationals, subtractRationals, divideRationals, compareRationals, multiplyRationals, roundRational, type Rational } from './timeline-time.ts';
import { sequenceTimecodeFromFrameCount, sequenceTimecodeToFrameCount } from './sequence-timecode.ts';
import { createDeliveryReport, addDeliveryReportItem, sealDeliveryReport, type DeliveryReport } from './delivery-report.ts';
import { resolveVideoSourceTimingViews } from './video-source-timing-views.ts';
import { videoSourceTimingView, sourceTimeToVideoBoundary, videoBoundaryTime, compareSourceTimes, sourceTimeDifference, shiftSourceTime, type ExactSourceTime } from './video-source-timing-view.ts';
import { rationalFromDouble } from './dawproject-format.ts';
import { normalizeProjectSampleRate } from './project-sample-rate.ts';
import type { TimelineInterchangeDocument, TimelineInterchangeClip } from './timeline-interchange-types.ts';

export interface TimelineInterchangeImportOptions {
	readonly fileName?: string;
	readonly sampleRate?: number;
	readonly createStableId: (prefix: string) => string;
	/** Decoded source options keyed by normalized document media ID. */
	readonly media?: ReadonlyMap<string, Readonly<Record<string, unknown>> | null>;
	readonly stagedSourceIds?: ReadonlyMap<string, string>;
}
export interface TimelineInterchangeImportPlan {
	readonly title: string;
	readonly sampleRate: number;
	readonly project: Record<string, unknown>;
	readonly media: readonly { readonly mediaId: string; readonly sourceId: string }[];
	readonly report: Omit<DeliveryReport, 'direction'> & Readonly<{ direction: 'import' }>;
}

export function buildTimelineInterchangeProject(document: TimelineInterchangeDocument,
	options: TimelineInterchangeImportOptions): TimelineInterchangeImportPlan {
	if (typeof options.createStableId !== 'function') throw new TypeError('Timeline import requires an ID factory.');
	const sampleRate = normalizeProjectSampleRate(options.sampleRate ?? document.sampleRate);
	const title = document.title || options.fileName?.replace(/\.[^.]+$/u, '') || 'Imported timeline';
	const draft = createDeliveryReport({ format: document.format, container: document.format.toUpperCase(), sampleRate });
	for (const issue of document.issues) addDeliveryReportItem(draft, issue);
	const sources: Record<string, unknown>[] = [], clips: Record<string, unknown>[] = [], tracks: Record<string, unknown>[] = [];
	const bindings: { mediaId: string; sourceId: string }[] = [];
	const sourceByMediaId = new Map<string, Record<string, unknown>>();
	const allClips = document.tracks.flatMap(track => track.clips);
	const sourceExtent = new Map<string, Rational>();
	for (const clip of allClips) {
		if (clip.start.num < 0 || clip.sourceStart.num < 0 || clip.duration.num <= 0) throw new RangeError('Imported clip ranges must be positive.');
		const end = addRationals(clip.sourceStart, clip.duration);
		const previous = sourceExtent.get(clip.mediaId);
		if (!previous || compareRationals(end, previous) > 0) sourceExtent.set(clip.mediaId, end);
	}
	for (const item of document.media) {
		const info = options.media?.get(item.id);
		const sourceId = options.stagedSourceIds?.get(item.id) ?? (info?.id ? String(info.id) : options.createStableId('source'));
		if (info && info.kind !== undefined && info.kind !== item.kind) throw new TypeError('Decoded interchange media has a different kind.');
		const extent = item.duration ?? sourceExtent.get(item.id) ?? { num: 1, den: 1 };
		const sourceRate = Number(info?.sampleRate ?? sampleRate);
		const frameRate = typeof info?.frameRate === 'number' ? rationalFromDouble(info.frameRate)
			: info?.frameRate as Rational | undefined ?? item.rate ?? document.rate;
		const observedDuration = typeof info?.durationSeconds === 'number' && info.durationSeconds > 0
			? rationalFromDouble(info.durationSeconds) : null;
		const source: Record<string, unknown> = {
			name: item.name || item.path || sourceId, kind: item.kind,
			storageKey: sourceId, sampleRate: sourceRate,
			...(item.kind === 'video'
				? { mimeType: 'video/mp4', width: item.width ?? 1, height: item.height ?? 1, frameRate,
					sampleFrameCount: Math.max(1, ticks(observedDuration ?? extent, { num: sourceRate, den: 1 }, 'enclosingEnd')),
					sourceFrameCount: Math.max(1, ticks(observedDuration ?? extent, frameRate, 'enclosingEnd')) }
				: { mimeType: 'audio/wav', frameCount: Math.max(1, ticks(extent, { num: sourceRate, den: 1 }, 'enclosingEnd')), channelCount: 2, sampleFormat: 'float32' }),
			...info, id: sourceId, ...(item.kind === 'video' ? { frameRate } : {}),
		};
		if (!info) {
			source.opaqueExtensions = { 'soundscaper.interchange': { format: document.format, mediaId: item.id, path: item.path, offline: true } };
			addDeliveryReportItem(draft, { code: `${document.format}.media-missing`, disposition: 'missing', severity: 'error',
				scope: { kind: 'source', id: sourceId }, data: { mediaId: item.id, path: item.path, placeholderGeometry: item.kind === 'video' },
				message: 'Referenced media is unavailable. The edit and an offline source reference are retained; source extent and placeholder geometry describe the imported edit rather than a media probe.' });
		} else bindings.push({ mediaId: item.id, sourceId });
		sources.push(source); sourceByMediaId.set(item.id, source);
	}
	for (const track of document.tracks) {
		const id = options.createStableId('track');
		const clipIds: string[] = [];
		for (const authored of track.clips) {
			const source = sourceByMediaId.get(authored.mediaId);
			if (!source) throw new ReferenceError('Imported clip references an undeclared media item.');
			if (source.kind !== track.kind) throw new TypeError('Imported clip source kind differs from its track.');
			const clipId = options.createStableId('clip');
			const clip = buildClip(authored, source, document, sampleRate, clipId);
			if (!clip) {
				addDeliveryReportItem(draft, { code: `${document.format}.clip-out-of-range`, disposition: 'omitted', severity: 'warning', scope: { kind: 'clip', id: clipId }, message: 'The clip has no playable extent within the decoded source or on the target time grid.' });
				continue;
			}
			const shortened = clip.shortened === true;
			delete clip.shortened;
			clips.push(clip); clipIds.push(clipId);
			if (shortened) {
				addDeliveryReportItem(draft, { code: `${document.format}.clip-source-extent-converted`, disposition: 'converted', severity: 'warning', scope: { kind: 'clip', id: clipId }, message: 'The clip was shortened to fit the decoded media extent.' });
			}
		}
		tracks.push({ id, type: track.kind, name: track.name, mute: Boolean(track.mute), clipIds });
	}
	const project: Record<string, unknown> = {
		id: options.createStableId('project'), title, sampleRate, metadata: { title }, sources, clips, tracks,
		primarySequenceId: 'main-sequence', sequences: [{ id: 'main-sequence', name: title, rate: document.rate,
			dropFrame: document.dropFrame, startTimecode: sequenceTimecodeFromFrameCount(document.startFrameCount, document.rate, document.dropFrame),
			trackIds: tracks.map(track => track.id), trackNodes: tracks.map(track => ({ kind: 'track', id: track.id, parentFolderId: null })) }],
	};
	addDeliveryReportItem(draft, { code: `${document.format}.timeline-imported`, disposition: 'preserved', severity: 'info', data: { tracks: tracks.length, clips: clips.length, sources: sources.length }, message: 'Timeline tracks, cut placement, source trims and sequence timing were imported.' });
	return Object.freeze({ title, sampleRate, project, media: Object.freeze(bindings), report: Object.freeze({ ...sealDeliveryReport(draft), direction: 'import' as const }) });
}

function buildClip(authored: TimelineInterchangeClip, source: Readonly<Record<string, unknown>>, document: TimelineInterchangeDocument,
	sampleRate: number, id: string): Record<string, unknown> | null {
	if (source.kind === 'video' && document.format === 'edl') authored = rebaseEdlCameraOrigin(authored, source);
	if (authored.sourceStart.num < 0) return null;
	const end = addRationals(authored.start, authored.duration);
	if (source.kind === 'video') {
		const sourceRate = source.frameRate as Rational;
		const sequenceStartFrame = ticks(authored.start, document.rate);
		let sequenceEndFrame = ticks(end, document.rate);
		const exact = (source.timingDecision as Readonly<Record<string, unknown>> | undefined)?.mode === 'exact';
		const view = exact ? videoSourceTimingView(resolveVideoSourceTimingViews({ sources: [source] }), source) : null;
		const boundary = (time: Rational) => view ? sourceTimeToVideoBoundary(view, { numerator: BigInt(time.num), denominator: BigInt(time.den) }) : ticks(time, sourceRate);
		let sourceShortened = false;
		if (view) {
			const availableEnd = videoBoundaryTime(view, Number(source.sourceFrameCount));
			sourceShortened = compareSourceTimes(exactTime(addRationals(authored.sourceStart, authored.duration)), availableEnd) > 0;
			if (sourceShortened) {
				const retainedDuration = sourceTimeDifference(availableEnd, exactTime(authored.sourceStart));
				const retainedEnd = shiftSourceTime(exactTime(authored.start), retainedDuration);
				sequenceEndFrame = roundRational(retainedEnd.numerator * BigInt(document.rate.num), retainedEnd.denominator * BigInt(document.rate.den), 'point');
			}
		}
		const sourceInFrame = boundary(authored.sourceStart);
		const statedSourceCount = boundary(addRationals(authored.sourceStart, authored.duration)) - sourceInFrame;
		const sourceFrameCount = Math.min(statedSourceCount, Number(source.sourceFrameCount) - sourceInFrame);
		const sequenceFrameCount = !view && sourceFrameCount < statedSourceCount
			? Math.min(sequenceEndFrame - sequenceStartFrame, Math.floor((sequenceEndFrame - sequenceStartFrame) * sourceFrameCount / statedSourceCount)) : sequenceEndFrame - sequenceStartFrame;
		if (sequenceFrameCount <= 0 || sourceFrameCount <= 0) return null;
		return { id, kind: 'video', title: authored.name, sourceId: source.id, sequenceId: 'main-sequence',
			sequenceStartFrame, sequenceFrameCount, sourceInFrame, sourceFrameCount, shortened: sourceShortened || sourceFrameCount < statedSourceCount };
	}
	const timelineStartFrame = ticks(authored.start, { num: sampleRate, den: 1 });
	const durationFrames = ticks(end, { num: sampleRate, den: 1 }) - timelineStartFrame;
	const sourceRate = { num: Number(source.sampleRate), den: 1 };
	const sourceStartFrame = ticks(authored.sourceStart, sourceRate);
	const statedSourceCount = ticks(addRationals(authored.sourceStart, authored.duration), sourceRate) - sourceStartFrame;
	const sourceDurationFrames = Math.min(statedSourceCount, Number(source.frameCount) - sourceStartFrame);
	const retainedDuration = sourceDurationFrames < statedSourceCount ? Math.floor(durationFrames * sourceDurationFrames / statedSourceCount) : durationFrames;
	if (retainedDuration <= 0 || sourceDurationFrames <= 0) return null;
	return { id, kind: 'audio', title: authored.name, sourceId: source.id, timelineStartFrame, durationFrames: retainedDuration,
		sourceStartFrame, sourceDurationFrames, shortened: sourceDurationFrames < statedSourceCount };
}

function ticks(time: Rational, rate: Rational, policy: 'point' | 'enclosingEnd' = 'point'): number {
	const value = multiplyRationals(time, rate);
	return roundRational(value.num, value.den, policy);
}

function exactTime(time: Rational): ExactSourceTime { return { numerator: BigInt(time.num), denominator: BigInt(time.den) }; }

function rebaseEdlCameraOrigin(clip: TimelineInterchangeClip, source: Readonly<Record<string, unknown>>): TimelineInterchangeClip {
	const characteristics = source.characteristics as Readonly<Record<string, unknown>> | undefined;
	const origin = characteristics?.startTimecode as Readonly<Record<string, unknown>> | undefined;
	if (!origin) return clip;
	const rate = source.frameRate as Rational;
	const originFrames = sequenceTimecodeToFrameCount({ negative: origin.negative === true, hours: Number(origin.hours),
		minutes: Number(origin.minutes), seconds: Number(origin.seconds), frames: Number(origin.frames) }, rate, origin.dropFrame === true);
	return { ...clip, sourceStart: subtractRationals(clip.sourceStart, divideRationals(originFrames, rate)) };
}
