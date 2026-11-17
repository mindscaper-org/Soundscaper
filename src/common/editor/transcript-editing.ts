/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AssistanceTranscript } from './assistance/transcript.ts';
import { resolveRuntimeProjectProjection, type RuntimeClipProject, type RuntimeClipProjection } from './runtime-clip-projection.ts';
import { evaluateAudioWarpMapAtSource } from './audio-warp-domain.ts';
import { addRationals, beatToSampleFrame, roundRational, scaleSampleFrame, type RationalInput } from './timeline-time.ts';
import { readClipLoop } from './audio-clip-loop.ts';

export interface TranscriptEditingBody {
	readonly assetId: string;
	readonly transcript: AssistanceTranscript;
}

export interface TranscriptEditingWord {
	readonly id: string;
	readonly text: string;
	readonly speaker: string | null;
	readonly trackId: string;
	readonly trackName: string;
	readonly clipId: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly granularity: 'word' | 'segment';
	readonly locked: boolean;
}

export interface TranscriptAudioSelection {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds?: readonly string[];
	readonly clipIds?: readonly string[];
}

export interface TranscriptGenerationTarget {
	readonly clipId: string;
	readonly trackId: string;
	readonly startFrame: number;
	readonly endFrame: number;
}

type RecordValue = Readonly<Record<string, unknown>>;
interface TranscriptCoverageRange { readonly start: number; end: number }

/** Selection and transport revisions do not invalidate authenticated source text. */
export function transcriptEditingGeometryKey(value: unknown): string {
	const project = record(value);
	return JSON.stringify([project.id, project.sampleRate, project.primarySequenceId, project.tempoMap,
		project.sequences, project.sources, project.clips, project.assistanceAssets,
		records(project.tracks).map(track => [track.id, track.type, track.name, track.locked, track.clipIds, track.opaqueExtensions])]);
}

export function transcriptEditingProject(value: unknown) {
	const project = record(value);
	if (typeof project.id !== 'string' || !Number.isSafeInteger(project.revision)
		|| !Number.isSafeInteger(project.sampleRate) || Number(project.sampleRate) < 1) {
		throw new TypeError('Transcript editing requires an open audio project.');
	}
	const resolved = resolveRuntimeProjectProjection(project as RuntimeClipProject);
	return { ...resolved, sources: records(project.sources), tracks: records(resolved.tracks),
		assistanceAssets: project.assistanceAssets ?? [],
		id: project.id, revision: Number(project.revision), sampleRate: Number(project.sampleRate) };
}

type EditingProject = ReturnType<typeof transcriptEditingProject>;

/** Source text stays immutable; the current occurrences determine what is visible. */
export function projectTranscriptWords(value: unknown, bodies: readonly TranscriptEditingBody[]): readonly TranscriptEditingWord[] {
	const project = transcriptEditingProject(value);
	const sources = new Map(project.sources.map(source => [source.id, source]));
	return projectWords(project, sources, indexAudioOccurrences(project), bodies);
}

export function projectTranscriptContents(project: EditingProject, bodies: readonly TranscriptEditingBody[],
	missingSources: ReadonlySet<string> = new Set()) {
	const sources = new Map(project.sources.map(source => [source.id, source]));
	const audioClipsByTrack = indexAudioOccurrences(project);
	return {
		words: projectWords(project, sources, audioClipsByTrack, bodies),
		targets: generationTargets(sources, audioClipsByTrack, missingSources),
	};
}

