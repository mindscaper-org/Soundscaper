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

test('effect racks snapshot membership between yields', () => {
	const tracks = [{ id: 'one', type: 'audio' }, { id: 'two', type: 'audio' }];
	const iterator = projectEffectRacks({ tracks });
	assert.equal(iterator.next().value?.targetId, 'one');
	tracks[1] = { id: 'replacement', type: 'label' };
	assert.equal(iterator.next().value?.targetId, 'two');
});
