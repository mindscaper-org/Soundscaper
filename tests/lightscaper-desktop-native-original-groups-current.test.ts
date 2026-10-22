/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test, fixture, groupTransport, readGroup, seedAliases, releaseAliases, sha, holdRead, remainsPending,
	exactFailure, deferred, withGroup, check, observeGroup, readTicket, type GroupView } from './helpers/lightscaper-native-original-group-fixture-current.ts';

void test('Lightscaper native group opens an empty aligned owner and closes by inert ID', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		let calls = 0; const restore = observeGroup(f.reader, () => { calls++; }), server = f.makeServer(), group = groupTransport(server); restore();
		let ticket = readGroup(await group.open([]), []);
		for (let index = 0; index < 4095; index++) { check(); ticket = readGroup(await group.open([]), []); }
		assert.equal(calls, 0); const single = readTicket(await server.transport.open(f.request), f.request); await server.transport.close({ id: single.id });
		assert.deepEqual(Object.keys(ticket), ['id', 'originals']); assert.equal(ticket.originals.length, 0);
		await assert.rejects(group.read({ id: ticket.id }, 0, 0, 1)); await group.close({ id: ticket.id }); await group.close({ id: ticket.id });
	});
});
void test('Lightscaper native group authenticates every same-key and different-locator alias and pins all generations', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const shared = await seedAliases(f, 2), separate = await seedAliases(f, 2, { differentLocator: true, prefix: 'separate' });
		// Reuse distinct Photo IDs while retaining both physical locator aliases.
		const requests = [f.request, ...shared, ...separate], group = groupTransport(f.server), ticket = readGroup(await group.open(requests), requests);
		try {
			assert.equal(ticket.originals.length, requests.length); assert.equal(shared.length, 2);
			for (let index = 0; index < requests.length; index++) { const bytes = await group.read({ id: ticket.id }, index, 1, 31); assert.ok(bytes instanceof Uint8Array); assert.equal(sha(bytes), sha(f.entry.bytes.subarray(1, 32))); }
			await releaseAliases(f, requests);
			for (const key of new Set(requests.map(value => value.original.storageKey))) await assert.rejects(f.media.deleteAsset(key), /pinned/u);
		} finally { await group.close({ id: ticket.id }); }
		for (const key of new Set(requests.map(value => value.original.storageKey))) await f.media.deleteAsset(key);
	});
});
void test('Lightscaper native group refuses a late missing custody alias without publishing a prefix or retaining earlier pins', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const requests = await seedAliases(f, 2), group = groupTransport(f.server);
		await f.media.catalogOriginals.release(f.request.catalogId, [requests[1]!.photoId]);
		await assert.rejects(group.open(requests));
		await releaseAliases(f, [f.request, requests[0]!]); await f.media.deleteAsset(f.entry.original.storageKey);
	});
});
void test('Lightscaper native group validates exact indexed range and denies foreign group owners', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const requests = await seedAliases(f, 2), group = groupTransport(f.server), peer = groupTransport(f.makeServer(f.readerFor()));
		const ticket = readGroup(await group.open(requests), requests);
		try {
			for (const index of [-0, -1, 0.5, 2]) await assert.rejects(group.read({ id: ticket.id }, index, 0, 1));
			for (const [offset, length] of [[-0, 1], [0, 0], [0, 1_048_577], [f.entry.bytes.length, 1]]) await assert.rejects(group.read({ id: ticket.id }, 0, offset!, length!));
			await assert.rejects(peer.read({ id: ticket.id }, 0, 0, 1)); await peer.close({ id: ticket.id });
			const bytes = await group.read({ id: ticket.id }, 1, 0, 17); assert.ok(bytes instanceof Uint8Array); assert.equal(sha(bytes), sha(f.entry.bytes.subarray(0, 17)));
		} finally { await group.close({ id: ticket.id }); }
	});
});
void test('Lightscaper native group close joins a genuine accepted FileHandle read and fences further pulls', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const requests = await seedAliases(f, 2), group = groupTransport(f.server), ticket = readGroup(await group.open(requests), requests);
		await holdRead(f.appDataPath, async gate => {
			let work: Promise<unknown> | undefined, closing: Promise<void> | undefined;
			try {
				work = group.read({ id: ticket.id }, 0, 0, 29); void work.catch(() => undefined); await gate.entered;
				closing = group.close({ id: ticket.id }); assert.equal(group.close({ id: ticket.id }), closing); assert.equal(await remainsPending(closing), true);
				await assert.rejects(group.read({ id: ticket.id }, 1, 0, 1));
			} finally { gate.release(); await Promise.allSettled([...(work ? [work] : []), ...(closing ? [closing] : [])]); }
			await closing;
		});
	});
});
void test('Lightscaper native group scope cancellation preserves opaque identity and joins held read retirement', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const group = groupTransport(f.server), ticket = readGroup(await group.open([f.request]), [f.request]), reason = Symbol('exact group cancellation');
		await holdRead(f.appDataPath, async gate => {
			const work = group.read({ id: ticket.id }, 0, 0, 11); void work.catch(() => undefined); let closing: Promise<void> | undefined;
			try { await gate.entered; f.scope.abort(reason); closing = f.server.close(); assert.equal(await remainsPending(closing), true); }
			finally { gate.release(); await exactFailure(work, reason); await closing; }
		});
	});
});
void test('Lightscaper native group admission is registered before borrowed reflection closes its server', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const group = groupTransport(f.server); let closing: Promise<void> | undefined, reflected = 0;
		const requests = new Proxy([f.request], { ownKeys(target) { reflected++; closing = f.server.close(); return Reflect.ownKeys(target); } });
		try { await assert.rejects(group.open(requests)); assert.ok(reflected > 0); }
		finally { await closing; }
	});
});
void test('Lightscaper native group Reader holds its actual callback until consumer retirement', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const release = deferred(), entered = deferred(); let view: Readonly<GroupView> | undefined;
		const task = withGroup(f.reader, [f.request], async value => { view = value; entered.resolve(); await release.promise; }); void task.catch(() => undefined);
		try { await entered.promise; assert.ok(view); const bytes = await view.read(0, 0, 7); assert.equal(sha(bytes), sha(f.entry.bytes.subarray(0, 7)));
			await releaseAliases(f, [f.request]); await assert.rejects(f.media.deleteAsset(f.entry.original.storageKey), /pinned/u);
		} finally { release.resolve(); await task; }
		await f.media.deleteAsset(f.entry.original.storageKey); check();
	});
});
