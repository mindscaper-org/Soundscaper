/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { derivedTrackSidechainRoutes } from '../src/common/editor/derived-track-sidechains.ts';
import { edge } from './helpers/runtime50-editing-routing.ts';

test('E06 sidechain derivation indexes copies and effect racks within one invocation', context => {
	let copyReads = 0, trackReads = 0;
	const copies = Array.from({ length: 100 }, (_, index) => ({ get sourceTrackId() { copyReads += 1; return `source-${index}`; }, targetTrackId: `target-${index}` }));
	const original = { tracks: copies.map((_, index) => ({ get id() { trackReads += 1; return `source-${index}`; }, effects: [{ id: `effect-${index}`, type: 'compressor' }] })) };
	const staged = { tracks: copies.map((_, index) => ({ get id() { trackReads += 1; return `target-${index}`; }, effects: [{ id: `copied-${index}`, type: 'compressor' }] })) };
	const edges = copies.map((_, index) => edge(`edge-${index}`, 'external', { kind: 'effect-sidechain', strip: { kind: 'track', id: `source-${index}` }, effectId: `effect-${index}` }));
	const routes = derivedTrackSidechainRoutes(original, staged, edges, copies);
	assert.equal(routes.length, 100);
	assert.ok(copyReads <= 300, `copy source reads ${copyReads}`);
	context.diagnostic(`E06 copy source reads: ${copyReads}`);
	assert.ok(trackReads <= 400, `rack track reads ${trackReads}`);
	context.diagnostic(`E06 rack track reads: ${trackReads}`);
	assert.deepEqual(routes[99]!.route.destination, { kind: 'effect-sidechain', strip: { kind: 'track', id: 'target-99' }, effectId: 'copied-99' });
	staged.tracks[99]!.effects[0]!.id = 'edited-effect';
	assert.equal((derivedTrackSidechainRoutes(original, staged, [edges[99]!], copies)[0]!.route.destination as { effectId: string }).effectId, 'edited-effect');
	const duplicate = { tracks: [{ id: 'target-0', effects: [{ id: 'first', type: 'compressor' }] }, ...staged.tracks] };
	assert.equal((derivedTrackSidechainRoutes(original, duplicate, [edges[0]!], copies)[0]!.route.destination as { effectId: string }).effectId, 'first');
	assert.equal(derivedTrackSidechainRoutes(original, { tracks: [] }, edges, copies).length, 0);
});

test('E06 copied detector pairs retain order, reject incompatible effects, and avoid self input', () => {
	const original = { tracks: [{ id: 'programme', effects: [{ id: 'effect', type: 'duck' }, { id: 'effect', type: 'later' }] }] };
	const staged = { tracks: [{ id: 'programme-a', effects: [{ id: 'first', type: 'duck' }] }, { id: 'programme-b', effects: [{ id: 'second', type: 'duck' }] }] };
	const route = edge('sidechain', 'detector', { kind: 'effect-sidechain', strip: { kind: 'track', id: 'programme' }, effectId: 'effect' });
	const copies = [{ sourceTrackId: 'programme', targetTrackId: 'programme-a' }, { sourceTrackId: 'programme', targetTrackId: 'programme-b' }, { sourceTrackId: 'detector', targetTrackId: 'detector-a' }, { sourceTrackId: 'detector', targetTrackId: 'detector-b' }];
	assert.deepEqual(derivedTrackSidechainRoutes(original, staged, [route], copies).map(result => result.route.source), [{ kind: 'track', id: 'detector-a' }, { kind: 'track', id: 'detector-b' }]);
	assert.equal(derivedTrackSidechainRoutes(original, staged, [route], [...copies.slice(0, 2), { sourceTrackId: 'detector', targetTrackId: 'programme-a' }]).length, 1);
	assert.equal(derivedTrackSidechainRoutes(original, { tracks: [{ id: 'programme-a', effects: [{ id: 'wrong', type: 'other' }] }] }, [route], copies).length, 0);
});
