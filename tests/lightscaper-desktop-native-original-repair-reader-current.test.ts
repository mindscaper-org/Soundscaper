/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { fixture, test, readTicket, readGroup, groupTransport, seedAliases, releaseAliases, sha, check, Store,
	requirePhysicalReadCurrentV1 as physical, repairReaderBodyCurrentV1 as repair, readerBodyFilesCurrentV1 as files,
	assertFreshReaderGenerationCurrentV1 as fresh, corruptLegacyReaderBodyCurrentV1 as corrupt, readerLogicalSnapshotCurrentV1 as logical } from './helpers/lightscaper-native-original-repair-reader-fixture-current.ts';

for (const staged of [false, true]) void test(`Lightscaper native ${staged ? 'active-import' : 'permanent'} ticket pins one physical generation between pulls across exact repair`, { timeout: 15_000 }, async context => {
	await fixture(async f => {
		await physical(f); const old = readTicket(await f.server.transport.open(f.request), f.request), before = await files(f), retained = logical(f);
		let newer: ReturnType<typeof readTicket> | undefined;
		try {
			assert.equal(sha(await f.server.transport.read(old, 0, 31)), sha(f.entry.bytes.subarray(0, 31)));
			const ack = await repair(f, f.request, staged ? 'repair-import' : null, f.media, context.signal); assert.equal(ack.sha256, sha(f.entry.bytes));
			await fresh(f, before); assert.equal(logical(f), retained, 'Exact repair must preserve immutable logical provenance and roots.');
			assert.equal(sha(await f.server.transport.read(old, 31, 1_048_576)), sha(f.entry.bytes.subarray(31, 1_048_607)));
			newer = readTicket(await f.server.transport.open(f.request), f.request);
			await corrupt(f);
			await assert.rejects(f.server.transport.read(old, 0, 17), /SHA|digest|changed/iu, 'The old ticket must not silently follow the new head.');
			assert.equal(sha(await f.server.transport.read(newer, 0, 31)), sha(f.entry.bytes.subarray(0, 31)));
			assert.equal(sha(await f.server.transport.read(newer, 1_048_576, 31)), sha(f.entry.bytes.subarray(1_048_576, 1_048_607)));
		} finally { await Promise.all([f.server.transport.close({ id: old.id }), ...(newer ? [f.server.transport.close({ id: newer.id })] : [])]); }
	}, { length: 1_048_607, ...(staged ? { staged: 'repair-import' } : {}) });
});

void test('Lightscaper native repaired groups retain same-key and independent storage-key Photo authorities at their old locators', { timeout: 15_000 }, async context => {
	await fixture(async f => {
		await physical(f); const shared = await seedAliases(f, 1), separate = await seedAliases(f, 1, { differentLocator: true, prefix: 'repair-separate' });
		const requests = [f.request, ...shared, ...separate], group = groupTransport(f.server), old = readGroup(await group.open(requests), requests);
		const retained = logical(f); let newer: ReturnType<typeof readGroup> | undefined;
		try {
			for (let index = 0; index < requests.length; index++) { const bytes = await group.read({ id: old.id }, index, 0, 23); assert.ok(bytes instanceof Uint8Array); assert.equal(sha(bytes), sha(f.entry.bytes.subarray(0, 23))); }
			await repair(f, f.request, null, f.media, context.signal); assert.equal(logical(f), retained); newer = readGroup(await group.open(requests), requests); await corrupt(f);
			for (let index = 0; index < requests.length; index++) {
				await assert.rejects(group.read({ id: old.id }, index, 0, 23), /SHA|digest|changed/iu);
				const bytes = await group.read({ id: newer.id }, index, 0, 23); assert.ok(bytes instanceof Uint8Array); assert.equal(sha(bytes), sha(f.entry.bytes.subarray(0, 23)));
			}
			await releaseAliases(f, requests);
			for (const key of new Set(requests.map(request => request.original.storageKey))) await assert.rejects(f.media.deleteAsset(key), /pinned/iu);
		} finally { await Promise.all([group.close({ id: old.id }), ...(newer ? [group.close({ id: newer.id })] : [])]); }
		for (const key of new Set(requests.map(request => request.original.storageKey))) await f.media.deleteAsset(key);
	}, { length: 16_384 });
});

void test('Lightscaper native Media captures actual physical acquisition before a later prototype replacement', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		await physical(f); const descriptor = Object.getOwnPropertyDescriptor(Store.prototype, 'acquireBindingRead');
		assert.ok(descriptor && typeof descriptor.value === 'function', 'Physical acquisition remains a captured owning method.'); let calls = 0;
		Object.defineProperty(Store.prototype, 'acquireBindingRead', { ...descriptor, value: () => { calls++; throw new Error('Replaced physical acquire must not be consulted.'); } });
		try {
			const ticket = readTicket(await f.server.transport.open(f.request), f.request);
			try { assert.equal(sha(await f.server.transport.read(ticket, 0, 19)), sha(f.entry.bytes.subarray(0, 19))); }
			finally { await f.server.transport.close({ id: ticket.id }); }
			assert.equal(calls, 0);
		} finally { Object.defineProperty(Store.prototype, 'acquireBindingRead', descriptor); }
	}, { length: 16_384 });
});

void test('Lightscaper native physical generation pin does not bypass real current custody after a head switch', { timeout: 15_000 }, async context => {
	await fixture(async f => {
		await physical(f); const ticket = readTicket(await f.server.transport.open(f.request), f.request);
		try {
			await repair(f, f.request, null, f.media, context.signal); await f.media.catalogOriginals.release(f.request.catalogId, [f.request.photoId]);
			await assert.rejects(f.server.transport.read(ticket, 0, 7), /custody|retained|root/iu);
			await assert.rejects(f.server.transport.open(f.request), /custody|retained|root/iu);
			await assert.rejects(f.media.deleteAsset(f.entry.original.storageKey), /pinned/iu); check();
		} finally { await f.server.transport.close({ id: ticket.id }); }
		await f.media.deleteAsset(f.entry.original.storageKey);
	}, { length: 16_384 });
});
