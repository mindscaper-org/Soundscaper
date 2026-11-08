/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnalysisRenderer } from '../src/common/editor/controller/analysis/internal/analysis-renderer.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { normalizeMixerGraphV21, type MixerEdgeV21, type MixerStripV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';

function fixture(mode: 'track' | 'group' | 'send' | 'recursive' | 'master' | 'programme-bus' = 'track', muted = false) {
	const source = createAudioSource({ id: 'audio', frameCount: 48000, channelCount: 1 });
	const tracks = ['programme', 'key', 'other'].map(id => createAudioTrack({ id, name: id, clipIds: [`${id}-clip`],
		...(id === 'programme' || mode === 'recursive' && id === 'key'
			? { effectsActive: true, effects: [createEffect('gate', { id: `${id}-gate` })] } : {}),
		...(id === 'key' ? { mute: muted, gain: .25, pan: -.25 } : {}),
	}));
	const base = createSoundscaperProject({ id: `analysis-key-${mode}`, sources: [source], tracks,
		clips: tracks.map(track => createAudioClip({ id: `${track.id}-clip`, sourceId: source.id, durationFrames: 48000 })),
		master: { gain: .5, effects: [createEffect('delay', { id: 'master-delay' })] } });
	const bus: MixerStripV21 = { id: 'key-bus', name: 'Key bus', color: '#ffffff', channelCount: 2,
		gain: .5, pan: .2, mute: false, solo: false, collapsed: false, effectsActive: true,
		effects: mode === 'programme-bus' ? [createEffect('gate', { id: 'bus-gate' })] : [] };
	const key: MixerEdgeV21 = { id: 'key-feed', kind: 'sidechain',
		source: mode === 'group' || mode === 'send' ? { kind: 'mixer-node', id: bus.id }
			: mode === 'master' ? { kind: 'master' } : { kind: 'track', id: 'key' },
		destination: mode === 'programme-bus'
			? { kind: 'effect-sidechain', strip: { kind: 'mixer-node', id: bus.id }, effectId: 'bus-gate' }
			: { kind: 'effect-sidechain', strip: { kind: 'track', id: 'programme' }, effectId: 'programme-gate' },
		position: 'post-fader', level: .75, enabled: true, channelMap: [0] };
	const edges: MixerEdgeV21[] = [...base.mixer.edges.map(edge => mode === 'master' && edge.source.kind === 'track' && edge.source.id === 'programme'
		? { ...edge, destination: { kind: 'output' as const, id: 'main' } }
		: mode === 'programme-bus' && edge.source.kind === 'track' && edge.source.id === 'programme'
			? { ...edge, destination: { kind: 'mixer-node' as const, id: bus.id } } : edge), key];
	if (mode === 'programme-bus') edges.push({ id: 'programme-bus-output', kind: 'assignment', source: { kind: 'mixer-node', id: bus.id },
		destination: { kind: 'master' }, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] });
	if (mode === 'group' || mode === 'send') edges.push({ id: 'bus-input', kind: 'send', source: { kind: 'track', id: 'key' },
		destination: { kind: 'mixer-node', id: bus.id }, position: 'post-fader', level: .5, enabled: true, channelMap: [0, 0] });
	if (mode === 'recursive') edges.push({ ...key, id: 'nested-key', source: { kind: 'track', id: 'other' },
		destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: 'key' }, effectId: 'key-gate' } });
	const keyProgramme = edges.find(edge => edge.source.kind === 'track' && edge.source.id === 'key' && edge.destination.kind === 'master');
	assert.ok(keyProgramme);
	const lane = normalizeAutomationLaneV21({ id: 'key-programme-level', address: { kind: 'edge', edgeId: keyProgramme.id, parameterId: 'level' },
		timebase: 'absolute-samples', points: [{ id: 'edge-point', position: 0, value: 1 }], segments: [] });
	const controlLane = normalizeAutomationLaneV21({ ...lane, id: 'key-feed-level',
		address: { kind: 'edge', edgeId: key.id, parameterId: 'level' }, points: [{ id: 'key-edge-point', position: 0, value: .5 }] });
	const muteLane = normalizeAutomationLaneV21({ ...lane, id: 'key-mute',
		address: { kind: 'strip', strip: { kind: 'track', id: 'key' }, parameterId: 'mute' },
		points: [{ id: 'key-mute-point', position: 0, value: muted ? 1 : 0 }] });
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, edges,
		groups: mode === 'group' || mode === 'programme-bus' ? [bus] : [], sends: mode === 'send' ? [bus] : [] }, automationLanes: [lane, controlLane, muteLane] });
	type Project = typeof project;
	let rendered: Project | null = null;
	const audio = { sampleRate: 48000, numberOfChannels: 2, length: 48000, getChannelData: () => new Float32Array(48000) };
	const render = createAnalysisRenderer({ getProject: () => project, getSelectedTrackId: () => 'programme', cloneProject: (value: Project) => structuredClone(value),
		projectSampleRate: () => 48000, hasMissingTimelineSources: () => false, sourceBuffers: new Map(),
		copy: { localSourcesMissing: 'Missing', audioTrackRequired: 'Track', analysisScopeInvalid: 'Scope' },
		renderSnapshot: async snapshot => { rendered = snapshot; return audio; } });
	const normalized = normalizeMixerGraphV21(project.mixer);
	return { project, key, keyProgramme, bus: normalized.groups[0] ?? normalized.sends[0] ?? bus,
		render, snapshot: () => { assert.ok(rendered); return rendered; } };
}