function projectWords(project: EditingProject, sources: ReadonlyMap<unknown, RecordValue>,
	audioClipsByTrack: ReadonlyMap<RecordValue, readonly RuntimeClipProjection[]>,
	bodies: readonly TranscriptEditingBody[]): readonly TranscriptEditingWord[] {
	const words: TranscriptEditingWord[] = [];
	if (!bodies.length) return words;
	const bodiesBySource = new Map<string, TranscriptEditingBody[]>();
	for (const body of bodies) {
		const group = bodiesBySource.get(body.transcript.sourceId);
		if (group) group.push(body);
		else bodiesBySource.set(body.transcript.sourceId, [body]);
	}
	for (const [track, clips] of audioClipsByTrack) {
		const trackId = String(track.id), trackName = typeof track.name === 'string' ? track.name : '', locked = track.locked === true;
		for (const clip of clips) {
			const matchingBodies = typeof clip.sourceId === 'string' ? bodiesBySource.get(clip.sourceId) : undefined;
			if (!matchingBodies || typeof clip.id !== 'string') continue;
			const source = sources.get(clip.sourceId);
			if (!source || !Number.isSafeInteger(source.sampleRate) || !Number.isSafeInteger(source.frameCount)) continue;
			const sourceRate = Number(source.sampleRate);
			const loop = readClipLoop(clip);
			const cycles = loop ? Math.ceil((clip.durationFrames + loop.offsetFrames) / loop.periodFrames) : 1;
			const reversed = clip.reversed === true;
			const map = (frame: number, policy: 'enclosingStart' | 'enclosingEnd'): number => {
				if (clip.warpMap != null) {
					const outer = evaluateAudioWarpMapAtSource(clip.warpMap, frame);
					return clip.anchor === 'musical'
						? beatToSampleFrame(addRationals(clip.musicalStartBeat as RationalInput, outer), project.tempoMap!, project.sampleRate, policy === 'enclosingStart' ? 'enclosingStart' : 'enclosingEnd') - clip.timelineStartFrame
						: roundRational(outer.num, outer.den, policy === 'enclosingStart' ? 'enclosingStart' : 'enclosingEnd');
				}
				return scaleSampleFrame(reversed ? clip.sourceEndFrame - frame : frame - clip.sourceStartFrame,
					clip.sourceDurationFrames, loop?.periodFrames ?? clip.durationFrames, policy === 'enclosingStart' ? 'enclosingStart' : 'enclosingEnd');
			};
			let covered: readonly TranscriptCoverageRange[] = [];
			for (const body of matchingBodies) {
				if (body.transcript.sampleRate !== sourceRate) continue;
				// Admitted segments are disjoint within one body. Only higher-priority bodies can mask its words.
				const bodyCoverage: TranscriptCoverageRange[] = [];
				for (const [segmentIndex, segment] of body.transcript.segments.entries()) {
					const start = Math.max(segment.startFrame, clip.sourceStartFrame);
					const end = Math.min(segment.endFrame, clip.sourceEndFrame);
					if (end <= start) continue;
					const timed = segment.words.length > 0 && segment.words.every(word => word.endFrame > word.startFrame);
					const tokens = timed ? segment.words : [segment];
					for (const [wordIndex, word] of tokens.entries()) {
						const from = Math.max(word.startFrame, clip.sourceStartFrame);
						const to = Math.min(word.endFrame, clip.sourceEndFrame);
						if (to <= from || overlapsTranscriptCoverage(covered, from, to)) continue;
						const localStart = map(reversed ? to : from, 'enclosingStart');
						const localEnd = map(reversed ? from : to, 'enclosingEnd');
						for (let cycle = 0; cycle < cycles; cycle += 1) {
							const offset = loop ? cycle * loop.periodFrames - loop.offsetFrames : 0;
							const startFrame = clip.timelineStartFrame + Math.max(0, Math.floor(localStart + offset));
							const endFrame = clip.timelineStartFrame + Math.min(clip.durationFrames, Math.ceil(localEnd + offset));
							if (endFrame <= startFrame) continue;
							words.push({ id: JSON.stringify([clip.id, body.assetId, segmentIndex, wordIndex, cycle]),
								text: word.text, speaker: segment.speaker, trackId, trackName, clipId: clip.id,
								startFrame, endFrame, granularity: timed ? 'word' : 'segment', locked });
						}
					}
					bodyCoverage.push({ start, end });
				}
				covered = mergeTranscriptCoverage(covered, bodyCoverage);
			}
		}
	}
	const clipStarts = new Map(project.clips.map(clip => [String(clip.id), clip.timelineStartFrame]));
	const trackOrder = new Map(project.tracks.map((track, index) => [String(track.id), index]));
	return words.sort((left, right) => clipStarts.get(left.clipId)! - clipStarts.get(right.clipId)!
		|| trackOrder.get(left.trackId)! - trackOrder.get(right.trackId)! || left.clipId.localeCompare(right.clipId) || left.startFrame - right.startFrame);
}

function overlapsTranscriptCoverage(covered: readonly TranscriptCoverageRange[], start: number, end: number): boolean {
	let low = 0;
	let high = covered.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (covered[middle]!.end <= start) low = middle + 1;
		else high = middle;
	}
	return low < covered.length && covered[low]!.start < end;
}

