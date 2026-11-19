/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { clipEffectControlTrackIds } from '../src/common/editor/clip-effect-control-tracks.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createMixRenderSnapshotV21 } from '../src/common/editor/controller/track-audio/internal/mix-render/mix-render-snapshot-v21.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';

function project() {
	const ids = ['music', 'voice', 'cue'];
	return createSoundscaperProject({
		sources: [createAudioSource({ id: 'source', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 })],
		tracks: ids.map(id => createAudioTrack({ id, clipIds: [`${id}-clip`] })),
		clips: ids.map((id, index) => createAudioClip({ id: `${id}-clip`, sourceId: 'source', durationFrames: 48_000,
			effects: index < 2 ? [createEffect('audacity-auto-duck', { id: `${id}-duck`, context: { controlTrackId: ids[index + 1] } })] : [] })),
	});
}

test('Mix and render retains chained clip Auto Duck inputs without mixing the detector tracks into the programme', () => {
	const document = project();
	const runtime = projectForRuntimeConsumers(document);
	assert.deepEqual(clipEffectControlTrackIds(runtime, new Set(['music'])), ['voice', 'cue']);
	const snapshot = createMixRenderSnapshotV21(runtime as unknown as ControllerProject,
		[runtime.tracks.find(track => track.id === 'music')!], { mixDown: false });
	assert.deepEqual(snapshot.tracks.map(track => track.id), ['music', 'voice', 'cue']);
	assert.deepEqual(snapshot.clips.map(clip => clip.id), ['music-clip', 'voice-clip', 'cue-clip']);
	const edges = (snapshot.mixer as unknown as { edges: readonly { source: { kind: string; id?: string }; level: number }[] }).edges;
	for (const id of ['voice', 'cue']) assert.ok(edges.filter(edge => edge.source.kind === 'track' && edge.source.id === id).every(edge => edge.level === 0));
});

test('disabled clip control dependencies stop the closure at the bypassed processor', () => {
	const runtime = projectForRuntimeConsumers(project());
	const bypassed = { ...runtime, clips: runtime.clips.map(clip => clip.id === 'voice-clip' ? { ...clip, effectsActive: false } : clip) };
	assert.deepEqual(clipEffectControlTrackIds(bypassed, new Set(['music'])), ['voice']);
});
