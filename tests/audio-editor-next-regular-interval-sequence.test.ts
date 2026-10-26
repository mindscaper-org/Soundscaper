/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { regularIntervalDialogDefaults } from '../src/common/editor/ui/regular-interval-dialog-defaults.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';

for (const primaryFrames of [48_000, 480_000]) test(`regular annotation defaults follow their destination sequence (${primaryFrames} samples)`, () => {
	const project = createSoundscaperProject({ id: 'interval-sequences', sampleRate: 48_000,
		sources: [createAudioSource({ id: 'pcm', frameCount: 480_000, sampleRate: 48_000, channelCount: 1 })],
		clips: [createAudioClip({ id: 'own', sourceId: 'pcm', sourceDurationFrames: primaryFrames, durationFrames: primaryFrames }),
			createAudioClip({ id: 'foreign', sourceId: 'pcm', sourceDurationFrames: 480_000, durationFrames: 480_000 })],
		tracks: [createAudioTrack({ id: 'one', clipIds: ['own'] }), createAudioTrack({ id: 'two', clipIds: ['foreign'] })],
		sequences: [{ id: 'main', trackIds: ['one'] }, { id: 'other', trackIds: ['two'] }], primarySequenceId: 'main',
	});
	const before = structuredClone(project);
	assert.equal(regularIntervalDialogDefaults(project).endFrame, primaryFrames);
	assert.deepEqual(project, before, 'default planning never changes another sequence');
});
