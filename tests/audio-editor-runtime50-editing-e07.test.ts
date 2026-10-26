/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { preserveProductionTrackRouting } from '../src/common/editor/derived-track-routing.ts';
import { normalizeMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { visits } from './helpers/runtime50-editing-metrics.ts';
import { bus, edge, graph } from './helpers/runtime50-editing-routing.ts';

test('E07 derived routing resolves terminal widths and VCA ownership without repeated scans', context => {
	const size = 70;
	const copies = Array.from({ length: size }, (_, index) => ({ sourceTrackId: `source-${index}`, targetTrackId: `target-${index}` }));
	const mixer = graph({ groups: copies.map((_, index) => bus(`bus-${index}`)), edges: copies.map((copy, index) => edge(`edge-${index}`, copy.sourceTrackId, { kind: 'mixer-node', id: `bus-${index}` })), vcas: copies.map((copy, index) => ({ id: `vca-${index}`, name: `VCA ${index}`, gain: 1, mute: false, members: [{ kind: 'track' as const, id: copy.sourceTrackId }] })) });
	const project = { schemaFamily: 'soundscaper', schemaVersion: 1, masterChannels: 2, tracks: copies.map(copy => ({ id: copy.sourceTrackId, type: 'audio', clipIds: [] })), sources: [], clips: [], mixer, automationLanes: [] };
	const staged = { ...project, tracks: [...project.tracks, ...copies.map(copy => ({ id: copy.targetTrackId, type: 'audio', clipIds: [] }))] };
	const before = structuredClone(project);
	let command: AudioEditorCommand = { type: 'batch', commands: [] };
	let id = 0;
	const count = visits('find', () => { command = preserveProductionTrackRouting(project, { type: 'batch', commands: [] }, copies, () => staged, prefix => `${prefix}-${id++}`); });
	// Graph normalization retains eight linear identity checks per route.
	assert.equal(count, size * 8, `terminal/VCA search visits ${count}`);
	context.diagnostic(`E07 routing find visits: ${count}`);
	assert.equal(command.type, 'batch');
	if (command.type !== 'batch') throw new Error('Expected batch');
	const update = command.commands.find(command => command.type === 'mixer-graph/set');
	assert.ok(update?.type === 'mixer-graph/set');
	const next = normalizeMixerGraphV21(update.mixer);
	assert.equal(next.edges.length, size * 2);
	assert.deepEqual(next.vcas[69]!.members, [{ kind: 'track', id: 'source-69' }, { kind: 'track', id: 'target-69' }]);
	assert.deepEqual(next.edges[139]!.channelMap, [0, 1]);
	assert.deepEqual(project, before);
	assert.equal(preserveProductionTrackRouting(project, { type: 'batch', commands: [] }, [], () => staged, () => 'unused').commands.length, 0);
});

test('E07 derived routing deduplicates detector terminals and preserves explicit channel maps', () => {
	const sidechain = { ...edge('detector-route', 'detector', { kind: 'effect-sidechain', strip: { kind: 'track', id: 'programme' }, effectId: 'original-effect' }), source: { kind: 'master' as const } };
	const copiedSidechain = { ...edge('existing-copy-route', 'detector-copy', { kind: 'effect-sidechain', strip: { kind: 'track', id: 'programme-copy' }, effectId: 'copied-effect' }), source: { kind: 'master' as const } };
	const mixer = graph({ edges: [{ ...edge('programme-output', 'programme', { kind: 'master' }), channelMap: [1, 0] }, sidechain] });
	const tracks = [{ id: 'programme', type: 'audio', clipIds: [], effects: [{ id: 'original-effect', type: 'duck' }] }, { id: 'detector', type: 'audio', clipIds: [], effects: [] }];
	const project = { schemaFamily: 'soundscaper', schemaVersion: 1, masterChannels: 2, tracks, sources: [], clips: [], mixer, automationLanes: [] };
	const staged = { ...project, tracks: [...tracks, { id: 'programme-copy', type: 'audio', clipIds: [], effects: [{ id: 'copied-effect', type: 'duck' }] }, { id: 'detector-copy', type: 'audio', clipIds: [], effects: [] }], mixer: graph({ edges: [...mixer.edges, copiedSidechain] }) };
	let id = 0;
	const command = preserveProductionTrackRouting(project, { type: 'batch', commands: [] }, [{ sourceTrackId: 'programme', targetTrackId: 'programme-copy' }, { sourceTrackId: 'detector', targetTrackId: 'detector-copy' }], () => staged, prefix => `${prefix}-${id++}`);
	const update = command.commands.find(command => command.type === 'mixer-graph/set');
	assert.ok(update?.type === 'mixer-graph/set');
	const next = normalizeMixerGraphV21(update.mixer);
	assert.equal(next.edges.filter(value => value.destination.kind === 'effect-sidechain' && value.destination.effectId === 'copied-effect').length, 1);
	assert.deepEqual(next.edges.find(value => value.source.kind === 'track' && value.source.id === 'programme-copy')?.channelMap, [1, 0]);
});
