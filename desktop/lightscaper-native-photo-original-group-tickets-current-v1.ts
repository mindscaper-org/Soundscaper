/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { readClosedDomainRecord as record } from '../src/common/foundation/closed-domain-value.ts';
import { readPhotoLibraryOriginalGroupCurrentV1 as plan } from '../src/lightscaper/controller/photo-library-original-group-contract-current-v1.ts';
import { DESKTOP_PHOTO_ORIGINAL_LIMITS_CURRENT_V1 as LIMITS, readDesktopPhotoOriginalRequestCurrentV1 as request } from '../src/lightscaper/desktop-photo-original-contract-current-v1.ts';
import { readDesktopPhotoOriginalGroupTicketCurrentV1 as ticket, readDesktopPhotoOriginalGroupTicketIdCurrentV1 as ticketId,
	type DesktopPhotoOriginalGroupTicketCurrentV1 as Ticket } from '../src/lightscaper/desktop-photo-original-group-contract-current-v1.ts';
import type { PhotoLibraryOriginalRequestCurrentV1 as Request } from '../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import type { LightscaperNativePhotoOriginalsCurrentV1 as Originals, LightscaperNativePhotoOriginalGroupViewCurrentV1 as View } from './lightscaper-native-photo-originals-current-v1.ts';
import type { LightscaperNativePhotoOriginalTicketBudgetCurrentV1 as Budget } from './lightscaper-native-photo-original-ticket-budget-current-v1.ts';

type Outcome = Readonly<{ okay: true }> | Readonly<{ okay: false; error: unknown }>;
interface Deferred<Value> { readonly promise: Promise<Value>; resolve(value: Value | PromiseLike<Value>): void; reject(reason: unknown): void }
interface Entry {
	readonly controller: AbortController; readonly signal: AbortSignal; readonly release: Deferred<void>; readonly ready: Deferred<Readonly<Ticket>>;
	readonly terminal: Deferred<Outcome>; readonly reads: Set<Promise<unknown>>; readonly busy: Set<number>; readonly failures: unknown[];
	id: string | null; requests: readonly Readonly<Request>[] | null; pull: View['read'] | null; started: boolean; count: number; bytes: number; closing: Promise<void> | null;
}
const NativeController = AbortController, ABORT = AbortController.prototype.abort;
const SIGNAL = Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal')!.get!;
const CHECK = AbortSignal.prototype.throwIfAborted, REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const NOOP = Promise.resolve();
function deferred<Value>(): Deferred<Value> {
	let resolve!: Deferred<Value>['resolve'], reject!: Deferred<Value>['reject'];
	const promise = new Promise<Value>((accept, refuse) => { resolve = accept; reject = refuse; }); return { promise, resolve, reject };
}
function remember(errors: unknown[], error: unknown): void { if (!errors.some(value => Object.is(value, error))) errors.push(error); }
function combine(errors: readonly unknown[], message: string): unknown { return errors.length === 1 ? errors[0] : new AggregateError(errors, message, { cause: errors[0] }); }
function failure(error: unknown, signal: AbortSignal): unknown { try { Reflect.apply(CHECK, signal, []); } catch (reason) { return reason; } return error; }
function unproved(error: unknown, signal: AbortSignal): boolean {
	return !Object.is(error, Reflect.apply(REASON, signal, [])) && types.isNativeError(error) && Object.getOwnPropertyDescriptor(error, 'errors') !== undefined;
}
/** One private group registry, one public ID and no prefix receipts. The actual
 * Reader owns the namespace-global physical booking and every alias pin. */
