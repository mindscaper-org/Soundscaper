/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AssistanceTranscript } from './assistance/transcript.ts';
import { resolveRuntimeProjectProjection, type RuntimeClipProject } from './runtime-clip-projection.ts';
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

/** Source text stays immutable; the current occurrences determine what is visible. */
export function projectTranscriptWords(value: unknown, bodies: readonly TranscriptEditingBody[]): readonly TranscriptEditingWord[] {
	const project = transcriptEditingProject(value);
	const sources = new Map(records(project.sources).map(source => [source.id, source]));
	const words: TranscriptEditingWord[] = [];
	for (const track of records(project.tracks)) {
		if (track.type !== 'audio' || !Array.isArray(track.clipIds)) continue;
		const ids = new Set(track.clipIds);
		for (const clip of project.clips) {
			if (clip.kind !== 'audio' || !ids.has(clip.id) || typeof clip.id !== 'string') continue;
			const source = sources.get(clip.sourceId);
			if (!source || !Number.isSafeInteger(source.sampleRate) || !Number.isSafeInteger(source.frameCount)) continue;
			const sourceRate = Number(source.sampleRate);
			const loop = readClipLoop(clip);
			const map = (frame: number, policy: 'enclosingStart' | 'enclosingEnd'): number => {
				if (clip.warpMap != null) {
					const outer = evaluateAudioWarpMapAtSource(clip.warpMap, frame);
					return clip.anchor === 'musical'
						? beatToSampleFrame(addRationals(clip.musicalStartBeat as RationalInput, outer), project.tempoMap!, project.sampleRate, policy === 'enclosingStart' ? 'enclosingStart' : 'enclosingEnd') - clip.timelineStartFrame
						: roundRational(outer.num, outer.den, policy === 'enclosingStart' ? 'enclosingStart' : 'enclosingEnd');
				}
				return scaleSampleFrame(clip.reversed === true ? clip.sourceEndFrame - frame : frame - clip.sourceStartFrame,
					clip.sourceDurationFrames, loop?.periodFrames ?? clip.durationFrames, policy === 'enclosingStart' ? 'enclosingStart' : 'enclosingEnd');
			};
			let covered: readonly TranscriptCoverageRange[] = [];
			for (const body of bodies) {
				if (body.transcript.sourceId !== clip.sourceId || body.transcript.sampleRate !== sourceRate) continue;
				// Admitted segments are disjoint within one body. Only higher-priority bodies can mask its words.
				const bodyCoverage: TranscriptCoverageRange[] = [];
				for (const [segmentIndex, segment] of body.transcript.segments.entries()) {
					const start = Math.max(segment.startFrame, clip.sourceStartFrame);
					const end = Math.min(segment.endFrame, clip.sourceEndFrame);
					if (end <= start) continue;
					const timed = segment.words.length > 0 && segment.words.every(word => word.endFrame > word.startFrame);
					const tokens = timed ? segment.words : [{ ...segment }];
					for (const [wordIndex, word] of tokens.entries()) {
						const from = Math.max(word.startFrame, clip.sourceStartFrame);
						const to = Math.min(word.endFrame, clip.sourceEndFrame);
						if (to <= from || overlapsTranscriptCoverage(covered, from, to)) continue;
						const localStart = map(clip.reversed === true ? to : from, 'enclosingStart');
						const localEnd = map(clip.reversed === true ? from : to, 'enclosingEnd');
						const cycles = loop ? Math.ceil((clip.durationFrames + loop.offsetFrames) / loop.periodFrames) : 1;
						for (let cycle = 0; cycle < cycles; cycle += 1) {
							const offset = loop ? cycle * loop.periodFrames - loop.offsetFrames : 0;
							const startFrame = clip.timelineStartFrame + Math.max(0, Math.floor(localStart + offset));
							const endFrame = clip.timelineStartFrame + Math.min(clip.durationFrames, Math.ceil(localEnd + offset));
							if (endFrame <= startFrame) continue;
							words.push({ id: JSON.stringify([clip.id, body.assetId, segmentIndex, wordIndex, cycle]),
								text: word.text, speaker: segment.speaker, trackId: String(track.id),
								trackName: typeof track.name === 'string' ? track.name : '', clipId: clip.id,
								startFrame, endFrame, granularity: timed ? 'word' : 'segment', locked: track.locked === true });
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
	return { startFrame: words.reduce((start, word) => Math.min(start, word.startFrame), Infinity),
		endFrame: words.reduce((end, word) => Math.max(end, word.endFrame), 0),
		trackIds: [...new Set(words.map(word => word.trackId))], clipIds: [...new Set(words.map(word => word.clipId))] };
}

export function transcriptAudioSelection(words: readonly TranscriptEditingWord[], selection: TranscriptAudioSelection | null | undefined) {
	if (!selection || selection.endFrame <= selection.startFrame) return [];
	return words.filter(word => word.startFrame < selection.endFrame && word.endFrame > selection.startFrame
		&& (!selection.trackIds?.length || selection.trackIds.includes(word.trackId))
		&& (!selection.clipIds?.length || selection.clipIds.includes(word.clipId)));
}

/** Include muted and hidden audio: generation is about the project, not its mix. */
export function transcriptGenerationTargets(value: unknown, missingSources: ReadonlySet<string> = new Set()): readonly TranscriptGenerationTarget[] {
	const project = transcriptEditingProject(value);
	const sources = new Map(project.sources.map(source => [source.id, source]));
	return records(project.tracks).flatMap(track => {
		if (track.type !== 'audio' || track.locked === true || !Array.isArray(track.clipIds)) return [];
		const clipIds: readonly unknown[] = track.clipIds;
		return project.clips.filter(clip => clip.kind === 'audio' && clipIds.includes(clip.id)
			&& sources.has(clip.sourceId) && (sources.get(clip.sourceId)!.kind ?? 'audio') === 'audio'
			&& !missingSources.has(String(clip.sourceId))).map(clip => ({ clipId: String(clip.id), trackId: String(track.id),
			startFrame: clip.timelineStartFrame, endFrame: clip.timelineEndFrame }));
	});
}

function record(value: unknown): RecordValue {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}

function records(value: unknown): readonly RecordValue[] {
	return Array.isArray(value) ? value.map(record) : [];
}
