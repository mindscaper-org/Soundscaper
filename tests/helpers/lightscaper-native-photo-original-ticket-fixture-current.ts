/* SPDX-License-Identifier: AGPL-3.0-only */

import { AsyncLocalStorage } from 'node:async_hooks';
import { test as nativeTest, type TestContext, type TestOptions } from 'node:test';
import { deferred as nativeDeferred } from './async-test-control.ts';
import { LightscaperNativePhotoOriginalTicketsCurrentV1 as Tickets } from '../../desktop/lightscaper-native-photo-original-tickets-current-v1.ts';
import type { LightscaperNativePhotoOriginalsCurrentV1 as Originals, LightscaperNativePhotoOriginalViewCurrentV1 as View } from '../../desktop/lightscaper-native-photo-originals-current-v1.ts';
import { readDesktopPhotoOriginalTicketCurrentV1 as readTicket } from '../../src/lightscaper/desktop-photo-original-contract-current-v1.ts';
import { nativeOriginalReaderFixtureCurrentV1, holdReaderFileReadCurrentV1 as holdNativeRead, type ReaderFixtureCurrentV1 } from './lightscaper-native-photo-original-reader-fixture-current.ts';
export { Tickets, readTicket };
export { readerShaCurrentV1 as ticketShaCurrentV1,
	exactReaderFailureCurrentV1 as exactTicketFailureCurrentV1, remainsPending, Media,
	READER_CATALOG_CURRENT_V1 as TICKET_CATALOG_CURRENT_V1 } from './lightscaper-native-photo-original-reader-fixture-current.ts';
export type { Originals, View };
export { waitFor } from './async-test-control.ts';
interface TestOwnership { readonly signal: AbortSignal; readonly releases: Set<() => void>; readonly servers: Set<Tickets> }
const testOwnership = new AsyncLocalStorage<TestOwnership>();
/** Node's deadline signal owns real gate release and native close, rather than
	* merely reporting a timeout while a fixture still waits for its own barrier. */
export function nativeTicketTestCurrentV1(name: string, options: TestOptions, run: (context: TestContext) => void | Promise<void>): Promise<void> {
	return nativeTest(name, options, async context => {
		const ownership: TestOwnership = { signal: context.signal, releases: new Set(), servers: new Set() };
		const release = (): void => {
			for (const retire of ownership.releases) retire();
			for (const server of ownership.servers) void server.close().catch(() => undefined);
		};
		context.signal.addEventListener('abort', release, { once: true });
		try { await testOwnership.run(ownership, () => run(context)); }
		finally {
			context.signal.removeEventListener('abort', release); release();
			await Promise.allSettled([...ownership.servers].map(server => server.close()));
		}
	});
}
export function deferred<Value extends void = void>() {
	const value = nativeDeferred<Value>(), ownership = testOwnership.getStore();
	const release = (): void => { value.resolve(undefined as Value); };
	ownership?.releases.add(release);
	void value.promise.then(() => { ownership?.releases.delete(release); }, () => { ownership?.releases.delete(release); });
	if (ownership?.signal.aborted) release(); return value;
}
export async function holdTicketFileReadCurrentV1<Result>(directory: string,
	run: (gate: Readonly<{ entered: Promise<void>; release(): void }>) => Promise<Result>): Promise<Result> {
	return await holdNativeRead(directory, async gate => {
		const ownership = testOwnership.getStore(), entered = nativeDeferred<void>();
		void gate.entered.then(entered.resolve, entered.reject);
		// This is a control barrier, not a substitute completion for native IO.
		// Deadline cancellation wakes a test whose read never reached the gate;
		// its existing finally must still join that actual read and native close.
		const release = (): void => { gate.release(); entered.resolve(); };
		ownership?.releases.add(release); if (ownership?.signal.aborted) release();
		try { return await run({ entered: entered.promise, release }); } finally { ownership?.releases.delete(release); }
	});
}
export function checkTicketTestSignalCurrentV1(): void { testOwnership.getStore()?.signal.throwIfAborted(); }
export interface TicketFixtureCurrentV1 extends ReaderFixtureCurrentV1 {
	readonly server: Tickets; readonly alerts: unknown[];
	makeServer(originals?: Originals): Tickets;
}
export async function nativeOriginalTicketFixtureCurrentV1(run: (fixture: TicketFixtureCurrentV1) => Promise<void>,
	options: Readonly<{ length?: number; staged?: string }> = {}): Promise<void> {
	await nativeOriginalReaderFixtureCurrentV1(async f => {
		const servers: Tickets[] = [], alerts: unknown[] = [], ownership = testOwnership.getStore();
		const abort = (): void => { if (ownership?.signal.aborted) f.scope.abort(ownership.signal.reason); };
		ownership?.releases.add(abort);
		const makeServer = (originals = f.reader): Tickets => {
			const server = Tickets.create({ originals, scope: { signal: f.scope.signal, assertCurrent: () => { f.scope.signal.throwIfAborted(); } },
				unretired: () => { alerts.push('unretired'); } }); servers.push(server); ownership?.servers.add(server);
			if (ownership?.signal.aborted) { abort(); void server.close().catch(() => undefined); } return server;
		};
		let failed = false, primary: unknown; abort();
		try { await run({ ...f, server: makeServer(), makeServer, alerts }); } catch (error) { failed = true; primary = error; }
		const results = await Promise.allSettled(servers.map(server => server.close()));
		ownership?.releases.delete(abort);
		const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
		if (errors.length) throw new AggregateError([...(failed ? [primary] : []), ...errors], 'Native ticket fixture retirement is unproved; files retained.');
		if (failed) throw primary;
	}, { length: options.length ?? 65_536, ...(options.staged ? { staged: options.staged } : {}) });
}
/** Observe the actual native reader, retaining its real callback, SQL checks,
	* ranges and retirement. No substitute view, body, repository or Session exists. */
export function observeTicketReaderCurrentV1(reader: Originals,
	observe: <Result>(request: unknown, consume: (view: Readonly<View>) => Result | PromiseLike<Result>,
		options: Readonly<{ signal?: AbortSignal }>, run: () => Promise<Result>) => Promise<Result>): () => void {
	const descriptor = Object.getOwnPropertyDescriptor(reader, 'withOriginal'), actual = reader.withOriginal;
	function captured<Result>(request: unknown, consume: (view: Readonly<View>) => Result | PromiseLike<Result>, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Result> {
		return observe(request, consume, options, () => Reflect.apply(actual, reader, [request, consume, options]) as Promise<Result>);
	}
	Object.defineProperty(reader, 'withOriginal', { configurable: true, writable: true, value: captured });
	return () => { if (descriptor) Object.defineProperty(reader, 'withOriginal', descriptor); else Reflect.deleteProperty(reader, 'withOriginal'); };
}
