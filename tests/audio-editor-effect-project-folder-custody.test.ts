/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { projectWithEffectParams, projectWithParametricEqParams } from '../src/common/editor/engine/project-effects.ts';
import { inheritsTrackFolderMuteV12, isTrackFolderMediaStateProjectionV12, projectTrackFolderMediaStateV12 } from '../src/common/editor/track-folder-media-runtime.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { normalizeMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';

for (const type of ['tremolo', 'eq']) test(`${type} parameter adoption retains exact folder lineage and inherited mute authority`, () => {
	const effect = createEffect(type, { id: 'effect' });
	const source = { ...createAudioSource({ id: 'source', frameCount: 48_000, channelCount: 1 }) };
	const clip = { ...createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 48_000 }),
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000 };
	const track = { ...createAudioTrack({ id: 'track', clipIds: [clip.id] }), effects: [effect] };
	const authored = createSoundscaperProject({ sources: [source], clips: [clip], tracks: [track],
		trackFolders: [{ id: 'folder', name: 'Muted', mute: true }],
		sequences: [{ id: 'main', trackNodes: [{ kind: 'folder', id: 'folder' },
			{ kind: 'track', id: track.id, parentFolderId: 'folder' }] }], primarySequenceId: 'main' });
	const input: EngineProject = { ...authored, sources: [source], clips: [clip], tracks: [track],
		master: { gain: 1, pan: 0, effects: [] }, mixer: normalizeMixerGraphV21(authored.mixer) };
	const projected = projectTrackFolderMediaStateV12(input);
	const before = structuredClone(projected);
	assert.equal(inheritsTrackFolderMuteV12(projected, track.id), true);
	const adopted = type === 'eq'
		? projectWithParametricEqParams(projected, 'track', track.id, effect.id, effect.params)
		: projectWithEffectParams(projected, 'track', track.id, effect.id, { ...effect.params, depth: 50 });
	assert.ok(adopted);
	assert.equal(isTrackFolderMediaStateProjectionV12(adopted), true);
	assert.equal(inheritsTrackFolderMuteV12(adopted, track.id), true);
	assert.deepEqual(structuredClone(projected), before, 'adopting private runtime parameters never mutates its source projection');
	assert.deepEqual(adopted.trackFolders, projected.trackFolders);
	assert.deepEqual(adopted.sequences, projected.sequences);
});
