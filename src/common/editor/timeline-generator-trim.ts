/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVideoGeneratorClipV1, normalizeVideoStillClipV1, type VideoGeneratorClipV1, type VideoStillClipV1 } from './video-visual-model-v24.ts';
import { generatorSourceWindowSequenceFrames } from './timeline-generator-source-window.ts';
import { sampleFrameToVideoFrame, videoFrameToSampleFrame, type RationalRate } from './timeline-time.ts';

export interface TimelineGeneratorTrimClock {
	readonly sampleRate: number;
	readonly sequences: readonly Readonly<{ id: string; rate: RationalRate }>[];
}

/** A frozen PNG has no source EOF or advancing source window. */
export function prepareTimelineStillTrim(clock: TimelineGeneratorTrimClock, original: VideoStillClipV1,
	changes: Readonly<{ timelineStartFrame?: number; durationFrames?: number }>): VideoStillClipV1 {
	const sequence = clock.sequences.find(item => item.id === original.sequenceId);
	if (!sequence) throw new ReferenceError('A frozen picture trim requires its sequence clock.');
	const end = original.sequenceStartFrame + original.sequenceFrameCount;
	const requestedStart = changes.timelineStartFrame === undefined ? original.sequenceStartFrame
		: sampleFrameToVideoFrame(changes.timelineStartFrame, sequence.rate, clock.sampleRate, 'point');
	const start = Math.max(0, Math.min(end - 1, requestedStart));
	const startSample = videoFrameToSampleFrame(start, sequence.rate, clock.sampleRate, 'point');
	const requestedEnd = changes.durationFrames === undefined ? end
		: sampleFrameToVideoFrame(startSample + Math.max(1, changes.durationFrames), sequence.rate, clock.sampleRate, 'point');
	return normalizeVideoStillClipV1({ ...original, sequenceStartFrame: start,
		sequenceFrameCount: Math.max(1, requestedEnd - start) });
}

/** A generator's sequence edge and native source window move together. */
export function prepareTimelineGeneratorTrim(clock: TimelineGeneratorTrimClock, original: VideoGeneratorClipV1,
	source: Readonly<{ frameCount: number }>, changes: Readonly<{ timelineStartFrame?: number; durationFrames?: number }>): VideoGeneratorClipV1 {
	const sequence = clock.sequences.find(item => item.id === original.sequenceId);
	if (!sequence) throw new ReferenceError('A generator trim requires its sequence clock.');
	const ratio = original.sourceFrameCount / original.sequenceFrameCount;
	const end = original.sequenceStartFrame + original.sequenceFrameCount;
	const requestedStart = changes.timelineStartFrame === undefined ? original.sequenceStartFrame
		: sampleFrameToVideoFrame(changes.timelineStartFrame, sequence.rate, clock.sampleRate, 'point');
	const availableLeft = generatorSourceWindowSequenceFrames(original.sourceInFrame, original);
	const start = Math.max(0, original.sequenceStartFrame - availableLeft, Math.min(end - 1, requestedStart));
	const startSample = videoFrameToSampleFrame(start, sequence.rate, clock.sampleRate, 'point');
	const requestedEnd = changes.durationFrames === undefined ? end
		: sampleFrameToVideoFrame(startSample + Math.max(1, changes.durationFrames), sequence.rate, clock.sampleRate, 'point');
	const sourceInFrame = Math.min(original.sourceInFrame + original.sourceFrameCount - 1,
		Math.max(0, original.sourceInFrame + Math.round((start - original.sequenceStartFrame) * ratio)));
	const maximumCount = Math.max(1, generatorSourceWindowSequenceFrames(source.frameCount - sourceInFrame, original));
	const sequenceFrameCount = Math.max(1, Math.min(maximumCount, requestedEnd - start));
	const sourceFrameCount = Math.max(1, Math.min(source.frameCount - sourceInFrame, Math.round(sequenceFrameCount * ratio)));
	return normalizeVideoGeneratorClipV1({ ...original, sequenceStartFrame: start,
		sequenceFrameCount, sourceInFrame, sourceFrameCount });
}
