/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTakeCompGroup } from '../src/common/editor/take-comp-domain.ts';
import { validateFolderBusesV13 } from '../src/common/editor/folder-bus-v13.ts';
import { reconcileFolderMixerGraphV21, validateFolderMixerGraphV21 } from '../src/common/editor/folder-mixer-graph-v21.ts';
import { createDefaultMixerGraphV21, normalizeMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { mixerTrackSurfaceRouteV21 } from '../src/common/editor/mixer-graph-surface-v21.ts';
import { createMixerGraphAudibilityV21 } from '../src/common/editor/mixer-graph-audibility-v21.ts';
import { visits } from './helpers/runtime50-editing-metrics.ts';

const strip = (id: string) => ({ id, name: id, color: '', collapsed: false, gain: 1, pan: 0, mute: false, solo: false, effectsActive: true, effects: [], channelCount: 2 });
const edge = (id: string, source: { kind: 'track' | 'mixer-node'; id: string }, destination: { kind: 'master' } | { kind: 'mixer-node'; id: string }, kind = 'assignment') => ({ id, source, destination, kind, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] });
function folderFixture(count = 200) {
	const tracks = Array.from({ length: count }, (_, index) => ({ id: `track-${index}`, type: 'audio' }));
	const folders = tracks.map((_, index) => ({ id: `folder-${index}`, name: `folder-${index}` }));
	const sequences = [{ id: 'sequence', trackNodes: tracks.flatMap((track, index) => [{ kind: 'folder', id: folders[index]!.id, parentFolderId: null }, { kind: 'track', id: track.id, parentFolderId: folders[index]!.id }]) }];
	const base = createDefaultMixerGraphV21(tracks);
	const graph = normalizeMixerGraphV21({ ...base, groups: folders.map(folder => strip(folder.id)), edges: [base.edges.at(-1)!, ...tracks.map((track, index) => edge(`assignment:track:${track.id}:mixer-node:${folders[index]!.id}`, { kind: 'track', id: track.id }, { kind: 'mixer-node', id: folders[index]!.id })), ...folders.map(folder => edge(`assignment:mixer-node:${folder.id}:master`, { kind: 'mixer-node', id: folder.id }, { kind: 'master' }))] });
	return { masterChannels: 2, tracks, trackFolders: folders, sequences, graph };
}

test('E01 take lane normalization indexes normalized lane records in authored order', context => {
	const lanes = Array.from({ length: 400 }, (_, index) => ({ id: `lane-${index}` }));
	const value = { id: 'group', startSample: 0, endSample: 10, lanes, laneOrder: lanes.map(lane => lane.id).reverse(), takes: [{ id: 'take', laneId: lanes[0]!.id }], compRegions: [] };
	let result: ReturnType<typeof normalizeTakeCompGroup> | undefined;
	const count = visits('find', () => { result = normalizeTakeCompGroup(value); });
	assert.deepEqual(result?.lanes.map(lane => lane.id), value.laneOrder);
	assert.ok(Object.isFrozen(result?.lanes));
	context.diagnostic(`E01 lane find visits: ${count}`);
	assert.equal(count, 0);
	assert.throws(() => normalizeTakeCompGroup({ ...value, laneOrder: ['absent'] }), /missing take lane absent/u);
});

test('E02 legacy folder bus validation indexes bus-owning membership once', context => {
	const fixture = folderFixture();
	const routes = Object.fromEntries(fixture.tracks.map((track, index) => [track.id, { groupId: fixture.trackFolders[index]!.id }]));
	const project = { ...fixture, mixer: { groups: fixture.graph.groups, sends: [], routes } };
	const count = visits('includes', () => validateFolderBusesV13(project));
	context.diagnostic(`E02 bus membership slots: ${count}`);
	assert.equal(count, 0);
	assert.throws(() => validateFolderBusesV13({ ...project, mixer: { ...project.mixer, routes: { ...routes, 'track-0': { groupId: 'folder-1' } } } }), /must route/u);
});

test('E03 folder graph reconciliation indexes audio endpoint ownership', context => {
	const fixture = folderFixture();
	let result: typeof fixture.graph | undefined;
	const count = visits('includes', () => { result = reconcileFolderMixerGraphV21(fixture, fixture.graph); });
	assert.deepEqual(result, fixture.graph);
	context.diagnostic(`E03 audio track membership slots: ${count}`);
	assert.equal(count, 0);
});

test('E04 folder graph validation resolves assignment tuples once', context => {
	const fixture = folderFixture();
	let probes = 0;
	const original = Array.prototype.some;
	Array.prototype.some = function (predicate, thisArg) {
		return Reflect.apply(original, this, [(value: unknown, index: number, values: unknown[]) => { probes++; return Reflect.apply(predicate, thisArg, [value, index, values]) as unknown; }]) as boolean;
	};
	try { validateFolderMixerGraphV21(fixture, fixture.graph); } finally { Array.prototype.some = original; }
	context.diagnostic(`E04 assignment predicate visits: ${probes}`);
	assert.ok(probes < 1000);
	const broken = normalizeMixerGraphV21({ ...fixture.graph, edges: fixture.graph.edges.filter(value => value.id !== 'assignment:track:track-0:mixer-node:folder-0') });
	assert.throws(() => validateFolderMixerGraphV21(fixture, broken), /must feed/u);
});

test('E05 compact route reading partitions normalized send edges once', context => {
	const fixture = folderFixture(1), sends = Array.from({ length: 200 }, (_, index) => strip(`send-${index}`));
	const graph = normalizeMixerGraphV21({ ...fixture.graph, sends, edges: [...fixture.graph.edges, ...sends.map(send => edge(`send:track:track-0:mixer-node:${send.id}`, { kind: 'track', id: 'track-0' }, { kind: 'mixer-node', id: send.id }, 'send'))] });
	let result: ReturnType<typeof mixerTrackSurfaceRouteV21> | undefined;
	const count = visits('filter', () => { result = mixerTrackSurfaceRouteV21(graph, 'track-0', { sourceChannels: 2, masterChannels: 2 }); });
	assert.equal(result?.editableSendIds.length, 200);
	assert.equal(result?.sends['send-199'], 1);
	context.diagnostic(`E05 edge filter visits: ${count}`);
	assert.ok(count < 1000);
});

test('E06 graph audibility builds programme and solo reachability once per reader', context => {
	const tracks = Array.from({ length: 120 }, (_, index) => ({ id: `track-${index}`, type: 'audio', solo: true }));
	const graph = createDefaultMixerGraphV21(tracks);
	const NativeSet = globalThis.Set;
	let allocations = 0;
	globalThis.Set = class extends NativeSet { constructor(values?: Iterable<unknown> | null) { super(values); allocations++; } } as SetConstructor;
	try {
		const reader = createMixerGraphAudibilityV21({ tracks, mixer: graph });
		assert.ok(reader);
		for (let repeat = 0; repeat < 3; repeat++) for (const track of tracks) assert.equal(reader.audibleTrack(track.id), true);
	} finally { globalThis.Set = NativeSet; }
	context.diagnostic(`E06 Set allocations: ${allocations}`);
	assert.ok(allocations < 1000);
});
