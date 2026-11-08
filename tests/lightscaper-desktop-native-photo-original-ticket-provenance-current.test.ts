/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { nativeTicketTestCurrentV1 as test, checkTicketTestSignalCurrentV1 as checkTest } from './helpers/lightscaper-native-photo-original-ticket-fixture-current.ts';
import { nativeOriginalTicketFixtureCurrentV1 as fixture, exactTicketFailureCurrentV1 as exactFailure,
	readTicket } from './helpers/lightscaper-native-photo-original-ticket-fixture-current.ts';

void test('Lightscaper native ticket borrowed AggregateError is an admission refusal without native cleanup authority', { timeout: 15_000 }, async () => {
	await fixture(async f => { checkTest();
	 const primary = new AggregateError([new Error('Borrowed reflection failure.')], 'The wire trap supplies no native cleanup witness.');
	 const request = new Proxy(f.request, { ownKeys() { throw primary; } });
	 await exactFailure(f.server.transport.open(request), primary); assert.equal(f.alerts.length, 0);
	 const issued = readTicket(await f.server.transport.open(f.request), f.request);
	 try { assert.ok(await f.server.transport.read(issued, 0, 1) instanceof Uint8Array); }
	 finally { await f.server.transport.close({ id: issued.id }); }
	 assert.equal(f.alerts.length, 0);
	});
});
