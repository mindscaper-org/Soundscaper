/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withDesktopReadCleanup } from '../src/common/editor/desktop-read-materialization.ts';

test('desktop read cleanup releases every capability after successful consumption', async () => {
	const released: string[] = [], result = { source: 'recording' };
	assert.equal(await withDesktopReadCleanup(['one', 'two'], id => { released.push(id); }, () => {
		assert.deepEqual(released, []);
		return result;
	}), result);
	assert.deepEqual(released, ['one', 'two']);
});

for (const primary of [new Error('Read failed'), undefined, null, 0]) {
	test(`desktop read cleanup retains the primary rejection ${String(primary)}`, async () => {
		const released: string[] = [];
		await assert.rejects(withDesktopReadCleanup(['one', 'two'], id => { released.push(id); },
			() => Promise.reject(primary)), (error: unknown) => error === primary);
		assert.deepEqual(released, ['one', 'two']);
	});
}

test('desktop read cleanup settles synchronous and asynchronous release failures before rejecting', async () => {
	const synchronous = new Error('First release'), asynchronous = new Error('Second release');
	const released: string[] = [];
	await assert.rejects(withDesktopReadCleanup(['one', 'two'], id => {
		released.push(id);
		if (id === 'one') throw synchronous;
		return Promise.reject(asynchronous);
	}, () => 'consumed'), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [synchronous, asynchronous]);
		return true;
	});
	assert.deepEqual(released, ['one', 'two']);
});

test('desktop read cleanup preserves primary and secondary errors together', async () => {
	const primary = new Error('Read failed'), secondary = new Error('Release failed');
	await assert.rejects(withDesktopReadCleanup(['one'], () => Promise.reject(secondary),
		() => Promise.reject(primary)), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.cause, primary);
		assert.deepEqual(error.errors, [primary, secondary]);
		return true;
	});
});
