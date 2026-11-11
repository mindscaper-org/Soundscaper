/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createMixRenderSnapshot } from '../src/common/editor/controller/track-audio/mix-render-model.ts';
import { autoTuneControlNotes } from '../src/common/editor/first-party-effects/auto-tune/project-control.ts';
import type { ControllerProject, ControllerTrack } from '../src/common/editor/controller/track-audio/track-domain-types.ts';

for (const mixDown of [false, true]) test(`MIDI control survives ${mixDown ? 'combined' : 'individual'} render narrowing without an audible assignment`, () => {
	const rate = 48000;
	const project = createSoundscaperProject({ id: 'tune', title: 'Tune', sampleRate: rate,
		sources: ['voice-source', 'midi-source'].map(id => createAudioSource({ id, name: id, storageKey: id, mimeType: 'audio/wav', sampleRate: rate, frameCount: rate, channelCount: 1 })),
		clips: [createAudioClip({ id: 'voice-clip', sourceId: 'voice-source', durationFrames: rate }),
			createMidiClip({ id: 'midi-clip', sourceId: 'midi-source', title: 'Notes', durationFrames: rate, sourceDurationFrames: rate,
				notes: [{ id: 'b', startFrame: 0, durationFrames: rate, pitch: 71, channel: 0, velocity: 100 }] })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['voice-clip'], effects: [{ id: 'tune', type: 'auto-tune', params: { controlTrackId: 'midi' } }] }),
			createMidiTrack({ id: 'midi', name: 'Notes', clipIds: ['midi-clip'] })],
	});
	const voice = project.tracks.find(track => track.id === 'voice')!;
	const snapshot = createMixRenderSnapshot(project as unknown as ControllerProject, [voice as unknown as ControllerTrack], { mixDown, renderEffects: true });
	assert.deepEqual(snapshot.tracks.map(track => track.id), ['voice', 'midi']);
	assert.deepEqual(autoTuneControlNotes(snapshot, 'midi', 0, rate, rate), [{ startFrame: 0, endFrame: rate, pitch: 71 }]);
	const mixer = snapshot.mixer as unknown as { edges: readonly { source: { kind: string; id?: string }; level: number }[] };
	assert.ok(mixer.edges.filter(edge => edge.source.kind === 'track' && edge.source.id === 'midi').every(edge => edge.level === 0));
	const dry = createMixRenderSnapshot(project as unknown as ControllerProject, [voice as unknown as ControllerTrack], { mixDown, renderEffects: false });
	assert.deepEqual(dry.tracks.map(track => track.id), ['voice']);
});
