/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProjectGraphV21 } from '../src/common/editor/engine/project-graph-v21.ts';
import { audibleEffectTailGraphV21 } from '../src/common/editor/project-effect-tail-gates-v21.ts';
import { vcaPrintProject } from './helpers/next-vca-print-project.ts';

interface TestParam { value: number; setValueAtTime(value: number): void; }
interface TestNode {
	readonly gain?: TestParam;
	readonly connections: TestNode[];
	connect(node: TestNode): TestNode;
	disconnect(): void;
}
function graphContext() {
	const param = (value: number): TestParam => ({ value, setValueAtTime(next) { this.value = next; } });
	const node = (gain?: number): TestNode => ({ ...(gain === undefined ? {} : { gain: param(gain) }),
		connections: [], connect(to) { this.connections.push(to); return to; }, disconnect() {} });
	return { sampleRate: 48_000, currentTime: 0, createGain: () => node(1),
		createDelay: () => ({ ...node(), delayTime: param(0) }), createChannelSplitter: () => node(),
		createChannelMerger: () => node(), destination: node() };
}
for (const respect of [true, false]) test(`NP041: production graph honors VCA mute policy respect=${respect}`, () => {
	const { project } = vcaPrintProject(); const audio = graphContext();
	const graph = buildProjectGraphV21(audio as unknown as BaseAudioContext, audio.destination as unknown as AudioNode,
		project, { includeTrackPan: false, includeMaster: false, metering: false, monitoring: false, respectMuteSolo: respect });
	let node = graph.trackInputs.get('one') as unknown as TestNode | undefined; assert.ok(node);
	const gains: number[] = []; const visited = new Set<TestNode>();
	while (node && !visited.has(node)) {
		visited.add(node); if (node.gain) gains.push(node.gain.value); node = node.connections[0];
	}
	assert.ok(gains.includes(respect ? 0 : .5), `capture gain chain ${gains.join(',')}`);
	if (!respect) assert.ok(!gains.includes(0));
});
for (const respect of [true, false]) test(`NP041: release planning honors VCA mute policy respect=${respect}`, () => {
	const { project } = vcaPrintProject();
	const graph = audibleEffectTailGraphV21(project, project.mixer, { includeMaster: false, respectMuteSolo: respect });
	assert.equal(graph.edges.some(edge => edge.source.kind === 'track' && edge.source.id === 'one'), !respect);
});

test('NP041: bypassing listening gates still retains a deliberately zero VCA gain', () => {
	const { project } = vcaPrintProject(false, 0);
	const graph = audibleEffectTailGraphV21(project, project.mixer, { includeMaster: false, respectMuteSolo: false });
	assert.equal(graph.edges.some(edge => edge.source.kind === 'track' && edge.source.id === 'one'), false);
	assert.equal(project.mixer.vcas[0]?.gain, 0);
});
