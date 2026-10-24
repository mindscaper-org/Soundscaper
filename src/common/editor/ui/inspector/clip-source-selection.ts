/* SPDX-License-Identifier: AGPL-3.0-only */
import { clipSourceDisplayRange, clipDisplayFrameToSource, clipSourceFrameToDisplay, type ClipSourceTimingClip, type ClipSourceTimingProject, type ClipSourceTimingSource } from '../../clip-source-timing.ts';
import type { SourceSelection } from './clip-source-editor-types.ts';
import { readClipLoop } from '../../audio-clip-loop.ts';
import { projectUnwarpedClipSourceRange } from '../../audio-clip-source-projection.ts';

/** A destructive edit must touch exactly the contiguous media the highlight represents. */
export function clipSourceSelection(project: ClipSourceTimingProject, clip: ClipSourceTimingClip, source: ClipSourceTimingSource, requested: SourceSelection | null): {
	readonly display: SourceSelection | null; readonly source: SourceSelection;
} {
	const range = clipSourceDisplayRange(clip, source, project.sampleRate);
	if (!requested) return { display: null, source: { startFrame: clip.sourceStartFrame, endFrame: clip.sourceStartFrame + clip.sourceDurationFrames } };
	let startFrame = Math.max(0, Math.min(range.totalFrames - 1, Math.round(requested.startFrame)));
	let endFrame = Math.min(range.totalFrames, Math.round(requested.endFrame));
	if (endFrame <= startFrame) return clipSourceSelection(project, clip, source, null);
	const nativeRate = source.sampleRate / project.sampleRate;
	const sourceEnd = clip.sourceStartFrame + clip.sourceDurationFrames;
	const loop = readClipLoop(clip);
	let first: number;
	let last: number;
	if (endFrame <= range.startFrame) {
		first = startFrame * nativeRate; last = endFrame * nativeRate;
	} else if (startFrame >= range.endFrame) {
		first = sourceEnd + (startFrame - range.endFrame) * nativeRate;
		last = sourceEnd + (endFrame - range.endFrame) * nativeRate;
	} else if ((clip.reversed || loop) && (startFrame < range.startFrame || endFrame > range.endFrame)
		|| loop && (startFrame - range.startFrame + loop.offsetFrames) % loop.periodFrames
			+ endFrame - startFrame > loop.periodFrames) {
		// A reversed or repeated seam has disjoint source runs. Include the whole clip,
		// visibly, so the single-range effect API cannot silently edit other samples.
		startFrame = Math.min(startFrame, range.startFrame);
		endFrame = Math.max(endFrame, range.endFrame);
		first = startFrame < range.startFrame ? startFrame * nativeRate : clip.sourceStartFrame;
		last = endFrame > range.endFrame ? sourceEnd + (endFrame - range.endFrame) * nativeRate : sourceEnd;
	} else if (loop) {
		const projected = projectUnwarpedClipSourceRange({ ...clip, reversed: clip.reversed === true },
			startFrame - range.startFrame, endFrame - range.startFrame);
		first = projected.startFrame; last = projected.endFrame;
	} else {
		first = clipDisplayFrameToSource(project, clip, source, startFrame);
		last = clipDisplayFrameToSource(project, clip, source, endFrame);
	}
	const sourceStart = Math.max(0, Math.min(source.frameCount - 1, Math.round(Math.min(first, last))));
	const sourceFinish = Math.max(sourceStart + 1, Math.min(source.frameCount, Math.round(Math.max(first, last))));
	return { display: { startFrame, endFrame }, source: { startFrame: sourceStart, endFrame: sourceFinish } };
}

/** Recover the highlight from the effect owner's updated native source interval. */
export function clipSourceSelectionDisplay(project: ClipSourceTimingProject, clip: ClipSourceTimingClip, source: ClipSourceTimingSource, selected: SourceSelection): SourceSelection {
	const range = clipSourceDisplayRange(clip, source, project.sampleRate);
	const sourceEnd = clip.sourceStartFrame + clip.sourceDurationFrames;
	const ratio = project.sampleRate / source.sampleRate;
	if (selected.endFrame <= clip.sourceStartFrame) return { startFrame: selected.startFrame * ratio, endFrame: selected.endFrame * ratio };
	if (selected.startFrame >= sourceEnd) return {
		startFrame: range.endFrame + (selected.startFrame - sourceEnd) * ratio,
		endFrame: range.endFrame + (selected.endFrame - sourceEnd) * ratio,
	};
	const loop = readClipLoop(clip);
	if (loop && selected.startFrame >= clip.sourceStartFrame && selected.endFrame <= sourceEnd) {
		if (selected.startFrame === clip.sourceStartFrame && selected.endFrame === sourceEnd) return { startFrame: range.startFrame, endFrame: range.endFrame };
		const progress = (clip.reversed ? sourceEnd - selected.endFrame : selected.startFrame - clip.sourceStartFrame) / clip.sourceDurationFrames;
		const length = (selected.endFrame - selected.startFrame) / clip.sourceDurationFrames * loop.periodFrames;
		const offset = progress * loop.periodFrames - loop.offsetFrames;
		const startFrame = range.startFrame + offset + Math.max(0, Math.ceil(-offset / loop.periodFrames)) * loop.periodFrames;
		return { startFrame, endFrame: startFrame + length };
	}
	const first = clipSourceFrameToDisplay(project, clip, source, selected.startFrame);
	const last = clipSourceFrameToDisplay(project, clip, source, selected.endFrame);
	if ((clip.reversed || readClipLoop(clip)) && (selected.startFrame < clip.sourceStartFrame || selected.endFrame > sourceEnd)) return {
		startFrame: Math.min(first, last, range.startFrame), endFrame: Math.max(first, last, range.endFrame),
	};
	return { startFrame: Math.min(first, last), endFrame: Math.max(first, last) };
}
