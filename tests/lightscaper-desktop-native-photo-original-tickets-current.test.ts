/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { nativeTicketTestCurrentV1 as test, checkTicketTestSignalCurrentV1 as checkTest } from './helpers/lightscaper-native-photo-original-ticket-fixture-current.ts';
import type { DesktopPhotoOriginalTicketCurrentV1 as Ticket } from '../src/lightscaper/desktop-photo-original-contract-current-v1.ts';
import { nativeOriginalTicketFixtureCurrentV1 as fixture, readTicket, ticketShaCurrentV1 as sha, Media,
	TICKET_CATALOG_CURRENT_V1 as CATALOG, observeTicketReaderCurrentV1, Tickets } from './helpers/lightscaper-native-photo-original-ticket-fixture-current.ts';
import { photoImportIntentKeyV1 } from '../src/lightscaper/import/import-intent-v1.ts';

void test('Lightscaper native Original tickets expose exactly the fixed transport and actual bounded copied bytes', { timeout: 15_000 }, async () => {
	await fixture(async f => { checkTest();
		const transport = f.server.transport; assert.equal(Object.isFrozen(transport), true); assert.deepEqual(Object.keys(transport), ['open', 'read', 'close']);
		const ticket = readTicket(await transport.open(f.request), f.request);
		try {
			assert.deepEqual(Object.keys(ticket), ['id', 'original']); assert.match(ticket.id, /^[a-f0-9]{64}$/u); assert.deepEqual(ticket.original, f.entry.original);
			const bytes = await transport.read(ticket, 0, 127); assert.ok(bytes instanceof Uint8Array); assert.equal(sha(bytes), sha(f.entry.bytes.subarray(0, 127)));
			bytes.fill(0); const next = await transport.read(ticket, 0, 127); assert.ok(next instanceof Uint8Array); assert.equal(sha(next), sha(f.entry.bytes.subarray(0, 127)));
		} finally { await transport.close({ id: ticket.id }); }
	});
});

void test('Lightscaper native Original ticket read requires the exact issued Original and bounded nonoverlapping wire range', { timeout: 15_000 }, async () => {
	await fixture(async f => { checkTest();
		const transport = f.server.transport, ticket = readTicket(await transport.open(f.request), f.request);
		try {
			for (const value of [{ ...ticket, original: { ...ticket.original, name: 'Different identity.dng' } },
				{ ...ticket, unexpected: true }, { ...ticket, id: 'F'.repeat(64) }, { id: ticket.id }]) await assert.rejects(transport.read(value as typeof ticket, 0, 1));
			for (const [offset, length] of [[-0, 1], [-1, 1], [0, 0], [0, 1_048_577], [0.5, 1], [f.entry.bytes.length, 1]]) await assert.rejects(transport.read(ticket, offset!, length!));
			const bytes = await transport.read(ticket, 1, 7); assert.ok(bytes instanceof Uint8Array); assert.equal(sha(bytes), sha(f.entry.bytes.subarray(1, 8)));
		} finally { await transport.close({ id: ticket.id }); }
	});
});

void test('Lightscaper native Original tickets deny foreign server IDs and permit idempotent ID-only cleanup', { timeout: 15_000 }, async () => {
	await fixture(async f => { checkTest();
		const peer = f.makeServer(f.readerFor()), ticket = readTicket(await f.server.transport.open(f.request), f.request);
		await assert.rejects(peer.transport.read(ticket, 0, 1)); await peer.transport.close({ id: ticket.id });
		const bytes = await f.server.transport.read(ticket, 0, 1); assert.ok(bytes instanceof Uint8Array);
		await f.server.transport.close({ id: ticket.id }); await f.server.transport.close({ id: ticket.id });
		await assert.rejects(f.server.transport.read(ticket, 0, 1)); await f.server.close(); await f.server.transport.close({ id: ticket.id });
	});
});

void test('Lightscaper native Original ticket reserves the actual reader callback after the last range', { timeout: 15_000 }, async () => {
	await fixture(async f => { checkTest();
		const peer = await Media.open({ appDataPath: f.appDataPath }), ticket = readTicket(await f.server.transport.open(f.request), f.request);
		try {
			const bytes = await f.server.transport.read(ticket, 0, f.entry.bytes.length); assert.ok(bytes instanceof Uint8Array);
			await peer.catalogOriginals.release(CATALOG, [f.entry.photo.id]); await assert.rejects(peer.deleteAsset(f.entry.original.storageKey));
			await f.server.transport.close({ id: ticket.id }); await peer.deleteAsset(f.entry.original.storageKey);
		} finally { await f.server.transport.close({ id: ticket.id }); await peer.close(); }
	});
});