function mergeTranscriptCoverage(previous: readonly TranscriptCoverageRange[], current: readonly TranscriptCoverageRange[]): readonly TranscriptCoverageRange[] {
	if (previous.length === 0) return current;
	if (current.length === 0) return previous;
	const merged: TranscriptCoverageRange[] = [];
	let previousIndex = 0;
	let currentIndex = 0;
	while (previousIndex < previous.length || currentIndex < current.length) {
		const takePrevious = currentIndex === current.length
			|| (previousIndex < previous.length && previous[previousIndex]!.start <= current[currentIndex]!.start);
		const range = takePrevious ? previous[previousIndex++]! : current[currentIndex++]!;
		const last = merged.at(-1);
		if (last && last.end >= range.start) last.end = Math.max(last.end, range.end);
		else merged.push({ ...range });
	}
	return merged;
}

export function transcriptTextSelection(words: readonly TranscriptEditingWord[]) {
	if (!words.length) return null;
	let startFrame = Infinity, endFrame = 0;
	const trackIds = new Set<string>(), clipIds = new Set<string>();
	for (const word of words) {
		startFrame = Math.min(startFrame, word.startFrame);
		endFrame = Math.max(endFrame, word.endFrame);
		trackIds.add(word.trackId);
		clipIds.add(word.clipId);
	}
	return { startFrame, endFrame, trackIds: [...trackIds], clipIds: [...clipIds] };
}

export function transcriptAudioSelection(words: readonly TranscriptEditingWord[], selection: TranscriptAudioSelection | null | undefined) {
	if (!selection || selection.endFrame <= selection.startFrame) return [];
	const tracks = selection.trackIds?.length ? new Set(selection.trackIds) : null;
	const clips = selection.clipIds?.length ? new Set(selection.clipIds) : null;
	return words.filter(word => word.startFrame < selection.endFrame && word.endFrame > selection.startFrame
		&& (!tracks || tracks.has(word.trackId)) && (!clips || clips.has(word.clipId)));
}

/** Include muted and hidden audio: generation is about the project, not its mix. */
export function transcriptGenerationTargets(value: unknown, missingSources: ReadonlySet<string> = new Set()): readonly TranscriptGenerationTarget[] {
	const project = transcriptEditingProject(value);
	const sources = new Map(project.sources.map(source => [source.id, source]));
	return generationTargets(sources, indexAudioOccurrences(project), missingSources);
}

function generationTargets(sources: ReadonlyMap<unknown, RecordValue>,
	audioClipsByTrack: ReadonlyMap<RecordValue, readonly RuntimeClipProjection[]>,
	missingSources: ReadonlySet<string>): readonly TranscriptGenerationTarget[] {
	const targets: TranscriptGenerationTarget[] = [];
	for (const [track, clips] of audioClipsByTrack) {
		if (track.locked === true) continue;
		const trackId = String(track.id);
		for (const clip of clips) {
			const source = sources.get(clip.sourceId);
			if (source && (source.kind ?? 'audio') === 'audio' && !missingSources.has(String(clip.sourceId))) {
				targets.push({ clipId: String(clip.id), trackId, startFrame: clip.timelineStartFrame, endFrame: clip.timelineEndFrame });
			}
		}
	}
	return targets;
}

function indexAudioOccurrences(project: EditingProject): ReadonlyMap<RecordValue, readonly RuntimeClipProjection[]> {
	const byId = new Map<unknown, RuntimeClipProjection[][]>();
	const byTrack = new Map<RecordValue, RuntimeClipProjection[]>();
	for (const track of project.tracks) {
		if (track.type !== 'audio' || !Array.isArray(track.clipIds) || !track.clipIds.length) continue;
		const clips: RuntimeClipProjection[] = [];
		byTrack.set(track, clips);
		for (const id of new Set<unknown>(track.clipIds)) {
			const destinations = byId.get(id);
			if (destinations) destinations.push(clips);
			else byId.set(id, [clips]);
		}
	}
	for (const clip of project.clips) {
		if (clip.kind !== 'audio') continue;
		const destinations = byId.get(clip.id);
		if (destinations) for (const clips of destinations) clips.push(clip);
	}
	return byTrack;
}

function record(value: unknown): RecordValue {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}

function records(value: unknown): readonly RecordValue[] {
	return Array.isArray(value) ? value.map(record) : [];
}