for (const mode of ['track', 'group', 'send', 'recursive', 'master', 'programme-bus'] as const) test(`track analysis retains its authored ${mode} detector without its programme contribution`, async () => {
	const f = fixture(mode), before = structuredClone(f.project);
	await f.render('track', { startFrame: 0, endFrame: 48000 });
	const actual = f.snapshot(), graph = normalizeMixerGraphV21(actual.mixer);
	assert.equal(actual.tracks.find(track => track.id === 'key')?.mute, false);
	assert.equal(actual.tracks.find(track => track.id === 'key')?.gain, .25);
	assert.equal(graph.edges.find(edge => edge.id === f.key.id)?.level, f.key.level);
	assert.ok(actual.automationLanes.some(candidate => candidate.id === 'key-feed-level'));
	assert.ok(actual.automationLanes.some(candidate => candidate.id === 'key-mute'));
	assert.equal(graph.edges.find(edge => edge.id === f.keyProgramme.id)?.level, mode === 'master' ? 1 : 0,
		'only an authored dependency on the Master retains this programme feed');
	if (mode === 'group' || mode === 'send') {
		assert.deepEqual((mode === 'group' ? graph.groups : graph.sends)[0], f.bus);
		assert.equal(graph.edges.find(edge => edge.id === 'bus-input')?.level, .5);
	}
	if (mode === 'programme-bus') {
		assert.deepEqual(graph.groups[0], f.bus);
		assert.equal(graph.edges.find(edge => edge.id === 'programme-bus-output')?.level, 1);
	}
	if (mode === 'recursive') {
		assert.equal(actual.tracks.find(track => track.id === 'other')?.mute, false);
		assert.equal(graph.edges.find(edge => edge.id === 'nested-key')?.level, .75);
	}
	if (mode === 'master') {
		assert.deepEqual(actual.master, f.project.master);
		assert.equal(graph.edges.find(edge => edge.source.kind === 'master' && edge.destination.kind === 'output')?.level, 0);
	} else {
		assert.deepEqual(actual.master.effects, []);
		assert.equal(actual.master.gain, 1);
		assert.equal(actual.automationLanes.some(candidate => candidate.id === 'key-programme-level'), false);
	}
	assert.doesNotThrow(() => createSoundscaperProject(actual));
	assert.deepEqual(structuredClone(f.project), before);
});

test('an intentionally muted post-fader key remains muted and master analysis stays authored', async () => {
	const f = fixture('track', true), before = structuredClone(f.project);
	await f.render('track', { startFrame: 0, endFrame: 48000 });
	assert.equal(f.snapshot().tracks.find(track => track.id === 'key')?.mute, true);
	assert.equal(f.snapshot().automationLanes.find(candidate => candidate.id === 'key-mute')?.points[0]?.value, 1);
	await f.render('master', { startFrame: 0, endFrame: 48000 });
	assert.deepEqual(f.snapshot(), before);
	assert.deepEqual(structuredClone(f.project), before);
});
