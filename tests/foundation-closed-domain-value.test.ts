/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from '../src/common/foundation/closed-domain-value.ts';

test('shared closed records reject accessors before invoking application code', () => {
	let calls = 0;
	const accessor = { get value() { calls++; return 1; } };
	assert.throws(() => readClosedDomainRecord(accessor, 'resource', ['value']), /data property/u);
	assert.throws(() => readClosedDomainField(accessor, 'value', 'resource'), /data property/u);
	assert.equal(calls, 0);
	const record: unknown = Object.assign(Object.create(null) as object, { value: 1 });
	assert.equal(readClosedDomainField(readClosedDomainRecord(record, 'resource', ['value']), 'value', 'resource'), 1);
	for (const value of [null, [], 1, new Date()]) {
		assert.throws(() => readClosedDomainRecord(value, 'resource', ['value']), /plain object/u);
	}
});

test('shared bounded arrays reject holes and preserve immutable detached admitted values', () => {
	const source = [1, 2];
	const admitted = readClosedDomainArray(source, 'channels', 2, 2);
	source[0] = 3;
	assert.deepEqual(admitted, [1, 2]);
	assert.ok(Object.isFrozen(admitted));
	assert.throws(() => readClosedDomainArray(new Array<unknown>(2), 'channels', 2, 2), /data property/u);
	assert.throws(() => readClosedDomainArray([1], 'channels', 2, 2), /requires/u);
	assert.throws(() => readClosedDomainArray(Object.assign([1, 2], { extra: 3 }), 'channels', 2, 2), /unsupported/u);
});
