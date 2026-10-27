import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { buildProjectGraphV21 } from '../src/common/editor/engine/project-graph-v21.ts';
import type { MixerEdgeV21, MixerStripV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { MockAudioContext } from './helpers/mock-audio-context.js';

test('graph build classifies each group, send and cue once and preserves parameter ownership', () => {
	const strips = (kind: string, count: number): MixerStripV21[] => Array.from({ length: count }, (_, index) => ({
		id: `${kind}${index}`, name: `${kind} ${index}`, color: '#555555', gain: 1, pan: 0,
		mute: false, solo: false, collapsed: false, effectsActive: true, effects: [], channelCount: 2,
	}));
	const base = createSoundscaperProject({ id: 'strip-work', tracks: [{ id: 'audio', clipIds: [] }] });
	const groups = strips('group', 200), sends = strips('send', 200), cues = strips('cue', 3);
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, groups, sends, cues,
		edges: [...base.mixer.edges, ...[...groups, ...sends, ...cues].map((strip): MixerEdgeV21 => ({
			id: `${strip.id}-master`, kind: 'assignment', source: { kind: 'mixer-node', id: strip.id },
			destination: { kind: 'master' }, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1],
		}))] } });
	const context = new MockAudioContext();
	let visits = 0;
	const original = Array.prototype.some;
	Array.prototype.some = function<T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, receiver?: unknown): boolean {
		return original.call(this, (value: T, index: number, array: T[]) => { visits++; return predicate.call(receiver, value, index, array); });
	};
	try {
		const graph = buildProjectGraphV21(context as unknown as BaseAudioContext, context.destination as unknown as AudioNode, project, { metering: true });
		assert.deepEqual([...graph.projectGainParams.groups.keys()], groups.map(strip => strip.id));
		assert.deepEqual([...graph.projectGainParams.sends.keys()], [...sends, ...cues].map(strip => strip.id));
		for (const strip of [...groups, ...sends, ...cues]) {
			const parameter = graph.parameterRegistry.get({ kind: 'strip', strip: { kind: 'mixer-node', id: strip.id }, parameterId: 'gain' });
			assert.equal(parameter?.binding.kind, 'audio-param');
		}
		assert.ok(visits < 10_000, `${visits} classification predicate visits for 403 strips`);
	} finally { Array.prototype.some = original; }
});
