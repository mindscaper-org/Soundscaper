/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { compileParallelStackEffectInventory } from '../src/common/editor/engine/parallel-stack-effect-plan.ts';
import type { EngineEffect } from '../src/common/editor/engine/types.ts';

test('effect inventory compiles enabled rack entries without changing authored records', () => {
	const make = (id: string, type: string, lookahead: number): EngineEffect => ({
		id, type, enabled: true, bypassed: false, params: { lookahead },
	});
	const first = make('first', 'limiter', .001);
	const second = make('second', 'limiter', .002);
	const rack = Object.freeze([first, second, { id: 'disabled', type: 'unsupported', enabled: false }]);
	const inventory = compileParallelStackEffectInventory(rack, 48_000, 2);
	assert.equal(inventory.hasParametricEq, false);
	assert.equal(inventory.latencyFrames, 144);
	assert.deepEqual(inventory.effects.map(effect => [effect.id, effect.type, effect.latencyFrames]), [
		['first', 'limiter', 48], ['second', 'limiter', 96],
	]);
	assert.equal(rack[0], first);
	assert.equal(rack[1], second);
	assert.notEqual(inventory.effects[0], first);
});

test('effect compilation reports the first unsupported authored effect', () => {
	const rack = ['first', 'second'].map(id => ({ id, type: id, enabled: true }));
	assert.throws(() => compileParallelStackEffectInventory(rack, 48_000, 2), { message: 'Parallel stacks do not support effect first.' });
});
