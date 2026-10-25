/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSoundscaperRoutingFolderAuthority } from '../src/common/editor/ui/workspace/soundscaper-routing-folder-authority.ts';
import { layoutSoundscaperRoutingGraph } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-layout.ts';
import { createDefaultMixerGraphV21, type MixerGraphV21, type MixerEdgeV21, type MixerStripV21 } from '../src/common/editor/mixer-graph-v21.ts';

function strip(id: string, name: string): MixerStripV21 {
	return { id, name, channelCount: 2, color: '#000000', gain: 1, pan: 0, mute: false, solo: false, collapsed: false, effectsActive: true, effects: [] };
}

function folderFixture(count: number, shared = false) {
	const tracks = Array.from({ length: count }, (_, i) => ({ id: `t${i}`, type: 'audio', clipIds: [] }));
	const trackFolders = tracks.map((_, i) => ({ id: `f${i}` }));
	const groups = trackFolders.map(({ id }) => strip(id, id));
	const trackNodes = [...trackFolders.map(({ id }, i) => ({ kind: 'folder', id, parentFolderId: shared && i ? `f${i - 1}` : null })), ...tracks.map(({ id }, i) => ({ kind: 'track', id, parentFolderId: shared ? `f${count - 1}` : `f${i}` }))];
	const edges: MixerEdgeV21[] = [...tracks.map(({ id }, i) => edge(`assignment:track:${id}:mixer-node:f${shared ? count - 1 : i}`, { kind: 'track', id }, { kind: 'mixer-node', id: `f${shared ? count - 1 : i}` })), ...trackFolders.map(({ id }, i) => edge(`assignment:mixer-node:${id}:${shared && i ? `mixer-node:f${i - 1}` : 'master'}`, { kind: 'mixer-node', id }, shared && i ? { kind: 'mixer-node', id: `f${i - 1}` } : { kind: 'master' }))];
	const graph: MixerGraphV21 = { ...createDefaultMixerGraphV21([]), groups, edges };
	return { project: { tracks, trackFolders, sequences: [{ trackNodes }], mixer: graph }, graph };
}
function edge(id: string, source: MixerEdgeV21['source'], destination: MixerEdgeV21['destination']): MixerEdgeV21 {
	return { id, source, destination, kind: 'assignment', enabled: true, level: 1, position: 'post-fader', channelMap: [0, 1] };
}
void test('U05 routing folder validation indexes original and candidate identities once', t => {
	const { project, graph } = folderFixture(80);
	let visits = 0; const original = Array.prototype.find;
	Array.prototype.find = function(this: unknown[], callback: (item: unknown, i: number, values: unknown[]) => unknown, thisArg?: unknown): unknown {
		return original.call(this, (item: unknown, i: number, values: unknown[]) => { visits++; return callback.call(thisArg, item, i, values); });
	} as typeof Array.prototype.find;
	try { assert.equal(validateSoundscaperRoutingFolderAuthority(project, graph), true); } finally { Array.prototype.find = original; }
	t.diagnostic(`identity find visits ${visits}`); assert.equal(visits, 0);
	assert.throws(() => validateSoundscaperRoutingFolderAuthority(project, { ...graph, groups: graph.groups.slice(1) }), /managed/u);
	assert.throws(() => validateSoundscaperRoutingFolderAuthority(project, { ...graph, edges: graph.edges.slice(1) }), /managed/u);
});
void test('U06 routing folder discovery stops at already traversed shared ancestors', t => {
	const { project, graph } = folderFixture(100, true);
	let gets = 0; const original = Map.prototype.get;
	Map.prototype.get = function(this: Map<unknown, unknown>, key: unknown): unknown { if (typeof key === 'string' && /^f\d+$/u.test(key)) gets++; return original.call(this, key); };
	try { assert.equal(validateSoundscaperRoutingFolderAuthority(project, graph), true); } finally { Map.prototype.get = original; }
	t.diagnostic(`folder map reads ${gets}`); assert.ok(gets < 800);
});

function graphFixture() {
	const tracks = Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, type: 'audio', clipIds: [] }));
	const groups = tracks.map((_, i) => strip(`g${i}`, `G${i}`));
	const base = createDefaultMixerGraphV21(tracks);
	const edges = [...base.edges.filter(({ source }) => source.kind === 'master'), ...groups.flatMap(({ id }, i) => [edge(`e${i}`, { kind: 'track', id: `t${59 - i}` }, { kind: 'mixer-node', id }), edge(`m${i}`, { kind: 'mixer-node', id }, { kind: 'master' })])];
	const vcas = tracks.map(({ id }, i) => ({ id: `v${i}`, name: id, gain: 1, mute: false, members: [{ kind: 'track' as const, id }] }));
	const graph: MixerGraphV21 = { ...base, groups, edges, vcas };
	return { graph, project: { tracks, clips: [], sources: [], mixer: graph } };
}
void test('U07 routing graph sorts predecessor medians once per node instead of comparator call', t => {
	const { graph, project } = graphFixture(); let sorts = 0; const original = Array.prototype.sort;
	Array.prototype.sort = function(this: unknown[], compare?: (a: unknown, b: unknown) => number) { if (this.length && typeof this[0] === 'number') sorts++; return original.call(this, compare); };
	let layout: ReturnType<typeof layoutSoundscaperRoutingGraph>;
	try { layout = layoutSoundscaperRoutingGraph(project, graph); } finally { Array.prototype.sort = original; }
	assert.equal(layout.nodes.length, 182); t.diagnostic(`median sorts ${sorts}`); assert.ok(sorts <= 62);
	assert.deepEqual(layout.nodes.filter(({ kind }) => kind === 'group').map(({ id }) => id), graph.groups.map(({ id }) => id).reverse());
});
void test('U08 routing VCA placement never searches the full pending node inventory', t => {
	const { graph, project } = graphFixture(); let visits = 0; const original = Array.prototype.find;
	Array.prototype.find = function(this: unknown[], callback: (value: unknown, i: number, values: unknown[]) => unknown, thisArg?: unknown): unknown { return original.call(this, (value: unknown, i: number, values: unknown[]) => { visits++; return callback.call(thisArg, value, i, values); }); } as typeof Array.prototype.find;
	try { assert.equal(layoutSoundscaperRoutingGraph(project, graph).nodes.filter(({ kind }) => kind === 'vca').length, 60); } finally { Array.prototype.find = original; }
	t.diagnostic(`pending find visits ${visits}`); assert.equal(visits, 0);
});
void test('U09 routing graph reuses sorted rank columns for placement', t => {
	const { graph, project } = graphFixture(); let sorts = 0; const original = Array.prototype.sort;
	Array.prototype.sort = function(this: unknown[], compare?: (a: unknown, b: unknown) => number) { if (Array.isArray(this[0]) && typeof this[0][0] === 'number' && Array.isArray(this[0][1])) sorts++; return original.call(this, compare); };
	try { layoutSoundscaperRoutingGraph(project, graph); } finally { Array.prototype.sort = original; }
	t.diagnostic(`rank column sorts ${sorts}`); assert.equal(sorts, 1);
});