void test('Lightscaper native Original tickets preserve active staged-to-permanent custody and attribute edit parity', { timeout: 15_000 }, async () => {
	await fixture(async f => { checkTest();
		const ticket = readTicket(await f.server.transport.open(f.request), f.request);
		try {
			await f.catalog.savePhoto({ ...f.entry.photo, rating: 5, flag: 'pick' }, f.entry.photo.revision);
			await f.media.catalogOriginals.promote(CATALOG, 'ticket-import', [f.entry.photo.id]); await f.settings.settingsRepository.delete(photoImportIntentKeyV1(CATALOG));
			const bytes = await f.server.transport.read(ticket, 0, 33); assert.ok(bytes instanceof Uint8Array); assert.equal(sha(bytes), sha(f.entry.bytes.subarray(0, 33)));
		} finally { await f.server.transport.close({ id: ticket.id }); }
	}, { staged: 'ticket-import' });
});

void test('Lightscaper native Original ticket admission captures request before asynchronous work', { timeout: 15_000 }, async () => {
	await fixture(async f => { checkTest();
		const request = { ...f.request, original: { ...f.entry.original } }, work = f.server.transport.open(request);
		request.photoId = 'changed-after-admission'; request.original.name = 'Changed after admission.dng';
		const ticket = readTicket(await work, f.request);
		try { const bytes = await f.server.transport.read(ticket, 0, 9); assert.ok(bytes instanceof Uint8Array); assert.equal(sha(bytes), sha(f.entry.bytes.subarray(0, 9))); }
		finally { await f.server.transport.close({ id: ticket.id }); }
	});
});

void test('Lightscaper native Original tickets capture the actual reader method before public replacement', { timeout: 15_000 }, async () => {
	await fixture(async f => { checkTest();
		const actual = f.reader.withOriginal, descriptor = Object.getOwnPropertyDescriptor(f.reader, 'withOriginal'); let replacementCalls = 0;
		Object.defineProperty(f.reader, 'withOriginal', { configurable: true, value: () => { replacementCalls++; return Promise.reject(new Error('Borrowed replacement.')); } });
		try {
			const ticket = readTicket(await f.server.transport.open(f.request), f.request); await f.server.transport.close({ id: ticket.id }); assert.equal(replacementCalls, 0);
		} finally { if (descriptor) Object.defineProperty(f.reader, 'withOriginal', descriptor); else { Reflect.deleteProperty(f.reader, 'withOriginal'); assert.equal(f.reader.withOriginal, actual); } }
	});
});

void test('Lightscaper native Original ticket idle callbacks do not retain the four admission slots', { timeout: 15_000 }, async () => {
	await fixture(async f => { checkTest();
		const tickets: Readonly<Ticket>[] = [];
		try { for (let index = 0; index < 8; index++) tickets.push(readTicket(await f.server.transport.open(f.request), f.request));
			assert.equal(new Set(tickets.map(ticket => ticket.id)).size, 8);
			const bytes = await f.server.transport.read(tickets[7]!, 0, 1); assert.ok(bytes instanceof Uint8Array);
		} finally { await Promise.all(tickets.map(ticket => f.server.transport.close({ id: ticket.id }))); }
	});
});

void test('Lightscaper native Original tickets enforce384MiB using actual repeated body reservations', { timeout: 15_000 }, async () => {
	await fixture(async f => { checkTest();
		let calls = 0; const restore = observeTicketReaderCurrentV1(f.reader, (_request, _consume, _options, run) => { calls++; return run(); });
		const server = f.makeServer(), sibling = f.makeServer(), tickets: Array<{ owner: Tickets; ticket: Readonly<Ticket> }> = [], maximum = Math.floor(384 * 1024 * 1024 / f.entry.bytes.length);
		restore();
		try {
			for (let index = 0; index < maximum; index++) { checkTest(); const owner = index % 2 ? sibling : server; tickets.push({ owner, ticket: readTicket(await owner.transport.open(f.request), f.request) }); }
			assert.equal(calls, maximum); await assert.rejects(sibling.transport.open(f.request)); assert.equal(calls, maximum);
			const retired = tickets.pop()!; await retired.owner.transport.close({ id: retired.ticket.id });
			tickets.push({ owner: sibling, ticket: readTicket(await sibling.transport.open(f.request), f.request) }); assert.equal(calls, maximum + 1);
		} finally { await Promise.all(tickets.map(value => value.owner.transport.close({ id: value.ticket.id }))); }
	}, { length: 2 * 1024 * 1024 + 31 });
});

void test('Lightscaper native Original tickets enforce4094 entries before invoking the actual reader', { timeout: 15_000 }, async () => {
	await fixture(async f => { checkTest();
		let calls = 0; const restore = observeTicketReaderCurrentV1(f.reader, (_request, _consume, _options, run) => { calls++; return run(); });
		const server = f.makeServer(), tickets: Readonly<Ticket>[] = []; restore();
		try {
			for (let index = 0; index < 4094; index++) { checkTest(); tickets.push(readTicket(await server.transport.open(f.request), f.request)); }
			assert.equal(calls, 4094); await assert.rejects(server.transport.open(f.request)); assert.equal(calls, 4094);
			const retired = tickets.pop()!; await server.transport.close({ id: retired.id });
			tickets.push(readTicket(await server.transport.open(f.request), f.request)); assert.equal(calls, 4095);
		} finally { await Promise.all(tickets.map(ticket => server.transport.close({ id: ticket.id }))); }
	}, { length: 1 });
});
