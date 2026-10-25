/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectEffectRacks, projectRackEffect } from '../src/common/editor/engine/project-effects.ts';
import type { EngineProject, EngineTrack } from '../src/common/editor/engine/types.ts';

test('A03 effect rack iteration visits tracks only as requested', () => {
	let reads = 0;
	const tracks = Array.from({ length: 400 }, (_, index) => ({ id: `t${index}`, get type() { reads++; return 'audio'; }, effects: [] })) as EngineTrack[];
	const project = { tracks } as EngineProject;
	const iterator = projectEffectRacks(project);
	assert.equal(iterator.next().value?.targetId, 't0');
	assert.ok(reads <= 2, `track type reads: ${reads}`);
	assert.equal(Array.from(projectEffectRacks(project)).length, 401);
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
