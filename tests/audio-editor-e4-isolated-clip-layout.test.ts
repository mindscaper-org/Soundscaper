/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createIsolatedTrackRenderProjectV21 } from '../src/common/editor/controller/shared/isolated-track-render-project-v21.ts';
import { audacitySelectionChannelCount } from '../src/common/editor/audacity-selection.js';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';

function fixture(width: number) {
	return createSoundscaperProject({ id: `clip-layout-${String(width)}`,
		sources: [createAudioSource({ id: 'mono', channelCount: 1, frameCount: 48000 }), createAudioSource({ id: 'wide', channelCount: width, frameCount: 12000 })],
		clips: [createAudioClip({ id: 'mono-clip', sourceId: 'mono', durationFrames: 48000 }), createAudioClip({ id: 'wide-clip', sourceId: 'wide', durationFrames: 12000 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['mono-clip', 'wide-clip'] })] });
}
for (const width of [2, 6]) test(`selected mono capture does not inherit an unselected ${String(width)}-channel source layout`, () => {
	const runtime = resolveRuntimeProjectProjection(fixture(width));
	const project = { ...runtime, tracks: runtime.tracks.filter(track => track.type === 'audio') };
	const before = structuredClone(project);
	const isolated = createIsolatedTrackRenderProjectV21(project, { trackId: 'voice', effects: [], clipIds: ['mono-clip'] });
	const assignment = isolated.mixer.edges.find(edge => edge.source.kind === 'track'); assert.ok(assignment);
	assert.ok(assignment.channelMap.every(channel => channel < 1), 'the exact mono input cannot supply source channel 1');
	assert.equal(audacitySelectionChannelCount(project, 'voice', 0, 48000, ['mono-clip']), 1);
	assert.equal(audacitySelectionChannelCount(project, 'voice', 0, 48000), width, 'a range still carries every overlapping source channel');
	assert.deepEqual(project, before);
});

test('selecting the wide clip keeps every selected channel and ordinary full-track captures stay wide', () => {
	const runtime = resolveRuntimeProjectProjection(fixture(6));
	const project = { ...runtime, tracks: runtime.tracks.filter(track => track.type === 'audio') };
	for (const clipIds of [undefined, ['wide-clip']]) {
		const isolated = createIsolatedTrackRenderProjectV21(project, { trackId: 'voice', effects: [], clipIds });
		const assignment = isolated.mixer.edges.find(edge => edge.source.kind === 'track'); assert.ok(assignment);
		assert.ok(assignment.channelMap.some(channel => channel === 1));
	}
	assert.equal(audacitySelectionChannelCount(project, 'voice', 0, 48000, ['wide-clip']), 6);
});
