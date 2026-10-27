/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	oneShotLinkedOriginalRelease,
	possibleLinkedOriginalRelease,
	sameLinkedOriginalBinding,
} from '../src/common/editor/storage/linked-original-custody.ts';

test('linked-original release discovery preserves the operation receiver', async () => {
	const owner = {
		calls: 0,
		release() { this.calls += 1; },
	};
	const release = possibleLinkedOriginalRelease(owner);
	assert.ok(release);
	await release();
	assert.equal(owner.calls, 1);
});

test('linked-original one-shot releases share successful and failed settlements', async () => {
	let calls = 0;
	const release = oneShotLinkedOriginalRelease(async () => { calls += 1; });
	const first = release();
	await release();
	await first;
	await release();
	assert.equal(calls, 1);

	const failure = new Error('cleanup failed');
	let failures = 0;
	const rejected = oneShotLinkedOriginalRelease(() => { failures += 1; throw failure; });
	const rejectedFirst = rejected();
	await assert.rejects(rejected(), (error: unknown) => error === failure);
	await assert.rejects(rejectedFirst, (error: unknown) => error === failure);
	assert.equal(failures, 1);
});

test('linked-original binding equality requires the token and complete normalized value', () => {
	const binding = Object.freeze({ bindingToken: 'token', sourceId: 'source', nested: Object.freeze({ size: 4 }) });
	assert.equal(sameLinkedOriginalBinding(binding, binding), true);
	assert.equal(sameLinkedOriginalBinding(binding, { ...binding }), true);
	assert.equal(sameLinkedOriginalBinding(binding, { ...binding, bindingToken: 'other' }), false);
	assert.equal(sameLinkedOriginalBinding(binding, { ...binding, sourceId: 'other' }), false);
});
