/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	LocalModelCapacity,
} from '../desktop/local-model-capacity.ts';

function capacityDetails(bytes: bigint): Readonly<{ bavail: bigint; bsize: bigint }> {
	return Object.freeze({ bavail: bytes, bsize: 1n });
}

test('capacity admission uses bigint statfs before reserving model bytes', async () => {
	const calls: unknown[][] = [];
	const capacity = new LocalModelCapacity({
		statfsImpl: async (...args: unknown[]) => {
			calls.push(args);
			return capacityDetails(10n);
		},
	});

	const reservation = await capacity.reserve('/models', 7);
	assert.deepEqual(calls, [['/models', { bigint: true }]]);
	assert.equal(reservation.byteLength, 7);
	assert.equal(reservation.remainingBytes, 7);
	assert.equal(reservation.release(), true);
	assert.equal(reservation.release(), false);
});

test('concurrent reservations cannot oversubscribe the observed destination bytes', async () => {
	const capacity = new LocalModelCapacity({
		statfsImpl: async () => capacityDetails(10n),
	});
	const first = await capacity.reserve('/models', 7);

	await assert.rejects(
		capacity.reserve('/models', 4),
		/available disk space.*local model/iu,
	);
	first.consume(3);
	const second = await capacity.reserve('/models', 4);
	assert.equal(second.remainingBytes, 4);

	assert.equal(first.release(), true);
	assert.equal(second.release(), true);
});

test('reservations are isolated by normalized store root and account for consumption', async () => {
	const capacity = new LocalModelCapacity({
		statfsImpl: async () => capacityDetails(5n),
	});
	const first = await capacity.reserve('/models/a/..', 5);
	await assert.rejects(capacity.reserve('/models', 1), /available disk space/iu);
	const other = await capacity.reserve('/other-models', 5);

	assert.equal(first.consume(2), 3);
	assert.equal(first.remainingBytes, 3);
	assert.equal(first.release(), true);
	assert.equal(other.release(), true);
});

test('anomalous or unavailable native statfs information fails closed', async () => {
	const cases: readonly unknown[] = [
		{ bavail: -1n, bsize: 1n },
		{ bavail: 1n, bsize: 0n },
	];
	for (const details of cases) {
		const capacity = new LocalModelCapacity({ statfsImpl: async () => details });
		await assert.rejects(capacity.reserve('/models', 1), /capacity information is invalid/iu);
	}

	const failed = new LocalModelCapacity({
		statfsImpl: async () => { throw new Error('volume offline'); },
	});
	await assert.rejects(failed.reserve('/models', 1), /could not inspect.*capacity/iu);
});

