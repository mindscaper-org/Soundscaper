/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { LightscaperNativePhotoRawTicketsCurrentV1 as Tickets } from '../desktop/lightscaper-native-photo-raw-tickets-current-v1.ts';
import { DesktopPhotoRawSourceCurrentV1 as Client } from '../src/lightscaper/desktop-photo-raw-source-current-v1.ts';
import { nativeRawOriginalsFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-raw-originals-fixture-current.ts';
const options = { concurrency: false, timeout: 15000 };
void test('Malformed RAW ready envelope still joins its real issued Main output identity', options, async context => {
	await fixture(context, async f => {
		const tickets = Tickets.create({ native: f.native, scope: { signal: f.signal, assertCurrent() { f.signal.throwIfAborted(); } }, unretired() { assert.fail('Unexpected Main quarantine'); } });
		const transport = tickets.transport; let retired = 0;
		const client = new Client({ open: async (...args) => ({ ...await transport.open(...args), unexpected: true }), read: (...args) => transport.read(...args), close: async value => { const receipt = await transport.close(value); retired++; return receipt; } }, { signal: f.signal });
		try { await assert.rejects(client.raw.withFrame(f.request(), () => assert.fail('Malformed output entered consumer.'))); assert.equal(retired, 1); assert.equal(f.activeChildren(), 0); }
		finally { await client.close(); await tickets.close(); }
	});
});
void test('Transferred RAW output quarantines renderer capacity and preserves opaque consumer failure after actual Main retirement', options, async context => {
	await fixture(context, async f => {
		const tickets = Tickets.create({ native: f.native, scope: { signal: f.signal, assertCurrent() { f.signal.throwIfAborted(); } }, unretired() { assert.fail('Unexpected Main quarantine'); } });
		const client = new Client(tickets.transport, { signal: f.signal }), primary = Symbol('opaque consumer failure'); let moved: ArrayBuffer | undefined;
		try {
			let caught: unknown;
			try { await client.raw.withFrame(f.request(), view => { moved = structuredClone(view.frame.pixels.buffer, { transfer: [view.frame.pixels.buffer] }); throw primary; }); }
			catch (error) { caught = error; }
			assert.ok(caught instanceof AggregateError); assert.equal((caught.errors as unknown[])[0], primary); assert.ok(moved); assert.ok(new Uint8Array(moved).some(value => value !== 0));
			let reflected = 0; const request = new Proxy(f.request(), { ownKeys(target) { reflected++; return Reflect.ownKeys(target); } });
			await assert.rejects(client.raw.withFrame(request, () => undefined)); assert.equal(reflected, 0); await assert.rejects(client.close()); assert.equal(f.activeChildren(), 0);
		} finally { if (moved) new Uint8Array(moved).fill(0); await Promise.allSettled([client.close()]); await tickets.close(); }
	});
});
