/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { originalStageFixtureCurrentV1 as fixture } from './helpers/lightscaper-desktop-original-stage-fixture-current.ts';
import { deferred, remainsPending, waitForEvent } from './helpers/async-test-control.ts';

test('Light Original stage fences known cleanup failure before a held native ticket retirement acknowledges', { timeout: 15_000 }, async () => {
	const gate = deferred<void>(), cleanup = new Error('Owned stage removal refused');
	const f = fixture(undefined, { releaseGate: gate, removeFailure: cleanup,
		file: (_parts, name) => new File([new Uint8Array(5)], name) });
	const pending = f.source.acquire(f.request); void pending.catch(() => undefined);
	try {
		await waitForEvent(f.events, 'remove-start'); assert.equal(await remainsPending(pending), true);
		assert.ok(f.events.includes('ticket-close-start')); assert.equal(f.events.includes('ticket-close-end'), false);
		let traps = 0; const poison = new Proxy({}, { ownKeys() { traps++; throw new Error('Known cleanup failure must fence admission immediately.'); } });
		await assert.rejects(f.source.acquire(poison)); assert.equal(traps, 0);
		const closing = f.source.close(); assert.equal(await remainsPending(closing), true); assert.equal(f.stageCount(), 1);
		gate.resolve(); await assert.rejects(pending); await assert.rejects(closing); assert.equal(f.closedTickets.length, 1);
	} finally {
		gate.resolve(); await pending.catch(() => undefined); await f.source.close().catch(() => undefined);
	}
});
