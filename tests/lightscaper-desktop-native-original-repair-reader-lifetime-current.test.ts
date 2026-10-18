/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { fixture, test, readTicket, readGroup, groupTransport, seedAliases, sha, holdRead, remainsPending, exactFailure,
	requirePhysicalReadCurrentV1 as physical, repairReaderBodyCurrentV1 as repair, holdRepairReaderCloseCurrentV1 as holdClose, withRepairReaderPeerCurrentV1 as withPeer } from './helpers/lightscaper-native-original-repair-reader-fixture-current.ts';
import { beginNativeWriterCurrentV1 as begin } from './helpers/lightscaper-native-media-writer-integration-fixture-current.ts';

void test('Lightscaper native ticket physical close joins the real open FileHandle before logical deletion pin retires', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		await physical(f); const ticket = readTicket(await f.server.transport.open(f.request), f.request);
		await withPeer(f, async peer => { await holdClose(f.appDataPath, async gate => {
			const work = f.server.transport.read(ticket, 0, 29); void work.catch(() => undefined); let closing: Promise<void> | undefined;
			try {
				await gate.entered; closing = f.server.transport.close({ id: ticket.id });
				assert.equal(await remainsPending(closing), true); await peer.catalogOriginals.release(f.request.catalogId, [f.request.photoId]);
				await assert.rejects(peer.deleteAsset(f.entry.original.storageKey), /pinned/iu);
				gate.release(); await assert.rejects(work); await closing;
			} finally { gate.release(); await Promise.allSettled([work, ...(closing ? [closing] : []), f.server.transport.close({ id: ticket.id })]); }
		});
		await peer.deleteAsset(f.entry.original.storageKey);
		});
	}, { length: 16_384 });
});

for (const grouped of [false, true]) void test(`Lightscaper native ${grouped ? 'group' : 'single'} physical read remains joined while a fresh generation publishes`, { timeout: 15_000 }, async context => {
	await fixture(async f => {
		await physical(f); const requests = grouped ? await seedAliases(f, 2) : [f.request], group = groupTransport(f.server);
		const single = grouped ? undefined : readTicket(await f.server.transport.open(f.request), f.request);
		const many = grouped ? readGroup(await group.open(requests), requests) : undefined;
		const close = () => many ? group.close({ id: many.id }) : f.server.transport.close({ id: single!.id });
		await withPeer(f, async peer => { await holdRead(f.appDataPath, async gate => {
			const work = many ? group.read({ id: many.id }, 0, 0, 31) : f.server.transport.read(single!, 0, 31); void work.catch(() => undefined);
			try {
				await gate.entered; await repair(f, f.request, null, peer, context.signal); assert.equal(await remainsPending(work), true);
				gate.release(); const bytes = await work; assert.ok(bytes instanceof Uint8Array); assert.equal(sha(bytes), sha(f.entry.bytes.subarray(0, 31)));
			} finally { gate.release(); await Promise.allSettled([work, close()]); }
		}); await close(); });
	}, { length: 16_384 });
});

void test('Lightscaper native physical pulls and Source close do not queue behind an idle escaped writer', { timeout: 15_000 }, async context => {
	await fixture(async f => {
		await physical(f); const ticket = readTicket(await f.server.transport.open(f.request), f.request);
		const writer = await begin(f.media, 'idle-physical-reader-writer', {}, { expectedBytes: 1, expectedSha256: sha(Uint8Array.of(9)) });
		const cancel = (): void => { void writer.abort().catch(() => undefined); void f.server.close().catch(() => undefined); };
		context.signal.addEventListener('abort', cancel, { once: true }); let reading: Promise<unknown> | undefined;
		try {
			reading = f.server.transport.read(ticket, 0, 23); void reading.catch(() => undefined);
			assert.equal(sha(await reading), sha(f.entry.bytes.subarray(0, 23))); context.signal.throwIfAborted();
			await f.server.transport.close({ id: ticket.id }); await f.server.close(); await f.reader.close();
			context.signal.throwIfAborted();
		} finally { cancel(); await Promise.allSettled([writer.abort(), f.server.close(), ...(reading ? [reading] : [])]); context.signal.removeEventListener('abort', cancel); }
	}, { length: 16_384 });
});

void test('Lightscaper native physical cancellation preserves opaque reason and joins actual read before lease retirement', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		await physical(f); const ticket = readTicket(await f.server.transport.open(f.request), f.request), reason = Symbol('physical-read-cancel');
		await holdRead(f.appDataPath, async gate => {
			const work = f.server.transport.read(ticket, 0, 17); void work.catch(() => undefined); let closing: Promise<void> | undefined;
			try { await gate.entered; f.scope.abort(reason); closing = f.server.close(); assert.equal(await remainsPending(closing), true); }
			finally { gate.release(); await exactFailure(work, reason); await closing; }
		});
	}, { length: 16_384 });
});
