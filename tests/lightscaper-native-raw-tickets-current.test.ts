/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { LightscaperNativePhotoRawTicketsCurrentV1 as Tickets } from '../desktop/lightscaper-native-photo-raw-tickets-current-v1.ts';
import { DesktopPhotoRawSourceCurrentV1 as Client } from '../src/lightscaper/desktop-photo-raw-source-current-v1.ts';
import { nativeRawOriginalsFixtureCurrentV1 as fixture, nativeRawOriginalsHashCurrentV1 as hash } from './helpers/lightscaper-native-raw-originals-fixture-current.ts';
import { nativeRawNeutralOracleCurrentV1 } from './helpers/lightscaper-native-raw-engine-fixture-current.ts';
import { remainsPending } from './helpers/async-test-control.ts';
import type { PhotoLibraryRawFrameCurrentV1 } from '../src/lightscaper/controller/photo-library-raw-source-current-v1.ts';
const options = { concurrency: false, timeout: 15000 };
const bytes = (view: Readonly<PhotoLibraryRawFrameCurrentV1>) => new Uint8Array(view.frame.pixels.buffer);
void test('Native RAW ticket delivery authenticates the whole real plane and retains both Original and Main plane until consumer retirement', options, async context => {
	await fixture(context, async f => {
		let alerts = 0; const tickets = Tickets.create({ native: f.native, scope: { signal: f.signal, assertCurrent() { f.signal.throwIfAborted(); } }, unretired() { alerts++; } });
		const client = new Client(tickets.transport, { signal: f.signal }), entered = f.gate(), release = f.gate();
		let held: Readonly<PhotoLibraryRawFrameCurrentV1> | undefined;
		const oracle = await nativeRawNeutralOracleCurrentV1(f.bytes.slice());
		const work = f.track(client.raw.withFrame(f.request(), async view => { held = view; assert.equal(view.contentSha256, hash(bytes(view))); assert.equal(hash(bytes(view)), hash(new Uint8Array(oracle.frame.pixels.buffer)));
			assert.equal(f.activeChildren(), 0); entered.release(); await release.promise; return 'consumed'; }));
		try { await f.reached(entered.promise, work); assert.ok(held); await assert.rejects(f.components.media.deleteAsset(f.photo.original.storageKey));
			const closing = client.close(); assert.equal(await remainsPending(closing), true); assert.ok(held.frame.pixels.some(value => value !== 0));
			release.release(); await Promise.allSettled([work]); await closing; assert.ok(held.frame.pixels.every(value => value === 0)); assert.equal(alerts, 0);
		} finally { release.release(); await client.close(); await tickets.close(); oracle.frame.pixels.fill(0); }
	});
});
void test('Native RAW tickets enforce one live output, bounded ranges, exact identity and joined explicit retirement', options, async context => {
	await fixture(context, async f => {
		const tickets = Tickets.create({ native: f.native, scope: { signal: f.signal, assertCurrent() { f.signal.throwIfAborted(); } }, unretired() { assert.fail('Unexpected RAW ticket quarantine'); } });
		let opened: Awaited<ReturnType<typeof tickets.transport.open>> | undefined;
		try { opened = await tickets.transport.open({ kind: 'frame', request: f.request() }); assert.equal(opened.outcome, 'ready'); if (opened.outcome !== 'ready') assert.fail();
			const ticket = opened.ticket; assert.equal(ticket.byteLength, f.photo.original.width * f.photo.original.height * 8);
			await assert.rejects(tickets.transport.open({ kind: 'frame', request: f.request() }));
			await assert.rejects(tickets.transport.read({ id: '0'.repeat(64) }, 0, 4)); await assert.rejects(tickets.transport.read({ id: ticket.id }, 0, 1_048_577));
			await assert.rejects(tickets.transport.read({ id: ticket.id }, ticket.byteLength, 1));
			const first = await tickets.transport.read({ id: ticket.id }, 0, 16); assert.equal(first.byteLength, 16); first.fill(0);
			await tickets.transport.close({ id: ticket.id }); await assert.rejects(tickets.transport.read({ id: ticket.id }, 0, 4));
		} finally { if (opened?.outcome === 'ready') await tickets.transport.close({ id: opened.ticket.id }); await tickets.close(); }
	});
});
void test('Renderer RAW delivery rejects corruption before any consumer and still retires actual Main output', options, async context => {
	await fixture(context, async f => {
		const tickets = Tickets.create({ native: f.native, scope: { signal: f.signal, assertCurrent() { f.signal.throwIfAborted(); } }, unretired() { assert.fail('Unexpected RAW ticket quarantine'); } });
		const transport = tickets.transport; let calls = 0, retired = 0;
		const client = new Client({ open: value => transport.open(value), read: async (ticket, offset, length) => { const value = await transport.read(ticket, offset, length); value[0] = value[0]! ^ 1; return value; }, close: async ticket => { const receipt = await transport.close(ticket); retired++; return receipt; } }, { signal: f.signal });
		try { await assert.rejects(client.raw.withFrame(f.request(), () => { calls++; }), /SHA|digest|content/iu); assert.equal(calls, 0); assert.equal(retired, 1); assert.equal(f.activeChildren(), 0); }
		finally { await client.close(); await tickets.close(); }
	});
});

void test('Main RAW ticket close during request capture joins admission without launching any peer', options, async context => {
	await fixture(context, async f => {
		const tickets = Tickets.create({ native: f.native, scope: { signal: f.signal, assertCurrent() { f.signal.throwIfAborted(); } }, unretired() { assert.fail('Unexpected RAW ticket quarantine'); } });
		let closing: Promise<void> | undefined;
		const request = new Proxy({ kind: 'frame' as const, request: f.request() }, { ownKeys(target) { closing ??= tickets.close(); return Reflect.ownKeys(target); } });
		try { await assert.rejects(tickets.transport.open(request)); assert.ok(closing); await closing; assert.equal(f.state.starts, 0); }
		finally { await tickets.close(); }
	});
});
