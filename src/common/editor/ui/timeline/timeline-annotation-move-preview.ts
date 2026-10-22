/* SPDX-License-Identifier: AGPL-3.0-only */

import { createIndexedBeatFrameProjector } from '../../indexed-tempo-projector.ts';
import type { RuntimeTimelineAnnotationProjection } from '../../runtime-timeline-annotation-projection.ts';
import { sampleFrameToBeat } from '../../timeline-tempo-inverse.ts';
import { addRationals, beatToSampleFrame, compareRationals, subtractRationals,
	type HoldTempoMap, type Rational } from '../../timeline-time.ts';

/** Match native move-many: sample anchors share samples; musical anchors share the primary beat delta. */
export function planTimelineAnnotationMove(
	project: Readonly<{ sampleRate: number; tempoMap?: HoldTempoMap }>,
	annotations: readonly RuntimeTimelineAnnotationProjection[],
	primaryId: string,
	requestedDelta: number,
) {
	const primary = annotations.find(annotation => annotation.id === primaryId);
	if (!primary) throw new ReferenceError('The primary annotation must belong to the move.');
	if (!Number.isSafeInteger(requestedDelta)) throw new RangeError('Annotation move delta must count whole samples.');
	let minimumSample = primary.timelineStartFrame;
	let maximumEnd = primary.timelineEndFrame;
	let minimumBeat: Rational | null = null;
	for (const annotation of annotations) {
		maximumEnd = Math.max(maximumEnd, annotation.timelineEndFrame);
		if (annotation.anchor === 'sample') minimumSample = Math.min(minimumSample, annotation.timelineStartFrame);
		else {
			const start = annotation.kind === 'marker' ? annotation.positionBeat : annotation.startBeat;
			if (minimumBeat === null || compareRationals(start, minimumBeat) < 0) minimumBeat = start;
		}
	}
	let deltaFrames = Math.max(-minimumSample, Math.min(Number.MAX_SAFE_INTEGER - maximumEnd, requestedDelta));
	let beatDelta: Rational | null = null;
	let projectBeat: ((beat: Rational) => number) | null = null;
	if (minimumBeat !== null) {
		const tempoMap = project.tempoMap;
		if (!tempoMap) throw new TypeError('Musical annotation moves require the project tempo map.');
		const origin = sampleFrameToBeat(primary.timelineStartFrame, tempoMap, project.sampleRate);
		beatDelta = subtractRationals(sampleFrameToBeat(primary.timelineStartFrame + deltaFrames, tempoMap, project.sampleRate), origin);
		if (compareRationals(addRationals(minimumBeat, beatDelta), 0) < 0) {
			// Round the legal primary boundary inward so a fractional-sample limit
			// cannot put an exact musical peer on the negative side of beat zero.
			const destination = beatToSampleFrame(subtractRationals(origin, minimumBeat), tempoMap, project.sampleRate, 'enclosingEnd');
			deltaFrames = destination - primary.timelineStartFrame;
			beatDelta = subtractRationals(sampleFrameToBeat(destination, tempoMap, project.sampleRate), origin);
		}
		projectBeat = createIndexedBeatFrameProjector(tempoMap, project.sampleRate);
	}
	const ranges = new Map<string, Readonly<{ startFrame: number; endFrame: number }>>();
	for (const annotation of annotations) {
		if (annotation.anchor === 'musical' && beatDelta && projectBeat) {
			const start = annotation.kind === 'marker' ? annotation.positionBeat : annotation.startBeat;
			const end = annotation.kind === 'marker' ? annotation.positionBeat : annotation.endBeat;
			ranges.set(annotation.id, { startFrame: projectBeat(addRationals(start, beatDelta)), endFrame: projectBeat(addRationals(end, beatDelta)) });
		} else ranges.set(annotation.id, { startFrame: annotation.timelineStartFrame + deltaFrames, endFrame: annotation.timelineEndFrame + deltaFrames });
	}
	return { deltaFrames: deltaFrames || 0, ranges };
}
