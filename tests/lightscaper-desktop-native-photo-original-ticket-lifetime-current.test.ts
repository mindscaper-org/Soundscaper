/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { nativeTicketTestCurrentV1 as test, checkTicketTestSignalCurrentV1 as checkTest } from './helpers/lightscaper-native-photo-original-ticket-fixture-current.ts';
import type { DesktopPhotoOriginalTicketCurrentV1 as Ticket } from '../src/lightscaper/desktop-photo-original-contract-current-v1.ts';
import { nativeOriginalTicketFixtureCurrentV1 as fixture, readTicket, holdTicketFileReadCurrentV1 as holdRead,
	deferred, remainsPending, exactTicketFailureCurrentV1 as exactFailure, observeTicketReaderCurrentV1, Tickets, waitFor } from './helpers/lightscaper-native-photo-original-ticket-fixture-current.ts';

function opaqueReason() { return new Proxy(Object.create(null) as object, { get() { throw new Error('An opaque abort reason was inspected.'); } }); }

void test('Lightscaper native ticket close cancels a held physical read and joins its actual retirement', { timeout: 15_000 }, async () => {
	await fixture(async f => { checkTest();
		const ticket = readTicket(await f.server.transport.open(f.request), f.request);
		await holdRead(f.appDataPath, async gate => {
			const work = f.server.transport.read(ticket, 0, 111); void work.catch(() => undefined); let close: Promise<void> | undefined;
			try {
				await gate.entered; close = f.server.transport.close({ id: ticket.id }); assert.equal(close, f.server.transport.close({ id: ticket.id }));
				assert.equal(await remainsPending(close), true); await assert.rejects(f.server.transport.read(ticket, 0, 1));
				gate.release(); await assert.rejects(work); await close;
			} finally { gate.release(); await Promise.allSettled([work, ...(close ? [close] : []), f.server.transport.close({ id: ticket.id })]); }
		});
	});
});

void test('Lightscaper native ticket owner close is cached and fences wire reflection while joining reads', { timeout: 15_000 }, async () => {
	await fixture(async f => { checkTest();
		const ticket = readTicket(await f.server.transport.open(f.request), f.request);
		await holdRead(f.appDataPath, async gate => {
			const work = f.server.transport.read(ticket, 0, 113); void work.catch(() => undefined); let close: Promise<void> | undefined, reflected = 0;
			const request = new Proxy(f.request, { ownKeys() { reflected++; throw new Error('Closed open reflected input.'); } });
			const value = new Proxy(ticket, { ownKeys() { reflected++; throw new Error('Closed read reflected input.'); } });
			try {
				await gate.entered; close = f.server.close(); assert.equal(close, f.server.close()); assert.equal(await remainsPending(close), true);
				await assert.rejects(f.server.transport.open(request)); await assert.rejects(f.server.transport.read(value, 0, 1)); assert.equal(reflected, 0);
				gate.release(); await assert.rejects(work); await close; await f.server.transport.close({ id: ticket.id });
			} finally { gate.release(); await Promise.allSettled([work, ...(close ? [close] : [])]); }
		});
	});
});

void test('Lightscaper native ticket scope cancellation preserves opaque reason and joins the held native pull', { timeout: 15_000 }, async () => {
	await fixture(async f => { checkTest();
		const ticket = readTicket(await f.server.transport.open(f.request), f.request);
		await holdRead(f.appDataPath, async gate => {
			const work = f.server.transport.read(ticket, 0, 119); void work.catch(() => undefined); let close: Promise<void> | undefined;
			const reason = opaqueReason();
			try {
				await gate.entered; f.scope.abort(reason); close = f.server.close(); assert.equal(await remainsPending(close), true);
				gate.release(); await exactFailure(work, reason); await close; await f.server.transport.close({ id: ticket.id });
			} finally { gate.release(); await Promise.allSettled([work, ...(close ? [close] : [])]); }
		});
	});
});

void test('Lightscaper native ticket admission is registered before reentrant scope shutdown and reflection failure', { timeout: 15_000 }, async () => {
	await fixture(async f => { checkTest();
		const reason = opaqueReason(); let calls = 0;
		const restore = observeTicketReaderCurrentV1(f.reader, (_request, _consume, _options, run) => { calls++; return run(); });
		const server = f.makeServer(); restore();
		const request = new Proxy(f.request, { ownKeys() { f.scope.abort(reason); throw new Error('Later borrowed reflection failure.'); } });
		const work = server.transport.open(request); void work.catch(() => undefined);
		await exactFailure(work, reason); await server.close(); assert.equal(calls, 0);
	});
});

