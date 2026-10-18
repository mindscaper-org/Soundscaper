/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { originalStageFixtureCurrentV1 as fixture } from './helpers/lightscaper-desktop-original-stage-fixture-current.ts';
import { deferred, waitForEvent } from './helpers/async-test-control.ts';

test('Light Original stage refuses fifth active acquisition without reflecting it or queuing more native work', { timeout: 15_000 }, async () => {
	const gate = deferred<void>(), f = fixture(undefined, { openGate: gate });
	const active = Array.from({ length: 4 }, () => f.source.acquire(f.request)); for (const pending of active) void pending.catch(() => undefined);
	try {
		await waitForEvent(f.events, 'open-start'); let traps = 0;
		const request = new Proxy({}, { ownKeys() { traps++; throw new Error('No free acquisition slot.'); } });
		await assert.rejects(f.source.acquire(request)); assert.equal(traps, 0); assert.equal(f.events.filter(value => value === 'open-start').length, 4);
		const closing = f.source.close(); gate.resolve(); await Promise.allSettled(active); await closing; assert.equal(f.closedTickets.length, 4);
	} finally { gate.resolve(); const settled = await Promise.allSettled(active); for (const value of settled) if (value.status === 'fulfilled') await value.value.close(); await f.source.close(); }
});

test('Light Original stage reserves aggregate encoded bytes before native open and never allocates an advertised huge body', { timeout: 15_000 }, async () => {
	const gate = deferred<void>(), f = fixture(undefined, { openGate: gate });
	const request = { ...f.request, original: { ...f.request.original, mimeType: 'image/x-lightscaper-hdr', byteLength: 196 * 1024 * 1024 } };
	const pending = f.source.acquire(request); void pending.catch(() => undefined);
	try {
		await waitForEvent(f.events, 'open-start'); await assert.rejects(f.source.acquire(request));
		assert.equal(f.events.filter(value => value === 'open-start').length, 1); assert.equal(f.events.includes('root'), false);
		const closing = f.source.close(); gate.resolve(); await assert.rejects(pending); await closing; assert.equal(f.closedTickets.length, 1);
	} finally { gate.resolve(); const lease = await pending.catch(() => null); await lease?.close(); await f.source.close(); }
});
