/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	snapshotDeliveryReport,
} from '../src/framescaper/delivery-native-report-validation-v1.ts';

function report() {
	return {
		schemaVersion: 1, format: 'delivery', direction: 'export',
		subject: {
			format: 'mov', container: 'mov', codec: 'prores',
			sampleRate: 48_000, channelCount: 2, lossless: false,
		},
		items: [{
			code: 'delivery.picture', severity: 'info', disposition: 'preserved',
			scope: { kind: 'delivery' }, data: { nested: { frames: [1, 2] } },
		}],
		counts: { preserved: 1, converted: 0, missing: 0, omitted: 0 },
	};
}

test('nested report scope accessors are refused before cloning can invoke them', () => {
	const value = report();
	let called = false;
	value.items[0]!.scope = Object.defineProperty({}, 'kind', {
		enumerable: true,
		get() { called = true; return 'delivery'; },
	}) as { kind: string };
	assert.throws(() => snapshotDeliveryReport(value), /own data propert/iu);
	assert.equal(called, false);
});

test('nested report data accessors are refused before cloning can invoke them', () => {
	const value = report();
	let called = false;
	value.items[0]!.data = Object.defineProperty({}, 'nested', {
		enumerable: true,
		get() { called = true; return { frames: [1, 2] }; },
	}) as { nested: { frames: number[] } };
	assert.throws(() => snapshotDeliveryReport(value), /own data propert/iu);
	assert.equal(called, false);
});

test('report snapshots own detached, deeply frozen item data', () => {
	const value = report();
	const snapshot = snapshotDeliveryReport(value);
	value.items[0]!.data.nested.frames[0] = 99;
	assert.deepEqual(snapshot.items[0]!.data, { nested: { frames: [1, 2] } });
	assert.equal(Object.isFrozen(snapshot.items[0]!.data), true);
	assert.equal(Object.isFrozen((snapshot.items[0]!.data.nested as { frames: number[] }).frames), true);
});

test('delivery report counts must equal the disposition inventory', () => {
	const value = report();
	value.counts.preserved = 0;
	assert.throws(() => snapshotDeliveryReport(value), /counts do not describe/iu);
});

test('delivery report snapshots reject unsupported top-level fields', () => {
	assert.throws(() => snapshotDeliveryReport({ ...report(), draft: true }), /unsupported fields/iu);
});
