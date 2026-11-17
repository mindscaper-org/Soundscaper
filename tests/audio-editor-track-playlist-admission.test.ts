/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffect } from '../src/common/editor/effects.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand as apply } from '../src/soundscaper/editor-project-commands.ts';

const empty = { type: 'track/playlist-create', trackId: 'a', id: 'empty', name: 'Empty', originalId: 'original', originalName: 'Original', mode: 'empty' } as const;
const activate = { type: 'track/playlist-activate', trackId: 'a', id: 'original' } as const;

test('activating a playlist cannot close an Auto Duck feedback loop introduced by another track', () => {
	let project = createSoundscaperProject({ sources: [{ id: 'source', sampleRate: 48000, frameCount: 512, channelCount: 1 }],
		tracks: ['a', 'b'].map(id => ({ id, type: 'audio', clipIds: [id] })),
		clips: ['a', 'b'].map(id => ({ id, sourceId: 'source', durationFrames: 512 })) });
	project = apply(project, { type: 'effect/add', scope: 'clip', trackId: 'a',
		effect: createEffect('audacity-auto-duck', { context: { controlTrackId: 'b' } }) });
	project = apply(project, empty);
	project = apply(project, { type: 'effect/add', scope: 'clip', trackId: 'b',
		effect: createEffect('audacity-auto-duck', { id: 'b-duck', context: { controlTrackId: 'a' } }) });
	const before = structuredClone(project);
	assert.throws(() => apply(project, activate), /control track|cycle/iu);
	assert.deepEqual(project, before);
	project = apply(project, { type: 'effect/update', scope: 'clip', trackId: 'b', effectId: 'b-duck', changes: { enabled: false } });
	assert.doesNotThrow(() => apply(project, activate));
});

test('activating wide source media cannot overrun a stereo rack added on a different playlist', () => {
	let project = createSoundscaperProject({ sources: [1, 6].map(channelCount => ({ id: `source-${channelCount}`, sampleRate: 48000, frameCount: 512, channelCount })),
		tracks: [{ id: 'a', type: 'audio', clipIds: ['wide'] }], clips: [{ id: 'wide', sourceId: 'source-6', durationFrames: 512 }] });
	project = apply(project, empty);
	project = apply(project, { type: 'clip/add', trackId: 'a', clip: { id: 'mono', sourceId: 'source-1', durationFrames: 512 } });
	project = apply(project, { type: 'effect/add', scope: 'track', trackId: 'a', effect: createEffect('reverb', { id: 'room' }) });
	assert.throws(() => apply(project, activate), /support/iu);
	project = apply(project, { type: 'effect/update', scope: 'track', trackId: 'a', effectId: 'room', changes: { enabled: false } });
	assert.doesNotThrow(() => apply(project, activate));
});
