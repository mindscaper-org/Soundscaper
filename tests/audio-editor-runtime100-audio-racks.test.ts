/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectEffectRacks, projectRackEffect } from '../src/common/editor/engine/project-effects.ts';
import type { EngineProject, EngineTrack } from '../src/common/editor/engine/types.ts';

test('A03 effect rack enumeration omits native entry-pair allocations', () => {
	const tracks = Array.from({ length: 400 }, (_, index) => ({ id: `t${index}`, type: 'audio', effects: [] })) as EngineTrack[];
	const original = Array.prototype.entries;
	let pairs = 0;
	Array.prototype.entries = new Proxy(original, { apply(target, receiver, args) {
		const iterator = Reflect.apply(target, receiver, args) as ArrayIterator<[number, unknown]>;
		return { next() { const result = iterator.next(); if (!result.done) pairs++; return result; }, [Symbol.iterator]() { return this; } };
	} });
	try {
		const racks = Array.from(projectEffectRacks({ tracks }));
		assert.equal(racks.length, 401);
		assert.equal(pairs, 0);
	} finally { Array.prototype.entries = original; }
	const anonymous = { tracks: [{ type: 'label' }, { type: 'audio' }, { type: 'video' }, { type: 'audio' }] } as EngineProject;
	assert.deepEqual(Array.from(projectEffectRacks(anonymous)).map(rack => rack.targetId), ['0', '1', null]);
});

test('A04 master effect lookup does not materialize unrelated track racks', () => {
	let reads = 0;
	const tracks = Array.from({ length: 400 }, (_, index) => ({ id: `t${index}`, type: 'audio', get effects() { reads++; return []; } })) as EngineTrack[];
	const effect = { id: 'fx', type: 'gate' };
	const project = { tracks, master: { effects: [effect] } } as EngineProject;
	assert.equal(projectRackEffect(project, 'master', null, 'fx'), effect);
	assert.equal(reads, 0);
	assert.equal(projectRackEffect({ ...project, master: { effectsActive: false, effects: [effect] } }, 'master', null, 'fx'), null);
	assert.equal(projectRackEffect(project, 'unknown', null, 'fx'), null);
});


test('effect rack enumeration preserves sparse, custom-filter, iterator and species behavior', () => {
	const sparse = new Array<EngineTrack>(4);
	sparse[1] = { type: 'label' };
	Object.defineProperty(sparse, 2, { value: undefined, enumerable: true });
	sparse[3] = { type: 'audio' };
	assert.deepEqual(Array.from(projectEffectRacks({ tracks: sparse })).map(rack => rack.targetId), ['0', '1', null]);
	const custom = [{ id: 'original', type: 'audio' }];
	Object.defineProperty(custom, 'filter', { value: () => [{ id: 'replacement', type: 'audio' }] });
	assert.deepEqual(Array.from(projectEffectRacks({ tracks: custom })).map(rack => rack.targetId), ['replacement', null]);
	const iterator = [{ id: 'ordinary', type: 'audio' }];
	Object.defineProperty(iterator, Symbol.iterator, { get() { throw new Error('Native filter must ignore the source iterator.'); } });
	assert.deepEqual(Array.from(projectEffectRacks({ tracks: iterator })).map(rack => rack.targetId), ['ordinary', null]);
	class TrackSpecies extends Array<EngineTrack> {}
	Object.defineProperty(TrackSpecies.prototype, 'entries', { value(this: EngineTrack[]) { return [...Array.prototype.values.call(this) as ArrayIterator<EngineTrack>].reverse().entries(); } });
	const subclass = new TrackSpecies({ id: 'a', type: 'audio' }, { id: 'b', type: 'audio' });
	assert.deepEqual(Array.from(projectEffectRacks({ tracks: subclass })).map(rack => rack.targetId), ['b', 'a', null]);
});


test('effect racks snapshot membership before effects getters and between yields', () => {
	const later = { id: 'later', type: 'audio' };
	const first = { id: 'first', type: 'audio', get effects() { later.type = 'label'; return []; } };
	assert.deepEqual(Array.from(projectEffectRacks({ tracks: [first, later] })).map(rack => rack.targetId), ['first', 'later', null]);
	const tracks = [{ id: 'one', type: 'audio' }, { id: 'two', type: 'audio' }];
	const iterator = projectEffectRacks({ tracks });
	assert.equal(iterator.next().value?.targetId, 'one');
	tracks[1] = { id: 'replacement', type: 'label' };
	assert.equal(iterator.next().value?.targetId, 'two');
});
