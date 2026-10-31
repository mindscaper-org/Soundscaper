/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { nativeTicketTestCurrentV1 as test, nativeOriginalTicketFixtureCurrentV1 as fixture,
	readTicket, exactTicketFailureCurrentV1 as exactFailure } from './helpers/lightscaper-native-photo-original-ticket-fixture-current.ts';

void test('Lightscaper native ticket read preserves an earlier owner close reason over later borrowed reflection failure', { timeout: 15_000 }, async () => {
	await fixture(async f => {
	 const issued = readTicket(await f.server.transport.open(f.request), f.request), later = new Error('Later borrowed DTO reflection failure.');
	 let closing: Promise<void> | undefined;
	 const supplied = new Proxy(issued, { ownKeys() { closing = f.server.close(); throw later; } });
	 const work = f.server.transport.read(supplied, 0, 1); void work.catch(() => undefined);
	 let expected: unknown, refused = false;
	 try {
	  await f.server.transport.read(issued, 0, 1).then(() => assert.fail('The owner was already closed.'), (error: unknown) => { refused = true; expected = error; });
	  assert.equal(refused, true); assert.notEqual(expected, later); await exactFailure(work, expected); assert.ok(closing); await closing;
	 } finally { await Promise.allSettled([work, ...(closing ? [closing] : []), f.server.close()]); }
	});
});
