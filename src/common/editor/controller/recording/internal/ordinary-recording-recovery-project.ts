/* SPDX-License-Identifier: AGPL-3.0-only */
import { createNonImportedSourceProvenance } from '../../../source-provenance-root.ts';
import type { RecordingRecoveryJournal } from '../../../storage/recording-recovery-journal-repository.ts';
import type { RecordingProject } from '../recording-transaction-types.ts';
import type { RecordedAudioSource, RecordingSegmentPunch } from './recording-finalization-types.ts';
import { readRecordingSourceMetadata } from './recording-metadata-values.ts';
import { SOURCE_CHUNK_FRAMES } from '../../../source-pcm-contract.ts';
import { scaleSampleFrame } from '../../../timeline-time.ts';
import { recordingPunchesWithTransitions } from './recording-punch-transitions.ts';
import { collectProjectStorageKeys } from '../../../retention.js';
import type { ProjectDocument } from '../../../storage/project-repository.ts';

/** Rebuild each checkpoint's exact punch placement from its durable capture alignment. */
export function ordinaryRecordingRecoveryPunches(project: RecordingProject, journal: RecordingRecoveryJournal): readonly RecordingSegmentPunch[] {
	const sampleRate = Number(project.sampleRate) || 48_000;
	const punches: RecordingSegmentPunch[] = [];
	for (const lane of journal.lanes) {
		if (!lane.segments.length) continue;
		const destination = lane.destination;
		const track = project.tracks.find(({ id }) => id === destination.trackId);
		if (!track || track.locked === true) throw new Error('The interrupted recording destination is missing or locked.');
		const lanePunches: RecordingSegmentPunch[] = [];
		for (const [index, segment] of lane.segments.entries()) {
			const sourceEnd = segment.frameStart + segment.frameCount;
			const visibleStart = Math.max(segment.frameStart, destination.sourceOffsetFrames);
			const scale = (frames: number) => scaleSampleFrame(frames, destination.sampleRate, sampleRate, 'point');
			const startFrame = destination.startFrame + scale(visibleStart - destination.sourceOffsetFrames);
			const endFrame = Math.min(destination.startFrame + scale(Math.max(0, sourceEnd - destination.sourceOffsetFrames)),
				destination.selection ? destination.startFrame + destination.selection.endFrame - destination.selection.startFrame : Infinity);
			if (sourceEnd <= visibleStart || endFrame <= startFrame) continue;
			const metadata = readRecordingSourceMetadata(segment.metadata);
			const source: RecordedAudioSource = Object.freeze({ id: segment.sourceId, storageKey: segment.sourceId,
				name: metadata.name, mimeType: 'audio/wav', sampleRate: destination.sampleRate,
				originalSampleRate: destination.sampleRate, sampleFormat: 'float32', chunkFrames: SOURCE_CHUNK_FRAMES,
				frameCount: segment.frameCount, channelCount: metadata.channelCount || 1,
				provenance: createNonImportedSourceProvenance('recorded') });
			const sourceStartFrame = visibleStart - segment.frameStart;
			const availableFrames = segment.frameCount - sourceStartFrame;
			lanePunches.push({ source, punch: { trackId: destination.trackId, startFrame, endFrame,
				sourceId: segment.sourceId, sourceStartFrame,
				sourceDurationFrames: destination.selection ? Math.min(availableFrames,
					Math.max(1, scaleSampleFrame(endFrame - startFrame, sampleRate, destination.sampleRate, 'point'))) : availableFrames,
				clipId: `${journal.id}-${lane.id}-${String(index)}` } });
		}
		punches.push(...recordingPunchesWithTransitions(lanePunches, sampleRate));
	}
	return Object.freeze(punches);
}

export function ordinaryRecordingCheckpointsArePublished(project: ProjectDocument, journal: RecordingRecoveryJournal): boolean {
	const retained = collectProjectStorageKeys(project);
	return journal.lanes.every(({ segments }) => segments.every(({ sourceId }) => retained.has(sourceId)));
}
