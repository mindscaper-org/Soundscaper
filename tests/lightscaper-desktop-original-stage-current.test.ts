/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { originalStageFixtureCurrentV1 as fixture, originalStageRequestCurrentV1 as request,
	shaOriginalStageCurrentV1 as sha, ORIGINAL_STAGE_RANGE_CURRENT_V1 as RANGE } from './helpers/lightscaper-desktop-original-stage-fixture-current.ts';
import { deferred, remainsPending, waitForEvent } from './helpers/async-test-control.ts';

// These narrow port tests prove admission and ownership, not browser OPFS or IPC.
test('Light Original stage copies sequential <=1 MiB pulls to a real retained File and holds the native ticket until lease close', { timeout: 15_000 }, async () => {
	const bytes = new Uint8Array(RANGE + 17).fill(23), gate = deferred<void>(), f = fixture(bytes, { writeGate: gate });
	const pending = f.source.acquire(f.request);
	try {
		await waitForEvent(f.events, 'write-start'); assert.equal(f.ranges.length, 1); assert.equal(await remainsPending(pending), true);
		gate.resolve(); const lease = await pending;
		assert.deepEqual(f.ranges, [[0, RANGE], [RANGE, 17]]); assert.equal(f.maximumReading(), 1);
		assert.ok(lease.body instanceof File); assert.equal(lease.body.size, bytes.byteLength);
		assert.equal(sha(new Uint8Array(await lease.body.arrayBuffer())), sha(bytes));
		assert.equal(f.closedTickets.length, 0); assert.equal(f.stageCount(), 1);
		const close = lease.close(); assert.equal(lease.close(), close); await close;
		assert.equal(f.closedTickets.length, 1); assert.equal(f.stageCount(), 0);
	} finally { gate.resolve(); const lease = await pending.catch(() => null); await lease?.close(); await f.source.close(); }
});

test('Light Original stage verifies the persisted native File and refuses copied-byte digest corruption', { timeout: 15_000 }, async () => {
	for (const controls of [
		{ readBytes: (bytes: Uint8Array<ArrayBuffer>) => { bytes[0] = (bytes[0] ?? 0) ^ 1; return bytes; } },
		{ file: (_parts: readonly Uint8Array<ArrayBuffer>[], name: string) => new File([new Uint8Array(5)], name) },
		{ file: () => ({ size: 5, slice() { throw new Error('A fake File must not be called.'); } }) },
	]) {
		const f = fixture(undefined, controls); await assert.rejects(f.source.acquire(f.request));
		assert.equal(f.stageCount(), 0); assert.equal(f.closedTickets.length, 1); await f.source.close();
	}
});

test('Light Original stage rejects short/overlong reads before File publication and aborts the actual writable', { timeout: 15_000 }, async () => {
	for (const count of [4, 6]) {
		const f = fixture(undefined, { readBytes: () => new Uint8Array(count) });
		await assert.rejects(f.source.acquire(f.request)); assert.equal(f.events.includes('get-file'), false);
		assert.ok(f.events.includes('writer-abort-end')); assert.equal(f.stageCount(), 0); assert.equal(f.closedTickets.length, 1); await f.source.close();
	}
});

test('Light Original stage captures exact requests and refuses changed ticket Original/path/profile additions', { timeout: 15_000 }, async () => {
	for (const ticket of [
		(value: ReturnType<typeof request>) => ({ id: 'a'.repeat(64), original: { ...value.original, id: 'other' } }),
		(value: ReturnType<typeof request>) => ({ id: 'a'.repeat(64), original: value.original, path: '/native/private' }),
	]) {
		const f = fixture(undefined, { ticket }); await assert.rejects(f.source.acquire(f.request));
		assert.equal(f.events.includes('writer-open'), false); assert.equal(f.closedTickets.length, 1); await f.source.close();
	}
	const f = fixture(); await assert.rejects(f.source.acquire({ ...f.request, path: '/renderer/path' }));
	assert.equal(f.events.includes('open-start'), false); await f.source.close();
});

test('Light Original stage uses private generated names and preserves legal descriptive names without interpreting paths', { timeout: 15_000 }, async () => {
	const f = fixture(), input = { ...f.request, original: { ...f.request.original, name: 'subdir/Original.png' } };
	const lease = await f.source.acquire(input); assert.ok(!lease.body.name.includes('/')); await lease.close(); await f.source.close();
});

test('Light Original stage never removes an existing collision and still retires its own ticket', { timeout: 15_000 }, async () => {
	const f = fixture(undefined, { collision: true }); await assert.rejects(f.source.acquire(f.request));
	assert.equal(f.events.includes('stage-create'), false); assert.equal(f.events.includes('remove-start'), false);
	assert.equal(f.closedTickets.length, 1); await f.source.close();
});

test('Light Original stage joins a held write and abort before cancellation removes the owned stage', { timeout: 15_000 }, async () => {
	const stop = new AbortController(), reason = Symbol('opaque'), write = deferred<void>(), abort = deferred<void>();
	const f = fixture(undefined, { writeGate: write, abortGate: abort }), pending = f.source.acquire(f.request, { signal: stop.signal });
	void pending.catch(() => undefined);
	try {
		await waitForEvent(f.events, 'write-start'); stop.abort(reason); assert.equal(await remainsPending(pending), true); assert.equal(f.stageCount(), 1);
		write.resolve(); await waitForEvent(f.events, 'writer-abort-start'); assert.equal(await remainsPending(pending), true); assert.equal(f.stageCount(), 1);
		abort.resolve(); let caught: unknown; try { await pending; } catch (error) { caught = error; } assert.equal(caught, reason);
		assert.equal(f.stageCount(), 0); assert.equal(f.closedTickets.length, 1);
	} finally { write.resolve(); abort.resolve(); await pending.catch(() => undefined); await f.source.close(); }
});

test('Light Original stage retains an unretired writable and exposes cleanup refusal at owner close', { timeout: 15_000 }, async () => {
	const primary = new DOMException('Quota', 'QuotaExceededError'), cleanup = new Error('Native abort refused');
	const f = fixture(undefined, { writeFailure: primary, abortFailure: cleanup });
	await assert.rejects(f.source.acquire(f.request), error => {
		assert.ok(error instanceof AggregateError); assert.ok(error.errors.includes(primary)); assert.ok(error.errors.includes(cleanup)); return true;
	});
	assert.equal(f.stageCount(), 1); await assert.rejects(f.source.close()); assert.equal(f.stageCount(), 1);
});
