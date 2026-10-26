/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareTimelineGeneratorTrim, prepareTimelineStillTrim, type TimelineGeneratorTrimClock } from '../../timeline-generator-trim.ts';
import { videoFrameToSampleFrame } from '../../timeline-time.ts';
import { normalizeVideoGeneratorClipV1, normalizeVideoStillClipV1 } from '../../video-visual-model-v24.ts';
import type { TimelineTrimPointerSession } from './trim-pointer-routing.ts';

interface GeneratorPreviewProject extends TimelineGeneratorTrimClock {
	readonly sources: readonly Readonly<Record<string, unknown>>[];
	readonly tracks: readonly Readonly<{ id: string; clipIds?: readonly string[] }>[];
}

/** Preview the same exact generator window that the owning command will publish. */
export function createGeneratorTrimPointerPreview(project: GeneratorPreviewProject, session: TimelineTrimPointerSession,
	edge: 'left' | 'right', boundary: number): Readonly<Record<string, unknown>> {
	const source = project.sources.find(item => item.id === session.original.sourceId);
	const record = session.original;
	if (!source || source.kind !== record.kind || (record.kind === 'generator' && typeof source.frameCount !== 'number')) {
		throw new ReferenceError('A visual preview requires its native source.');
	}
	const base = { schemaVersion: 1, kind: record.kind, id: record.id,
		sourceId: record.sourceId, sequenceId: record.sequenceId, sequenceStartFrame: record.sequenceStartFrame,
		sequenceFrameCount: record.sequenceFrameCount };
	const changes = edge === 'left' ? { timelineStartFrame: boundary } : { durationFrames: boundary - Number(record.timelineStartFrame) };
	const clip = record.kind === 'still' ? prepareTimelineStillTrim(project, normalizeVideoStillClipV1(base), changes)
		: prepareTimelineGeneratorTrim(project, normalizeVideoGeneratorClipV1({ ...base,
			sourceInFrame: record.sourceInFrame, sourceFrameCount: record.sourceFrameCount }), { frameCount: Number(source.frameCount) }, changes);
	const sequence = project.sequences.find(item => item.id === clip.sequenceId)!;
	const start = videoFrameToSampleFrame(clip.sequenceStartFrame, sequence.rate, project.sampleRate, 'point');
	const end = videoFrameToSampleFrame(clip.sequenceStartFrame + clip.sequenceFrameCount, sequence.rate, project.sampleRate, 'point');
	const preview = { ...clip, clipId: clip.id, trackId: project.tracks.find(track => track.clipIds?.includes(clip.id))?.id,
		timelineStartFrame: start, durationFrames: end - start, waveformPreviewKind: 'trim',
		sourceStartFrame: clip.kind === 'still' ? 0 : clip.sourceInFrame,
		sourceDurationFrames: clip.kind === 'still' ? clip.sequenceFrameCount : clip.sourceFrameCount };
	return { ...preview, previews: [preview] };
}
