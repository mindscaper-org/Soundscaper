/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { prepareRecordingPunchSequence } from '../src/common/editor/controller/recording/internal/recording-punch-sequence.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';

test('a multi-checkpoint LP take prepares every segment through its owning Soundscaper command runtime', () => {
	const project = createSoundscaperProject({ id: 'lp-checkpoints', tracks: [createAudioTrack({ id: 'lp-track' })] });
	const segments = [0, 1, 2, 3].map(index => ({
		source: createAudioSource({ id: `checkpoint-${index}`, sampleRate: 48_000, channelCount: 1, frameCount: 480_000 }),
		punch: { trackId: 'lp-track', startFrame: index * 480_000, endFrame: (index + 1) * 480_000,
			sourceId: `checkpoint-${index}`, sourceStartFrame: 0, sourceDurationFrames: 480_000, clipId: `take-${index}` },
	}));
	const commands = prepareRecordingPunchSequence(project, segments, applySoundscaperProjectCommand);
	const recorded = applySoundscaperProjectCommand(project, { type: 'batch', commands });
	assert.equal(recorded.schemaFamily, 'soundscaper');
	assert.deepEqual(recorded.clips.map(clip => [clip.timelineStartFrame, clip.durationFrames]),
		[[0, 480_000], [480_000, 480_000], [960_000, 480_000], [1_440_000, 480_000]]);
	assert.equal(recorded.sources.length, 4);
});

test('checkpoint preparation also preserves the Framescaper document family', () => {
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id: 'framescaper-checkpoints', tracks: [createAudioTrack({ id: 'audio-track' })],
	});
	const segments = [0, 1].map(index => ({
		source: createAudioSource({ id: `checkpoint-${index}`, sampleRate: 48_000, channelCount: 1, frameCount: 480_000 }),
		punch: { trackId: 'audio-track', startFrame: index * 480_000, endFrame: (index + 1) * 480_000,
			sourceId: `checkpoint-${index}`, sourceStartFrame: 0, sourceDurationFrames: 480_000, clipId: `take-${index}` },
	}));
	const applyCommand = (draft: typeof project, command: Parameters<typeof applyFramescaperProjectCommand>[2]) =>
		applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, draft, command);
	const commands = prepareRecordingPunchSequence(project, segments, applyCommand);
	const recorded = applyCommand(project, { type: 'batch', commands });
	assert.equal(recorded.schemaFamily, 'framescaper');
	assert.equal(recorded.sources.length, 2);
	assert.deepEqual(recorded.clips.map(clip => [clip.timelineStartFrame, clip.durationFrames]), [[0, 480_000], [480_000, 480_000]]);
});
