import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { exportClipMixer } from '../src/common/editor/export-clip-mixer.ts';
import { exportSequenceMixer } from '../src/common/editor/export-sequence-mixer.ts';
import { mixerDetectorInputClosure } from '../src/common/editor/mixer-detector-input-closure.ts';
import { createExportClipProject } from '../src/common/editor/export-clips.ts';
import type { MixerEdgeV21, MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';

function route(id: string, source: MixerEdgeV21['source'], destination: MixerEdgeV21['destination']): MixerEdgeV21 {
	return { id, kind: destination.kind === 'effect-sidechain' ? 'sidechain' : 'assignment', source, destination,
		position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] };
}
function chain(depth: number) {
	const base = createSoundscaperProject({ id: 'routing-work', tracks: [{ id: 'audio', clipIds: [] }, { id: 'foreign', clipIds: [] }] });
	const groups = Array.from({ length: depth }, (_, index) => ({ id: `g${index}`, name: `Group ${index}`, color: '#555555',
		gain: 1, pan: 0, mute: false, solo: false, collapsed: false, effectsActive: true, effects: [], channelCount: 2 }));
	const edges = [route('audio-group', { kind: 'track', id: 'audio' }, { kind: 'mixer-node', id: 'g0' }),
		...groups.map((group, index) => route(`group-${index}`, { kind: 'mixer-node', id: group.id },
			index === depth - 1 ? { kind: 'master' } : { kind: 'mixer-node', id: `g${index + 1}` })),
		route('master-main', { kind: 'master' }, { kind: 'output', id: 'main' })];
	return createSoundscaperProject({ ...base, mixer: { ...base.mixer, groups, edges: [...edges,
		route('foreign-master', { kind: 'track', id: 'foreign' }, { kind: 'master' })] } });
}
function observed(graph: MixerGraphV21) {
	let reads = 0;
	return { graph: { ...graph, edges: graph.edges.map(edge => ({ ...edge,
		get source() { reads++; return edge.source; }, get destination() { reads++; return edge.destination; },
	})) }, reads: () => reads };
}

test('clip outgoing and detector incoming closures visit long reversed chains a bounded number of times', () => {
	const project = chain(500);
	const outgoing = observed({ ...project.mixer, edges: [...project.mixer.edges].reverse() });
	const isolated = exportClipMixer(outgoing.graph, 'audio');
	assert.deepEqual([...isolated.retainedEdges].sort(), project.mixer.edges.filter(edge => edge.id !== 'foreign-master').map(edge => edge.id).sort());
	assert.ok(outgoing.reads() < project.mixer.edges.length * 12, `${outgoing.reads()} outgoing endpoint reads`);
	const incoming = observed(project.mixer);
	const detector = mixerDetectorInputClosure(incoming.graph, { kind: 'master' });
	assert.equal(detector.strips.size, 503);
	assert.equal(detector.edgeIds.size, 502);
	assert.ok(incoming.reads() < project.mixer.edges.length * 12, `${incoming.reads()} incoming endpoint reads`);
});

test('sequence routing reuses adjacency and preserves authored edge order while retiring foreign strips', () => {
	const base = chain(500);
	const project = { ...base, mixer: { ...base.mixer, edges: [...base.mixer.edges].reverse() } };
	let visits = 0;
	const original = Set.prototype.has;
	Set.prototype.has = function(this: Set<unknown>, value: unknown): boolean { visits++; return Reflect.apply(original, this, [value]) as boolean; };
	try {
		const result = exportSequenceMixer(project, new Set(['audio'])) as { mixer: MixerGraphV21 };
		assert.deepEqual(result.mixer.edges.map(edge => edge.id), project.mixer.edges.filter(edge => edge.id !== 'foreign-master').map(edge => edge.id));
		assert.equal(result.mixer.groups.length, 500);
		assert.ok(visits < 30_000, `${visits} sequence closure membership lookups`);
	} finally { Set.prototype.has = original; }
});

test('clip export retires disabled detector inputs and preserves enabled muted control recordings', () => {
	const controlClips = Array.from({ length: 100 }, (_, index) => ({ id: `control-${index}`, sourceId: 'source',
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 64, durationFrames: 64 }));
	const base = createSoundscaperProject({ id: 'detector-work',
		sources: [{ id: 'source', storageKey: 'source', frameCount: 64, channelCount: 2, sampleRate: 48_000 }],
		tracks: [{ id: 'voice', clipIds: ['voice-clip'], effects: [{ id: 'limit', type: 'limiter', params: {} }] },
			{ id: 'control', mute: true, clipIds: controlClips.map(clip => clip.id) }],
		clips: [{ id: 'voice-clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 64, durationFrames: 64 }, ...controlClips] });
	for (const enabled of [false, true]) {
		const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, edges: [...base.mixer.edges,
			{ ...route('detector', { kind: 'track', id: 'control' }, { kind: 'effect-sidechain', strip: { kind: 'track', id: 'voice' }, effectId: 'limit' }), enabled }] } });
		const isolated = createExportClipProject(project, { trackId: 'voice', clipId: 'voice-clip' });
		assert.deepEqual(isolated.clips.map(clip => clip.id), enabled ? ['voice-clip', ...controlClips.map(clip => clip.id)] : ['voice-clip']);
		assert.equal(isolated.mixer.edges.find(edge => edge.id === 'detector')?.enabled, enabled);
		assert.equal(isolated.mixer.edges.find(edge => edge.source.kind === 'track' && edge.source.id === 'control' && edge.kind === 'assignment')?.level, 0);
		assert.equal(isolated.tracks.find(track => track.id === 'control')?.mute, true);
	}
});
