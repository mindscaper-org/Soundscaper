/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test, fixture, groupTransport, readGroup, seedAliases, observeGroup, readTicket, check,
	holdSingle, holdRead, remainsPending, Media, Originals } from './helpers/lightscaper-native-original-group-fixture-current.ts';

void test('Lightscaper native groups and singles share whole-authority logical capacity before any group reader call', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const requests = await seedAliases(f, 2); let calls = 0;
		const restore = observeGroup(f.reader, () => { calls++; }), server = f.makeServer(), group = groupTransport(server); restore();
		const tickets: Array<ReturnType<typeof readTicket>> = [];
		try {
			for (let index = 0; index < 4093; index++) { check(); tickets.push(readTicket(await server.transport.open(f.request), f.request)); }
			await assert.rejects(group.open(requests), /capacity/u); assert.equal(calls, 0);
			await server.transport.close({ id: tickets.pop()!.id }); const ticket = readGroup(await group.open(requests), requests);
			try { assert.equal(calls, 1); await assert.rejects(f.server.transport.open(f.request), /capacity/u); }
			finally { await group.close({ id: ticket.id }); }
			tickets.push(readTicket(await server.transport.open(f.request), f.request));
		} finally { await Promise.all(tickets.map(ticket => server.transport.close({ id: ticket.id }))); }
	}, { length: 1 });
});
void test('Lightscaper native physical group booking precedes per-Photo Catalog reads and retains all slots while one alias read retires', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const requests = await seedAliases(f, 2), holders: Array<Awaited<ReturnType<typeof holdSingle>>> = [];
		const nativeLoad = f.catalog.loadPhoto, descriptor = Object.getOwnPropertyDescriptor(f.catalog, 'loadPhoto'); let loads = 0;
		Object.defineProperty(f.catalog, 'loadPhoto', { configurable: true, value: function (...args: Parameters<typeof nativeLoad>) { loads++; return Reflect.apply(nativeLoad, f.catalog, args); } });
		const peer = await Media.open({ appDataPath: f.appDataPath }), observed = Originals.create({ catalog: f.catalog, media: peer, settings: f.settings,
			scope: { signal: f.scope.signal, assertCurrent: () => { f.scope.signal.throwIfAborted(); } } }), group = groupTransport(f.makeServer(observed));
		let issued: Readonly<{ id: string }> | undefined;
		try {
			for (let index = 0; index < 4093; index++) { check(); holders.push(await holdSingle(f)); }
			const before = loads; await assert.rejects(group.open(requests), /capacity/u); assert.equal(loads, before);
			const last = holders.pop()!; last.release.resolve(); await last.task;
			const ticket = readGroup(await group.open(requests), requests); issued = { id: ticket.id };
			await holdRead(f.appDataPath, async gate => {
				const work = group.read({ id: ticket.id }, 0, 0, 1); void work.catch(() => undefined); let closing: Promise<void> | undefined;
				try { await gate.entered; closing = group.close({ id: ticket.id }); assert.equal(await remainsPending(closing), true);
					await assert.rejects(f.reader.withOriginal(f.request, () => undefined), /capacity/u);
				} finally { gate.release(); await Promise.allSettled([work, ...(closing ? [closing] : [])]); }
				await closing;
			});
			const reopened = await holdSingle(f); reopened.release.resolve(); await reopened.task;
		} finally {
			for (const holder of holders) holder.release.resolve(); await Promise.allSettled(holders.map(holder => holder.task));
			try { if (issued) await group.close(issued); }
			finally { try { await observed.close(); } finally {
				try { await peer.close(); } finally { if (descriptor) Object.defineProperty(f.catalog, 'loadPhoto', descriptor); else Reflect.deleteProperty(f.catalog, 'loadPhoto'); }
			} }
		}
	}, { length: 1 });
});
void test('Lightscaper native group charges compatible alias bytes once while retaining every Photo authority', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const requests = await seedAliases(f, 193), group = groupTransport(f.server);
		// 193 independent copies exceed384MiB; these aliases share one2MiB body.
		const ticket = readGroup(await group.open(requests), requests);
		try { assert.equal(ticket.originals.length, 193); const bytes = await group.read({ id: ticket.id }, 192, 0, 1); assert.ok(bytes instanceof Uint8Array); }
		finally { await group.close({ id: ticket.id }); }
	}, { length: 2 * 1024 * 1024 + 1 });
});