export class LightscaperNativePhotoOriginalGroupTicketsCurrentV1 {
	readonly #originals: Originals; readonly #with: Originals['withOriginalGroup']; readonly #budget: Budget;
	readonly #assert: () => void; readonly #notify: (error: unknown) => void;
	readonly #entries = new Set<Entry>(); readonly #tickets = new Map<string, Entry>(); readonly #active = new Set<Promise<unknown>>();
	readonly #quarantined = new Set<Entry>(); readonly #failures: unknown[] = [];
	#closed = false; #reason: unknown = new Error('Native Original group tickets are closed.'); #closing: Promise<void> | null = null;
	constructor(originals: Originals, budget: Budget, assertCurrent: () => void, unretired: (error: unknown) => void) {
		this.#originals = originals; this.#with = originals.withOriginalGroup;
		if (typeof this.#with !== 'function') throw new TypeError('Native Original tickets require the complete actual group reader.');
		this.#budget = budget; this.#assert = assertCurrent; this.#notify = unretired;
	}
	open(value: unknown): Promise<unknown> {
		const slot = this.#slot<Readonly<Ticket>>(); if (!slot.okay) return slot.promise;
		const controller = new NativeController(), entry: Entry = { controller, signal: Reflect.apply(SIGNAL, controller, []) as AbortSignal,
			release: deferred<void>(), ready: deferred<Readonly<Ticket>>(), terminal: deferred<Outcome>(), reads: new Set(), busy: new Set(), failures: [],
			id: null, requests: null, pull: null, started: false, count: 0, bytes: 0, closing: null };
		void entry.ready.promise.catch(() => undefined); this.#entries.add(entry);
		try {
			this.#check(entry); const captured = plan(value), requests = Object.freeze(captured.requests.map(request)); this.#check(entry);
			if (!requests.length) {
				entry.terminal.resolve({ okay: true }); this.#entries.delete(entry);
				slot.finish(true, Object.freeze({ id: randomBytes(32).toString('hex'), originals: Object.freeze([]) })); return slot.promise;
			}
			if (requests.length > LIMITS.maximumStages - this.#budget.tickets || captured.uniqueEncodedBytes > LIMITS.maximumEncodedBytes - this.#budget.bytes) throw new RangeError('Native Original group ticket capacity is full.');
			this.#budget.tickets += requests.length; this.#budget.bytes += captured.uniqueEncodedBytes;
			entry.count = requests.length; entry.bytes = captured.uniqueEncodedBytes; entry.requests = requests;
			let id = randomBytes(32).toString('hex'), tries = 0;
			while (this.#tickets.has(id)) { if (++tries >= 8) throw new Error('Native Original group identifier collision.'); id = randomBytes(32).toString('hex'); }
			entry.id = id; this.#tickets.set(id, entry); this.#start(entry, requests);
		} catch (error) {
			const primary = failure(error, entry.signal); if (!entry.started) entry.terminal.resolve({ okay: true });
			void this.#retire(entry, primary).then(() => { slot.finish(false, primary); }, cleanup => { slot.finish(false, combine([primary, cleanup], 'Native Original group admission and retirement failed.')); }); return slot.promise;
		}
		void entry.ready.promise.then(issued => { this.#check(entry); return issued; }).then(issued => { slot.finish(true, issued); }, (error: unknown) => {
			const primary = failure(error, entry.signal);
			void this.#retire(entry, primary).then(() => { slot.finish(false, primary); }, cleanup => { slot.finish(false, combine([primary, cleanup], 'Native Original group opening and retirement failed.')); });
		}); return slot.promise;
	}
	#start(entry: Entry, requests: readonly Readonly<Request>[]): void {
		entry.started = true; let actual: Promise<void>;
		try {
			actual = Reflect.apply(this.#with, this.#originals, [requests, async (view: Readonly<View>) => {
				this.#check(entry); const issued = ticket(Object.freeze({ id: entry.id!, originals: view.originals }), requests), read = view.read;
				if (typeof read !== 'function') throw new TypeError('The actual native Original group has no indexed bounded reader.');
				entry.pull = (index, offset, length) => Reflect.apply(read, view, [index, offset, length]) as Promise<Uint8Array>;
				this.#check(entry); entry.ready.resolve(issued); await entry.release.promise;
			}, { signal: entry.signal }]) as Promise<void>;
		} catch (error) { this.#settled(entry, { okay: false, error }); return; }
		void actual.then(() => { this.#settled(entry, { okay: true }); }, (error: unknown) => { this.#settled(entry, { okay: false, error }); });
	}
	#settled(entry: Entry, outcome: Outcome): void {
		if (!outcome.okay) { if (unproved(outcome.error, entry.signal)) { remember(entry.failures, outcome.error); this.#latch(entry, outcome.error); } entry.ready.reject(failure(outcome.error, entry.signal)); }
		entry.terminal.resolve(outcome);
	}
	read(value: unknown, index: number, offset: number, length: number): Promise<unknown> {
		const slot = this.#slot<Uint8Array>(); if (!slot.okay) return slot.promise; let entry: Entry | undefined;
		try {
			this.#assert(); record(value, 'native Original group range owner', ['id']); const found = this.#tickets.get(ticketId(value));
			if (!found || found.closing || !found.requests || !found.pull) throw new Error('Native Original group ticket is not live.');
			entry = found; this.#check(entry);
			if (!Number.isSafeInteger(index) || Object.is(index, -0) || index < 0 || index >= found.requests.length) throw new RangeError('Native Original group index is invalid.');
			if (entry.busy.has(index)) throw new Error('A native Original group alias pull is already active.');
			const original = found.requests[index]!.original;
			if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || Object.is(offset, -0)
				|| typeof length !== 'number' || !Number.isSafeInteger(length) || length < 1 || length > LIMITS.rangeBytes || offset + length > original.byteLength) throw new RangeError('Native Original group ticket requires a bounded byte range.');
			this.#check(entry); entry.busy.add(index); entry.reads.add(slot.promise);
		} catch (error) { slot.finish(false, entry ? failure(error, entry.signal) : this.#closed ? this.#reason : error); return slot.promise; }
		const selected = entry!;
		void (async () => {
			let bytes: Uint8Array | undefined;
			try { bytes = await selected.pull!(index, offset, length); this.#check(selected);
				if (!types.isUint8Array(bytes) || bytes.byteLength !== length) throw new Error('Native Original group returned a malformed range.'); return new Uint8Array(bytes);
			} catch (error) { if (unproved(error, selected.signal)) { remember(selected.failures, error); this.#latch(selected, error); } throw failure(error, selected.signal); }
			finally { bytes?.fill(0); }
		})().then(bytes => { selected.busy.delete(index); selected.reads.delete(slot.promise); slot.finish(true, bytes); }, (error: unknown) => {
			selected.busy.delete(index); selected.reads.delete(slot.promise); slot.finish(false, error);
		}); return slot.promise;
	}
	closeTicket(value: unknown): Promise<void> {
		try { record(value, 'native Original group close', ['id']); const entry = this.#tickets.get(ticketId(value)); return entry ? this.#retire(entry, new Error('Native Original group ticket was closed.')) : NOOP; }
		catch (error) { return Promise.reject(error); }
	}
	#retire(entry: Entry, reason: unknown): Promise<void> {
		if (entry.closing) return entry.closing; const done = deferred<void>(); entry.closing = done.promise;
		entry.ready.reject(reason);
		try { Reflect.apply(ABORT, entry.controller, [reason]); } catch (error) { remember(entry.failures, error); this.#latch(entry, error); }
		entry.release.resolve();
		void Promise.allSettled([...entry.reads]).then(async () => {
			const outcome = await entry.terminal.promise;
			if (!outcome.okay && unproved(outcome.error, entry.signal)) remember(entry.failures, outcome.error);
			if (entry.failures.length) { this.#quarantined.add(entry); throw combine(entry.failures, 'Native Original group retirement is unproved.'); }
			this.#entries.delete(entry); if (entry.id) this.#tickets.delete(entry.id);
			this.#budget.tickets -= entry.count; this.#budget.bytes -= entry.bytes; entry.count = 0; entry.bytes = 0; entry.pull = null; entry.requests = null;
		}).then(done.resolve, (error: unknown) => { this.#quarantined.add(entry); this.#latch(entry, error); done.reject(error); }); return done.promise;
	}
	close(reason: unknown): Promise<void> {
		if (this.#closing) return this.#closing; const done = deferred<void>(); this.#closing = done.promise; this.#closed = true; this.#reason = reason;
		const retiring = [...this.#entries].map(entry => this.#retire(entry, reason)), operations = [...this.#active];
		void Promise.allSettled([...retiring, ...operations]).then(() => { if (this.#failures.length) throw combine(this.#failures, 'Native Original group owner retirement is unproved.'); }).then(done.resolve, done.reject); return done.promise;
	}
	#latch(entry: Entry, error: unknown): void {
		remember(this.#failures, error); this.#quarantined.add(entry);
		void this.close(new Error('Native Original group retirement is unproved.')).catch(() => undefined); this.#notify(error);
	}
	#check(entry: Entry): void { Reflect.apply(CHECK, entry.signal, []); this.#early(); Reflect.apply(CHECK, entry.signal, []); }
	#early(): void { if (this.#closed) throw this.#reason; this.#assert(); }
	#slot<Value>(): Readonly<{ okay: false; promise: Promise<Value> }> | Readonly<{ okay: true; promise: Promise<Value>; finish(okay: boolean, value: unknown): void }> {
		try { this.#early(); if (this.#budget.work >= LIMITS.maximumAcquisitions) throw new RangeError('Native Original ticket work capacity is full.'); }
		catch (error) { return { okay: false, promise: Promise.reject(error) }; }
		this.#budget.work++; const pending = deferred<Value>(); this.#active.add(pending.promise); let finished = false;
		return { okay: true, promise: pending.promise, finish: (okay, value) => {
			if (finished) return; finished = true; this.#budget.work--; this.#active.delete(pending.promise);
			if (okay) pending.resolve(value as Value); else pending.reject(value);
		} };
	}
}
