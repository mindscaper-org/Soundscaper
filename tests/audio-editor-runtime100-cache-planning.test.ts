/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { planDerivativeCacheEviction } from '../src/common/editor/storage/derivative-cache-policy.ts';

test('R04 fitting unexpired derivative inventories need no eviction ordering', context => {
	const records = Array.from({ length: 1200 }, (_, index) => ({ key: `entry-${index}`, size: 100,
		committedAt: new Date(100_000 + index).toISOString() }));
	const original = Array.prototype.sort;
	let sorts = 0;
	Array.prototype.sort = function(this: unknown[], compare?: (a: unknown, b: unknown) => number) {
		sorts++;
		return Reflect.apply(original, this, [compare]) as unknown[];
	};
	context.after(() => { Array.prototype.sort = original; });
	const plan = planDerivativeCacheEviction(records, { maximumBytes: 1_000_000, maximumEntries: 2000, maximumAgeMs: 10_000, now: 105_000 });
	assert.equal(sorts, 0);
	assert.deepEqual(plan.before, { entries: 1200, bytes: 120_000 });
	assert.deepEqual(plan.after, plan.before);
	assert.deepEqual(plan.removals, []);
	assert.equal(Object.isFrozen(plan), true);
	assert.equal(Object.isFrozen(plan.removals), true);
});

test('R04 cache admission still validates every record and orders real expiry or pressure', () => {
	const records = [{ key: 'b', size: 2, committedAt: new Date(10).toISOString() },
		{ key: 'a', size: 2, committedAt: new Date(10).toISOString() }, { key: 'c', size: 2, committedAt: new Date(20).toISOString() }];
	assert.deepEqual(planDerivativeCacheEviction(records, { maximumBytes: 100, maximumEntries: 20, maximumAgeMs: 15, now: 30 }).removals.map(row => row.key), ['a', 'b']);
	assert.deepEqual(planDerivativeCacheEviction(records, { maximumBytes: 3, maximumEntries: 20 }).removals.map(row => row.key), ['a', 'b']);
	assert.throws(() => planDerivativeCacheEviction([...records, { ...records[0]! }], { maximumBytes: 100, maximumEntries: 20 }), /Duplicate/u);
	assert.throws(() => planDerivativeCacheEviction([...records, { key: 'bad', size: -1, committedAt: '' }], { maximumBytes: 100, maximumEntries: 20 }), /non-negative/u);
});
