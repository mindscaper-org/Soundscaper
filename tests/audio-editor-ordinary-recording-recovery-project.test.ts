/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ordinaryRecordingRecoveryPunches } from '../src/common/editor/controller/recording/internal/ordinary-recording-recovery-project.ts';
import { normalizeRecordingRecoveryJournal } from '../src/common/editor/storage/recording-recovery-journal-repository.ts';
import { prepareOrdinaryRecordingRecoveryTarget } from '../src/common/editor/controller/recording/internal/ordinary-recording-recovery-target.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';

test('restart reconstruction preserves routed destinations, latency offsets, and punch selection limits', () => {
	const journal = normalizeRecordingRecoveryJournal({ version: 1, projectId: 'project', id: 'capture', base: { id: 'project' }, decision: null, target: null, targetBase: null,
		lanes: [
			{ id: 'left', destination: { trackId: 'left-track', startFrame: 100, sourceOffsetFrames: 20, sampleRate: 48_000, selection: null },
				segments: [{ sourceId: 'left-1', frameStart: 0, frameCount: 480_000, metadata: { name: 'Left', channelCount: 1 } },
					{ sourceId: 'left-2', frameStart: 480_000, frameCount: 480_000, metadata: { name: 'Left', channelCount: 1 } }] },
			{ id: 'right', destination: { trackId: 'right-track', startFrame: 200, sourceOffsetFrames: 0, sampleRate: 24_000, selection: { startFrame: 200, endFrame: 48_200 } },
				segments: [{ sourceId: 'right-1', frameStart: 0, frameCount: 240_000, metadata: { name: 'Right', channelCount: 1 } }] },
		] });
	const punches = ordinaryRecordingRecoveryPunches({ id: 'project', sampleRate: 48_000, tracks: [{ id: 'left-track' }, { id: 'right-track' }] }, journal);
	assert.equal(punches.length, 3);
	assert.deepEqual(punches.map(({ punch }) => [punch.trackId, punch.startFrame, punch.endFrame, punch.sourceStartFrame, punch.sourceDurationFrames]), [
		['left-track', 100, 480_080, 20, 479_980], ['left-track', 480_080, 960_080, 0, 480_000], ['right-track', 200, 48_200, 0, 24_000],
	]);
	assert.equal(punches[1]?.punch.clipId, 'capture-left-1');
	assert.throws(() => ordinaryRecordingRecoveryPunches({ id: 'project', tracks: [{ id: 'left-track', locked: true }, { id: 'right-track' }] }, journal), /locked/u);
});

test('ordinary recovery uses the product schema and restores missing and locked destinations into new audio tracks', () => {
	const track = createAudioTrack({ id: 'locked-track', locked: true });
	const base = createSoundscaperProject({ id: 'product-project', tracks: [track] });
	const journal = normalizeRecordingRecoveryJournal({ version: 1, projectId: base.id, id: 'capture', base, decision: null, target: null, targetBase: null,
		lanes: ['locked-track', 'missing-track'].map((trackId, index) => ({ id: `lane-${String(index)}`,
			destination: { trackId, startFrame: 120_000, sourceOffsetFrames: 2, sampleRate: 48_000, selection: null },
			segments: [{ sourceId: `checkpoint-${String(index)}`, frameStart: 0, frameCount: 480_000, metadata: { name: 'Microphone', channelCount: 1 } }] })) });
	const target = prepareOrdinaryRecordingRecoveryTarget(base, journal, applySoundscaperProjectCommand, '2026-10-08T12:00:00.000Z', 'Recovered recording');
	assert.equal(target.schemaVersion, 1);
	assert.equal(target.revision, base.revision + 1);
	assert.equal(target.tracks.length, 3);
	assert.deepEqual(target.tracks[0], base.tracks[0]);
	assert.equal(base.clips.length, 0);
	assert.deepEqual(target.sources.map(({ id }) => id), ['checkpoint-0', 'checkpoint-1']);
	const runtime = projectForRuntimeConsumers(target);
	assert.deepEqual(runtime.clips.map(({ timelineStartFrame, durationFrames, sourceStartFrame }) => [timelineStartFrame, durationFrames, sourceStartFrame]), [[120_000, 479_998, 2], [120_000, 479_998, 2]]);
	assert.deepEqual(target.tracks.slice(1).map(({ id, name, locked }) => [id, name, locked]), [
		['capture-lane-0-recovered-track', 'Recovered recording', false], ['capture-lane-1-recovered-track', 'Recovered recording', false],
	]);
	const alreadyAttached = prepareOrdinaryRecordingRecoveryTarget(target, journal, applySoundscaperProjectCommand, '2026-10-08T12:01:00.000Z', 'Recovered recording');
	assert.deepEqual(alreadyAttached, target, 'repairing an already-published recovery must not duplicate checkpoints or destination tracks');
});
