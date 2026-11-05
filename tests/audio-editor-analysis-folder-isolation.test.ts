/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnalysisRenderer } from '../src/common/editor/controller/analysis/internal/analysis-renderer.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { projectTrackFolderMediaStateV12, isTrackFolderMediaStateProjectionV12 } from '../src/common/editor/track-folder-media-runtime.ts';

type Mode = 'muted' | 'nested' | 'peer-solo' | 'muted-key' | 'shared-muted-folder';

function fixture(mode: Mode) {
	const source = createAudioSource({ id: 'audio', frameCount: 48000, channelCount: 1 });
	const sidechain = mode === 'muted-key' || mode === 'shared-muted-folder';
	const tracks = ['programme', 'peer', 'key'].map(id => createAudioTrack({ id, name: id, clipIds: [`${id}-clip`],
		...(sidechain && id === 'programme' ? { effectsActive: true, effects: [createEffect('gate', { id: 'gate' })] } : {}),
	}));
	const folders = [{ id: 'outer', name: 'Outer', mute: mode !== 'peer-solo', solo: mode === 'peer-solo' },
		...(mode === 'nested' ? [{ id: 'inner', name: 'Inner', mute: false, solo: false }] : [])];
	const leaves = [
		{ kind: 'track', id: 'programme', parentFolderId: mode === 'peer-solo' || mode === 'muted-key' ? null : mode === 'nested' ? 'inner' : 'outer' },
		{ kind: 'track', id: 'peer', parentFolderId: mode === 'peer-solo' ? 'outer' : null },
		{ kind: 'track', id: 'key', parentFolderId: sidechain ? 'outer' : null },
	];
	const orderedLeaves = [...leaves.filter(leaf => leaf.parentFolderId !== null), ...leaves.filter(leaf => leaf.parentFolderId === null)];
	const orderedTracks = orderedLeaves.map(leaf => { const track = tracks.find(track => track.id === leaf.id); assert.ok(track); return track; });
	let project = createSoundscaperProject({ id: `analysis-folder-${mode}`, sources: [source], tracks: orderedTracks,
		clips: tracks.map(track => createAudioClip({ id: `${track.id}-clip`, sourceId: source.id, durationFrames: 48000 })),
		trackFolders: folders, primarySequenceId: 'main', sequences: [{ id: 'main', trackNodes: [
			{ kind: 'folder', id: 'outer', parentFolderId: null },
			...(mode === 'nested' ? [{ kind: 'folder', id: 'inner', parentFolderId: 'outer' }] : []),
			...orderedLeaves,
		] }],
	});
	if (sidechain) project = createSoundscaperProject({ ...project, mixer: { ...project.mixer, edges: [...project.mixer.edges, {
		id: 'detector', kind: 'sidechain', source: { kind: 'track', id: 'key' },
		destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: 'programme' }, effectId: 'gate' },
		position: 'post-fader', enabled: true, level: 1, channelMap: [0],
	}] } });
	type Project = typeof project;
	let observed: Project | null = null;
	const render = createAnalysisRenderer({ getProject: () => project, getSelectedTrackId: () => 'programme',
		cloneProject: (value: Project) => structuredClone(value), projectSampleRate: () => 48000,
		hasMissingTimelineSources: () => false, sourceBuffers: new Map(),
		copy: { localSourcesMissing: 'Missing', audioTrackRequired: 'Track', analysisScopeInvalid: 'Scope' },
		renderSnapshot: async snapshot => {
			// The actual engine applies this authority before building its graph.
			observed = projectTrackFolderMediaStateV12(snapshot);
			return { sampleRate: 48000, length: 48000, numberOfChannels: 2, getChannelData: () => new Float32Array(48000) };
		},
	});
	return { project, render, observed: () => { assert.ok(observed); return observed; } };
}

for (const mode of ['muted', 'nested', 'peer-solo', 'shared-muted-folder'] as const) test(`isolated analysis overrides programme audibility from ${mode} ancestry`, async () => {
	const f = fixture(mode), before = structuredClone(f.project);
	await f.render('track', { startFrame: 0, endFrame: 48000 });
	const actual = f.observed();
	assert.equal(actual.tracks.find(track => track.id === 'programme')?.mute, false);
	assert.ok(actual.tracks.every(track => track.type !== 'audio' || !track.solo), 'a peer folder solo cannot gate the selected isolated track');
	assert.ok(isTrackFolderMediaStateProjectionV12(actual), 'the engine must consume the explicit override without reapplying ancestry');
	if (mode === 'shared-muted-folder') assert.equal(actual.tracks.find(track => track.id === 'key')?.mute, true,
		'the post-fader key stays muted even when programme shares its parent');
	assert.deepEqual(structuredClone(f.project), before);
});

test('a detector in another muted folder keeps its effective mute while programme remains isolated', async () => {
	const f = fixture('muted-key');
	await f.render('track', { startFrame: 0, endFrame: 48000 });
	assert.equal(f.observed().tracks.find(track => track.id === 'programme')?.mute, false);
	assert.equal(f.observed().tracks.find(track => track.id === 'key')?.mute, true);
});

test('master analysis retains all authored inherited mute and solo state', async () => {
	for (const mode of ['nested', 'peer-solo', 'shared-muted-folder'] as const) {
		const f = fixture(mode), before = structuredClone(f.project);
		await f.render('master', { startFrame: 0, endFrame: 48000 });
		assert.deepEqual(f.observed().tracks, projectTrackFolderMediaStateV12(f.project).tracks);
		assert.deepEqual(structuredClone(f.project), before);
	}
});
