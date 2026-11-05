/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMixRenderSnapshotV21 } from '../src/common/editor/controller/track-audio/internal/mix-render/mix-render-snapshot-v21.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { normalizeMixerGraphV21, type MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { createProjectVcaGainResolverV21 } from '../src/common/editor/engine/project-strip-control-index-v21.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { projectTrackFolderMediaStateV12 } from '../src/common/editor/track-folder-media-runtime.ts';

function fixture(folder = false, vca = false) {
	const source = createAudioSource({ id: 'source', frameCount: 48000, channelCount: 1 });
	const clips = ['programme', 'key'].map(id => ({ ...createAudioClip({ id: `${id}-clip`, sourceId: source.id,
		durationFrames: 48000 }), timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48000, durationFrames: 48000 }));
	const tracks = ['programme', 'key'].map(id => ({ ...createAudioTrack({ id, name: id, clipIds: [`${id}-clip`],
		mute: !folder, gain: id === 'programme' ? .5 : .25, solo: id === 'programme',
		...(id === 'programme' ? { effects: [{ id: 'gate', type: 'gate', params: {} }] } : {}) }) }));
	const base = createSoundscaperProject({ id: 'muted-key-print', sources: [source], clips, tracks,
		...(folder ? { trackFolders: [{ id: 'folder', name: 'Muted', mute: true }], sequences: [{ id: 'main',
			trackNodes: [{ kind: 'folder', id: 'folder' }, { kind: 'track', id: 'programme', parentFolderId: 'folder' },
				{ kind: 'track', id: 'key', parentFolderId: 'folder' }] }], primarySequenceId: 'main' } : {}) });
	const graph = normalizeMixerGraphV21({ ...base.mixer, edges: [...base.mixer.edges,
		{ id: 'key-feed', kind: 'sidechain', source: { kind: 'track', id: 'key' },
			destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: 'programme' }, effectId: 'gate' },
			position: 'post-fader', enabled: true, level: .5, channelMap: [0] }],
		vcas: vca ? [{ id: 'shared', name: 'Shared', gain: .25, mute: true,
			members: [{ kind: 'track', id: 'programme' }, { kind: 'track', id: 'key' }] },
			{ id: 'mix-render-vca:1', name: 'Existing ID', gain: .5, mute: false, members: [{ kind: 'track', id: 'key' }] }] : [],
	});
	const lane = (id: string) => normalizeAutomationLaneV21({ id: `${id}-mute`,
		address: { kind: 'strip', strip: { kind: 'track', id }, parameterId: 'mute' }, timebase: 'absolute-samples',
		points: [{ id: `${id}-first`, position: 0, value: 1 }, { id: `${id}-last`, position: 24000, value: 0 }], segments: [{ kind: 'hold' }] });
	const authored = createSoundscaperProject({ ...base, mixer: graph, automationLanes: [lane('programme'), lane('key')] });
	// The controller consumer owns scalar playback bounds; native persistence owns their canonical placement.
	const project = { ...authored, clips, tracks: authored.tracks.map(track => ({ ...track })),
		sources: authored.sources.map(item => ({ ...item })),
		mixer: { ...authored.mixer, groups: authored.mixer.groups.map(item => ({ ...item })), sends: authored.mixer.sends.map(item => ({ ...item })) } };
	return { project, graph };
}

for (const mixDown of [false, true]) for (const folder of [false, true]) {
	test(`${mixDown ? 'combined' : 'individual'} print preserves ${folder ? 'inherited' : 'leaf'} detector mute while admitting a muted programme`, () => {
		const f = fixture(folder), before = structuredClone(f.project);
		const target = f.project.tracks.find(track => track.id === 'programme'); assert.ok(target);
		const result = createMixRenderSnapshotV21(f.project, [target], { mixDown, renderEffects: true });
		assert.equal(result.tracks.find(track => track.id === 'programme')?.mute, false);
		assert.equal(result.tracks.find(track => track.id === 'key')?.mute, true);
		assert.equal(result.tracks.find(track => track.id === 'key')?.gain, .25);
		assert.ok(Array.isArray(result.automationLanes));
		assert.deepEqual(result.automationLanes.map(lane => normalizeAutomationLaneV21(lane).id), ['key-mute']);
		assert.equal(projectTrackFolderMediaStateV12(result), result, 'the engine retains this exact folder projection');
		if (!folder) assert.equal(validateSoundscaperProject(result), true);
		assert.deepEqual(structuredClone(f.project), before);
	});
}

test('a mixed muted VCA retains its control gate and both exact authored gain factors without ID collisions', () => {
	const f = fixture(false, true), before = structuredClone(f.project);
	const target = f.project.tracks.find(track => track.id === 'programme'); assert.ok(target);
	const result = createMixRenderSnapshotV21(f.project, [target], { mixDown: true, renderEffects: true });
	const graph: MixerGraphV21 = normalizeMixerGraphV21(result.mixer);
	assert.equal(new Set(graph.vcas.map(vca => vca.id)).size, graph.vcas.length);
	const audible = createProjectVcaGainResolverV21(graph.vcas, true), unmuted = createProjectVcaGainResolverV21(graph.vcas, false);
	assert.equal(audible({ kind: 'track', id: 'programme' }, true), .25);
	assert.equal(audible({ kind: 'track', id: 'key' }, true), 0);
	assert.equal(unmuted({ kind: 'track', id: 'key' }, true), .125);
	assert.equal(validateSoundscaperProject(result), true);
	assert.deepEqual(structuredClone(f.project), before);
});
