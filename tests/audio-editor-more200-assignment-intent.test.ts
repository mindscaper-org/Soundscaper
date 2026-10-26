/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';

for (const custom of [false, true]) for (const level of [1, .4]) test(`ordinary selection preserves the authored direct assignment (custom=${String(custom)}, level=${String(level)})`, () => {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
	const base = createSoundscaperProject({ sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, edges: base.mixer.edges.map(edge => edge.source.kind === 'track'
		? { ...edge, id: custom ? 'reviewed-voice-output' : edge.id, level } : edge) } });
	const selected = applySoundscaperProjectCommand(project, { type: 'selection/set', startFrame: 0, endFrame: 4800, trackIds: ['voice'], clipIds: ['clip'] });
	assert.deepEqual(selected.mixer.edges, project.mixer.edges);
	assert.deepEqual(project.selection.clipIds, []);
});

test('selection retains an authored send-only programme path without restoring a dry master path', () => {
	const base = createSoundscaperProject({ tracks: [createAudioTrack({ id: 'voice', clipIds: [] })] });
	const send = { id: 'wet', name: 'Wet', color: '#456789', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: false, effectsActive: true, effects: [], channelCount: 2 };
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, sends: [send], edges: [
		...base.mixer.edges.map(edge => edge.source.kind === 'track' ? { ...edge, id: 'wet-only', kind: 'send', level: .4,
			destination: { kind: 'mixer-node', id: send.id } } : edge),
		{ id: 'wet-output', kind: 'assignment', source: { kind: 'mixer-node', id: send.id }, destination: { kind: 'master' },
			position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] },
	] } });
	const selected = applySoundscaperProjectCommand(project, { type: 'selection/set', startFrame: 0, endFrame: 0, trackIds: ['voice'], clipIds: [] });
	assert.deepEqual(selected.mixer.edges, project.mixer.edges);
});
