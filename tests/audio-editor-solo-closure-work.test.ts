import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createProjectSoloGainResolverV21 } from '../src/common/editor/engine/project-strip-control-index-v21.ts';
import { compileParallelStackPlan } from '../src/common/editor/engine/parallel-stack-plan.ts';
import { createMixerSignalTopologyV21 } from '../src/common/editor/mixer-signal-topology-v21.ts';
import type { MixerEdgeV21 } from '../src/common/editor/mixer-graph-v21.ts';

function fixture(tracks: number, groups: number) {
	const base = createSoundscaperProject({ id: 'solo-work', tracks: Array.from({ length: tracks }, (_, index) => ({ id: `t${index}`, solo: true, clipIds: [] })) });
	return createSoundscaperProject({ ...base, mixer: { ...base.mixer,
		groups: Array.from({ length: groups }, (_, index) => ({ id: `g${index}`, name: `Group ${index}`,
			color: '#555555', gain: 1, pan: 0, mute: false, solo: false, collapsed: false, effectsActive: true, effects: [], channelCount: 2 })),
		edges: [...base.mixer.edges, ...Array.from({ length: groups }, (_, index): MixerEdgeV21 => ({ id: `g${index}-next`,
			kind: 'assignment', source: { kind: 'mixer-node', id: `g${index}` },
			destination: index === groups - 1 ? { kind: 'master' } : { kind: 'mixer-node', id: `g${index + 1}` },
			position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] }))] } });
}

test('runtime solo resolver builds one shared closure and retains cached finite-key answers', () => {
	const project = fixture(200, 500);
	const keys = [...project.tracks.map(track => `track:${track.id}`), ...project.mixer.groups.map(group => `mixer-node:${group.id}`), 'master'];
	let reads = 0;
	const original = Map.prototype.get;
	Map.prototype.get = function(this: Map<unknown, unknown>, key: unknown): unknown {
		reads++; return Reflect.apply(original, this, [key]);
	};
	try {
		const resolve = createProjectSoloGainResolverV21(project.mixer, project.tracks, true);
		assert.deepEqual(keys.map(key => resolve(key)), keys.map(key => key.startsWith('track:') || key === 'master'));
		assert.ok(reads < 10_000, `${reads} graph/index lookups for ${keys.length} strips`);
		const first = reads;
		keys.forEach(key => resolve(key));
		assert.equal(reads - first, keys.length);
		assert.equal(resolve('absent'), false);
	} finally { Map.prototype.get = original; }
});

test('parallel stack gates use the same bounded solo closure', () => {
	const project = fixture(40, 100);
	let reads = 0;
	const original = Map.prototype.get;
	Map.prototype.get = function(this: Map<unknown, unknown>, key: unknown): unknown {
		reads++; return Reflect.apply(original, this, [key]);
	};
	try {
		const plan = compileParallelStackPlan(project, { sampleRate: 48_000, workerCount: 2 });
		assert.deepEqual(plan.tasks.filter(task => task.kind === 'stack').map(task => [task.key, task.gate]),
		[...project.tracks.map(track => [`track:${track.id}`, 1]), ...project.mixer.groups.map(group => [`mixer-node:${group.id}`, 0]), ['master', 1]]);
		assert.ok(reads < 20_000, `${reads} planning lookups for ${plan.tasks.length} tasks`);
	} finally { Map.prototype.get = original; }
});

test('shared runtime solo closure matches directed relationships across disabled, silent and detector edges', () => {
	const base = fixture(2, 3);
	const graph = { ...base.mixer, edges: base.mixer.edges.map(edge => edge.id === 'g0-next' ? { ...edge, enabled: false }
		: edge.id === 'g1-next' ? { ...edge, channelMap: [-1, -1] } : edge) };
	const tracks = base.tracks.map((track, index) => ({ ...track, solo: index === 0 }));
	const topology = createMixerSignalTopologyV21(graph, { includeOutputs: false });
	const resolver = createProjectSoloGainResolverV21(graph, tracks, true);
	for (const key of ['track:t0', 'track:t1', 'mixer-node:g0', 'mixer-node:g1', 'mixer-node:g2', 'master', 'output:main', 'absent']) {
		assert.equal(resolver(key), topology.reaches(key, 'track:t0') || topology.reaches('track:t0', key));
	}
});
