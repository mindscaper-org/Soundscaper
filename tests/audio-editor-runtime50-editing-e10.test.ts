/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { removeTracksAndDependents } from '../src/common/editor/commands/track-mixer-label-runtime.js';
import { normalizeEffect } from '../src/common/editor/effects.js';
import { visits } from './helpers/runtime50-editing-metrics.ts';
import { edge } from './helpers/runtime50-editing-routing.ts';

test('E10 multi-track removal visits surviving auto-duck racks and detector routes once', context => {
	const effects = Array.from({ length: 40 }, (_, index) => normalizeEffect({ id: `duck-${index}`, type: 'audacity-auto-duck', context: { controlTrackId: `removed-${index}` } }));
	const kept = { id: 'kept', type: 'audio', clipIds: [], effects };
	const project = { tracks: [...effects.map((_, index) => ({ id: `removed-${index}`, type: 'audio', clipIds: [], effects: [] })), kept], clips: [], master: { effects: [] }, mixer: { routes: {}, groups: [], sends: [], edges: effects.map((_, index) => edge(`detector-${index}`, `removed-${index}`, { kind: 'effect-sidechain', strip: { kind: 'track', id: 'kept' }, effectId: `duck-${index}` })) } };
	const count = visits('filter', () => { removeTracksAndDependents(project, effects.map((_, index) => `removed-${index}`)); });
	assert.ok(count <= 200, `removal filter visits ${count}`);
	context.diagnostic(`E10 removal filter visits: ${count}`);
	assert.deepEqual(project.tracks, [kept]);
	assert.ok(kept.effects.every(effect => effect.enabled === false && effect.context
		&& 'controlTrackId' in effect.context && effect.context.controlTrackId === null));
	const survivor = normalizeEffect({ id: 'survivor', type: 'audacity-auto-duck', context: { controlTrackId: 'old' } });
	const other = { tracks: [{ id: 'old', clipIds: [], effects: [] }, { id: 'actual', clipIds: [], effects: [survivor] }], clips: [], master: { effects: [] }, mixer: { routes: {}, groups: [], sends: [], edges: [edge('rerouted', 'actual', { kind: 'effect-sidechain', strip: { kind: 'track', id: 'actual' }, effectId: 'survivor' })] } };
	removeTracksAndDependents(other, ['old']);
	assert.equal(other.tracks[0]!.effects[0]!.enabled, true);
	const survivorContext = other.tracks[0]!.effects[0]!.context;
	assert.ok(survivorContext && 'controlTrackId' in survivorContext);
	assert.equal(survivorContext.controlTrackId, 'actual');
});