void test('Lightscaper native ticket admission capacity refuses a fifth request before input reflection', { timeout: 15_000 }, async () => {
	await fixture(async f => { checkTest();
		const entered = deferred<void>(), release = deferred<void>(); let calls = 0, reflected = false;
		const restore = observeTicketReaderCurrentV1(f.reader, async (_request, _consume, _options, run) => {
			calls++; if (calls === 4) entered.resolve(); await release.promise; return run();
		});
		const server = f.makeServer(), sibling = f.makeServer(); restore(); const work: Promise<unknown>[] = [], issued: Readonly<Ticket>[] = [];
		try {
			for (let index = 0; index < 4; index++) { const pending = server.transport.open(f.request); void pending.catch(() => undefined); work.push(pending); }
			await entered.promise;
			const request = new Proxy(f.request, { ownKeys() { reflected = true; throw new Error('Busy admission reflected input.'); } });
			await assert.rejects(sibling.transport.open(request)); assert.equal(reflected, false); assert.equal(calls, 4);
			release.resolve(); for (const value of await Promise.all(work)) issued.push(readTicket(value, f.request));
		} finally {
			release.resolve(); await Promise.allSettled(work); await Promise.allSettled(issued.map(ticket => server.transport.close({ id: ticket.id }))); await server.close();
		}
	});
});

void test('Lightscaper native ticket read capacity refuses unbounded queueing and ignores busy request reflection', { timeout: 15_000 }, async () => {
	await fixture(async f => { checkTest();
		const tickets: Readonly<Ticket>[] = [];
		try {
			for (let index = 0; index < 5; index++) tickets.push(readTicket(await f.server.transport.open(f.request), f.request));
			await holdRead(f.appDataPath, async gate => {
				const reads: Promise<unknown>[] = []; let reflected = false;
				try {
					const first = f.server.transport.read(tickets[0]!, 0, 127); void first.catch(() => undefined); reads.push(first); await gate.entered;
					for (const ticket of tickets.slice(1, 4)) { const work = f.server.transport.read(ticket, 0, 127); void work.catch(() => undefined); reads.push(work); }
					const value = new Proxy(tickets[4]!, { ownKeys() { reflected = true; throw new Error('Busy read reflected input.'); } });
					await assert.rejects(f.server.transport.read(value, 0, 1)); assert.equal(reflected, false);
					await assert.rejects(f.server.transport.read(tickets[0]!, 0, 1));
					gate.release(); const values = await Promise.all(reads); assert.equal(values.length, 4);
					assert.ok(await f.server.transport.read(tickets[4]!, 0, 1) instanceof Uint8Array);
				} finally { gate.release(); await Promise.allSettled(reads); }
			});
		} finally { await Promise.all(tickets.map(ticket => f.server.transport.close({ id: ticket.id }))); }
	});
});

void test('Lightscaper native ticket cleanup failure quarantines immediately and preserves captured callback receiver', { timeout: 15_000 }, async () => {
	await fixture(async f => { checkTest();
		const receiptFailure = new AggregateError([new Error('Actual reader terminal receipt refused after real retirement.')], 'Injected terminal receipt fault');
		const held = deferred<void>(), release = deferred<void>(); let calls = 0, captured = 0, replacement = 0, receiverMatches = false;
		// These wrappers always execute the genuine reader and wait its actual
		// callback/SQL/file retirement; only the trusted terminal receipt is faulted.
		const restore = observeTicketReaderCurrentV1(f.reader, (_request, _consume, _options, run) => {
			const index = ++calls;
			return run().then(value => { if (index === 1) throw receiptFailure; return value; }, async (error: unknown) => {
				if (index === 1) throw receiptFailure; held.resolve(); await release.promise; throw error;
			});
		});
		const options = { originals: f.reader, scope: { signal: f.scope.signal, assertCurrent: () => { f.scope.signal.throwIfAborted(); } },
			unretired() { captured++; receiverMatches = this === options; } };
		const server = Tickets.create(options); restore(); options.unretired = () => { replacement++; };
		const issued: Readonly<Ticket>[] = []; let close: Promise<void> | undefined;
		try {
			for (let index = 0; index < 2; index++) issued.push(readTicket(await server.transport.open(f.request), f.request));
			close = server.close(); void close.catch(() => undefined); await held.promise; await waitFor(() => captured > 0, 'actual ticket terminal cleanup refusal reaches captured quarantine');
			assert.equal(captured >= 1, true); assert.equal(replacement, 0); assert.equal(receiverMatches, true); assert.equal(await remainsPending(close), true);
			await assert.rejects(server.transport.open(f.request)); release.resolve(); await assert.rejects(close);
		} finally { release.resolve(); await Promise.allSettled([...(close ? [close] : []), ...issued.map(ticket => server.transport.close({ id: ticket.id })), server.close()]); }
	});
});
