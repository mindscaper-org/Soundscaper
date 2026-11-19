/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { originalStageFixtureCurrentV1 as fixture } from './helpers/lightscaper-desktop-original-stage-fixture-current.ts';
import { deferred, remainsPending, waitForEvent } from './helpers/async-test-control.ts';

test('Light Original stage cleanup failure quarantines owner and cancels an already accepted sibling before File publication', { timeout: 15_000 }, async () => {
	const arrival = deferred<unknown>(), cleanup = new Error('Native owned entry removal refused'); let files = 0;
	const f = fixture(undefined, {
		removeFailure: cleanup,
		ticket: request => request.photoId === 'other' ? arrival.promise : { id: 'a'.repeat(64), original: request.original },
		file: (parts, name) => ++files === 1 ? new File([new Uint8Array(5)], name) : new File([...parts], name),
	});
	const first = f.source.acquire(f.request), otherRequest = { ...f.request, photoId: 'other' }, sibling = f.source.acquire(otherRequest);
	void first.catch(() => undefined); void sibling.catch(() => undefined);
	try {
		await waitForEvent(f.events, 'remove-start'); await assert.rejects(first);
		assert.equal(await remainsPending(sibling), true); let traps = 0;
		const poison = new Proxy({}, { ownKeys() { traps++; throw new Error('Quarantined owner must not admit more inputs.'); } });
		await assert.rejects(f.source.acquire(poison)); assert.equal(traps, 0);
		arrival.resolve({ id: 'b'.repeat(64), original: otherRequest.original }); await assert.rejects(sibling);
		assert.equal(files, 1); assert.equal(f.closedTickets.length, 2); assert.equal(f.stageCount(), 1);
		await assert.rejects(f.source.close());
	} finally {
		arrival.resolve({ id: 'b'.repeat(64), original: otherRequest.original });
		const settled = await Promise.allSettled([first, sibling]); for (const value of settled) if (value.status === 'fulfilled') await value.value.close().catch(() => undefined);
		await f.source.close().catch(() => undefined);
	}
});
