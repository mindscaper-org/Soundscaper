/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { DESKTOP_PHOTO_ORIGINAL_LIMITS_CURRENT_V1 as LIMITS,
	readDesktopPhotoOriginalRequestCurrentV1 as request, readDesktopPhotoOriginalTicketCurrentV1 as ticket,
	readDesktopPhotoOriginalTicketIdCurrentV1 as ticketId,
	type DesktopPhotoOriginalTicketCurrentV1 as Ticket, type DesktopPhotoOriginalTransportCurrentV1 as Transport } from '../src/lightscaper/desktop-photo-original-contract-current-v1.ts';
import type { PhotoLibraryOriginalRequestCurrentV1 as Request } from '../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import type { LightscaperNativePhotoOriginalsCurrentV1 as Originals, LightscaperNativePhotoOriginalViewCurrentV1 as View } from './lightscaper-native-photo-originals-current-v1.ts';

type Scope = Readonly<{ signal: AbortSignal; assertCurrent(): void }>;
type Budget = { work: number; tickets: number; bytes: number };
type Outcome = Readonly<{ okay: true }> | Readonly<{ okay: false; error: unknown }>;
interface Deferred<Value> { readonly promise: Promise<Value>; resolve(value: Value | PromiseLike<Value>): void; reject(reason: unknown): void }
interface Entry {
	readonly controller: AbortController; readonly signal: AbortSignal; readonly release: Deferred<void>;
	readonly ready: Deferred<Readonly<Ticket>>; readonly terminal: Deferred<Outcome>; readonly reads: Set<Promise<unknown>>; readonly failures: unknown[];
	id: string | null; request: Readonly<Request> | null; pull: View['read'] | null; started: boolean; bytes: number;
	busy: boolean; closing: Promise<void> | null;
}
const budgets = new WeakMap<AbortSignal, Budget>();
const NativeController = AbortController, ABORT = AbortController.prototype.abort;
const SIGNAL = Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal')!.get!;
const CHECK = AbortSignal.prototype.throwIfAborted, REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;
const NOOP = Promise.resolve();
function deferred<Value>(): Deferred<Value> {
	let resolve!: Deferred<Value>['resolve'], reject!: Deferred<Value>['reject'];
	const promise = new Promise<Value>((accept, refuse) => { resolve = accept; reject = refuse; }); return { promise, resolve, reject };
}
function remember(errors: unknown[], error: unknown): void { if (!errors.some(value => Object.is(value, error))) errors.push(error); }
function combine(errors: readonly unknown[], message: string): unknown { return errors.length === 1 ? errors[0] : new AggregateError(errors, message, { cause: errors[0] }); }
function failure(error: unknown, signal: AbortSignal): unknown { try { Reflect.apply(CHECK, signal, []); } catch (reason) { return reason; } return error; }
/** Only failures returned by the genuine reader enter this predicate. Borrowed
	* wire reflection errors never masquerade as native cleanup witnesses. */
function unproved(error: unknown, signal: AbortSignal): boolean {
	if (error === Reflect.apply(REASON, signal, [])) return false;
	return types.isNativeError(error) && Object.getOwnPropertyDescriptor(error, 'errors') !== undefined;
}

/** Fixed main-private transport. Its token retains the actual reader callback
	* through explicit consumer close; bytes, pins and callback retirement remain
	* separate. No renderer API is installed by constructing this owner. */
export class LightscaperNativePhotoOriginalTicketsCurrentV1 {
	readonly transport: Readonly<Transport>;
	readonly #originals: Originals; readonly #with: Originals['withOriginal'];
	readonly #scope: Scope; readonly #assert: Scope['assertCurrent']; readonly #unretired: () => void;
	readonly #budget: Budget; readonly #abort: () => void;
	readonly #entries = new Set<Entry>(); readonly #tickets = new Map<string, Entry>(); readonly #active = new Set<Promise<unknown>>();
	readonly #quarantined = new Set<Entry>(); readonly #failures: unknown[] = [];
	#closed = false; #notified = false; #reason: unknown = new Error('Native Original tickets are closed.'); #closing: Promise<void> | null = null;
	private constructor(originals: Originals, scope: Scope, unretired: () => void) {
		this.#originals = originals; this.#with = originals.withOriginal;
		if (typeof this.#with !== 'function') throw new TypeError('Native Original tickets require the actual bounded reader.');
		this.#scope = scope; this.#assert = scope.assertCurrent; this.#unretired = unretired;
		this.#budget = budgets.get(scope.signal) ?? { work: 0, tickets: 0, bytes: 0 }; budgets.set(scope.signal, this.#budget);
		this.transport = Object.freeze<Transport>({ open: value => this.#open(value), read: (value, offset, length) => this.#read(value, offset, length), close: value => this.#wireClose(value) });
		this.#abort = () => { void this.#close(Reflect.apply(REASON, scope.signal, [])).catch(() => undefined); };
		Reflect.apply(ADD, scope.signal, ['abort', this.#abort, { once: true }]);
		if (Reflect.apply(ABORTED, scope.signal, []) === true) this.#abort();
	}
	static create(value: Readonly<{ originals: Originals; scope: Scope; unretired(): void }>): LightscaperNativePhotoOriginalTicketsCurrentV1 {
		const input = record(value, 'native Original ticket owner', ['originals', 'scope', 'unretired']);
		const scopeValue = field(input, 'scope', 'native Original ticket owner'), scope = record(scopeValue, 'native Original ticket scope', ['signal', 'assertCurrent']);
		const signal: unknown = field(scope, 'signal', 'native Original ticket scope'), current: unknown = field(scope, 'assertCurrent', 'native Original ticket scope');
		const retired: unknown = field(input, 'unretired', 'native Original ticket owner');
		assertPhotoStackQuerySignalV1(signal);
		if (typeof current !== 'function' || typeof retired !== 'function') throw new TypeError('Native Original tickets require main-owned scope and retirement callbacks.');
		return new LightscaperNativePhotoOriginalTicketsCurrentV1(field(input, 'originals', 'native Original ticket owner') as Originals,
			Object.freeze({ signal, assertCurrent: () => { Reflect.apply(current, scopeValue, []); } }), () => { Reflect.apply(retired, value, []); });
	}
	close(): Promise<void> { return this.#close(this.#reason); }

	#open(value: unknown): Promise<unknown> {
		const slot = this.#slot<Readonly<Ticket>>(); if (!slot.okay) return slot.promise;
		const controller = new NativeController(), entry: Entry = { controller, signal: Reflect.apply(SIGNAL, controller, []) as AbortSignal,
			release: deferred<void>(), ready: deferred<Readonly<Ticket>>(), terminal: deferred<Outcome>(), reads: new Set(), failures: [],
			id: null, request: null, pull: null, started: false, bytes: 0, busy: false, closing: null };
		void entry.ready.promise.catch(() => undefined); this.#entries.add(entry);
		let captured: Readonly<Request>;
		try {
			this.#check(entry); captured = request(value); this.#check(entry);
			if (this.#budget.tickets >= LIMITS.maximumStages || captured.original.byteLength > LIMITS.maximumEncodedBytes - this.#budget.bytes) throw new RangeError('Native Original ticket capacity is full.');
			this.#budget.tickets++; this.#budget.bytes += captured.original.byteLength; entry.bytes = captured.original.byteLength; entry.request = captured;
			let id = randomBytes(32).toString('hex'), tries = 0;
			while (this.#tickets.has(id)) { if (++tries >= 8) throw new Error('Native Original ticket identifier collision.'); id = randomBytes(32).toString('hex'); }
			entry.id = id; this.#tickets.set(id, entry); this.#start(entry, captured);
		} catch (error) {
			const primary = failure(error, entry.signal); if (!entry.started) entry.terminal.resolve({ okay: true });
			void this.#retire(entry, primary).then(() => { slot.finish(false, primary); }, cleanup => { slot.finish(false, combine([primary, cleanup], 'Native Original admission and retirement failed.')); });
			return slot.promise;
		}
		void entry.ready.promise.then(issued => { this.#check(entry); return issued; }).then(
			issued => { slot.finish(true, issued); }, (error: unknown) => {
				const primary = failure(error, entry.signal);
				void this.#retire(entry, primary).then(() => { slot.finish(false, primary); }, cleanup => { slot.finish(false, combine([primary, cleanup], 'Native Original opening and retirement failed.')); });
			});
		return slot.promise;
	}
	#start(entry: Entry, captured: Readonly<Request>): void {
		entry.started = true;
		let actual: Promise<void>;
		try {
			actual = Reflect.apply(this.#with, this.#originals, [captured, async (view: Readonly<View>) => {
				this.#check(entry);
				const issued = ticket(Object.freeze({ id: entry.id!, original: view.original }), captured), read = view.read;
				if (typeof read !== 'function') throw new TypeError('The actual native Original view has no bounded reader.');
				entry.pull = (offset, length) => Reflect.apply(read, view, [offset, length]) as Promise<Uint8Array>;
				this.#check(entry); entry.ready.resolve(issued); await entry.release.promise;
			}, { signal: entry.signal }]) as Promise<void>;
		} catch (error) { this.#settled(entry, { okay: false, error }); return; }
		void actual.then(() => { this.#settled(entry, { okay: true }); }, (error: unknown) => { this.#settled(entry, { okay: false, error }); });
	}
	#settled(entry: Entry, outcome: Outcome): void {
		if (!outcome.okay) {
			if (unproved(outcome.error, entry.signal)) { remember(entry.failures, outcome.error); this.#latch(entry, outcome.error); }
			entry.ready.reject(failure(outcome.error, entry.signal));
		}
		entry.terminal.resolve(outcome);
	}
	#read(value: unknown, offset: number, length: number): Promise<unknown> {
		const slot = this.#slot<Uint8Array>(); if (!slot.okay) return slot.promise;
		let entry: Entry | undefined;
		try {
			this.#assertCurrent(); const id = ticketId(value), found = this.#tickets.get(id);
			if (!found || found.closing || !found.request || !found.pull) throw new Error('Native Original ticket is not live.');
			const captured = found.request; entry = found; this.#check(entry);
			if (entry.busy) throw new Error('A native Original ticket pull is already active.');
			ticket(value, captured);
			if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || Object.is(offset, -0)
				|| typeof length !== 'number' || !Number.isSafeInteger(length) || length < 1 || length > LIMITS.rangeBytes || offset + length > captured.original.byteLength) throw new RangeError('Native Original ticket requires a bounded byte range.');
			this.#check(entry); entry.busy = true; entry.reads.add(slot.promise);
		} catch (error) {
			const primary = !entry && this.#closed ? this.#reason : failure(error, entry?.signal ?? this.#scope.signal);
			slot.finish(false, primary); return slot.promise;
		}
		const selected = entry!;
		void (async () => {
			let bytes: Uint8Array | undefined;
			try {
				bytes = await selected.pull!(offset, length); this.#check(selected);
				if (!types.isUint8Array(bytes) || bytes.byteLength !== length) throw new Error('Native Original returned a malformed byte range.');
				return new Uint8Array(bytes);
			} catch (error) {
				if (unproved(error, selected.signal)) { remember(selected.failures, error); this.#latch(selected, error); }
				throw failure(error, selected.signal);
			} finally { bytes?.fill(0); }
		})().then(bytes => { selected.busy = false; selected.reads.delete(slot.promise); slot.finish(true, bytes); }, (error: unknown) => {
			selected.busy = false; selected.reads.delete(slot.promise); slot.finish(false, error);
		});
		return slot.promise;
	}
	#wireClose(value: unknown): Promise<void> {
		try {
			record(value, 'native Original ticket close', ['id']); const id = ticketId(value), entry = this.#tickets.get(id);
			return entry ? this.#retire(entry, new Error('Native Original ticket was closed.')) : NOOP;
		} catch (error) { return Promise.reject(error); }
	}
	#retire(entry: Entry, reason: unknown): Promise<void> {
		if (entry.closing) return entry.closing;
		const done = deferred<void>(); entry.closing = done.promise;
		entry.ready.reject(reason);
		try { Reflect.apply(ABORT, entry.controller, [reason]); } catch (error) { remember(entry.failures, error); this.#latch(entry, error); }
		entry.release.resolve();
		void Promise.allSettled([...entry.reads]).then(async () => {
			const outcome = await entry.terminal.promise;
			if (!outcome.okay && unproved(outcome.error, entry.signal)) remember(entry.failures, outcome.error);
			if (entry.failures.length) { this.#quarantined.add(entry); throw combine(entry.failures, 'Native Original ticket retirement is unproved.'); }
			this.#entries.delete(entry); if (entry.id) this.#tickets.delete(entry.id);
			if (entry.bytes) { this.#budget.tickets--; this.#budget.bytes -= entry.bytes; entry.bytes = 0; }
			entry.pull = null; entry.request = null;
		}).then(done.resolve, (error: unknown) => { this.#quarantined.add(entry); this.#latch(entry, error); done.reject(error); });
		return done.promise;
	}
	#close(reason: unknown): Promise<void> {
		if (this.#closing) return this.#closing;
		const done = deferred<void>(); this.#closing = done.promise; this.#closed = true; this.#reason = reason;
		const retiring = [...this.#entries].map(entry => this.#retire(entry, reason)), operations = [...this.#active];
		void Promise.allSettled([...retiring, ...operations]).then(() => {
			try { Reflect.apply(REMOVE, this.#scope.signal, ['abort', this.#abort]); } catch (error) { this.#latch(null, error); }
			if (this.#failures.length) throw combine(this.#failures, 'Native Original ticket owner retirement is unproved.');
		}).then(done.resolve, done.reject); return done.promise;
	}
	#latch(entry: Entry | null, error: unknown): void {
		remember(this.#failures, error); if (entry) this.#quarantined.add(entry);
		void this.#close(new Error('Native Original ticket retirement is unproved.')).catch(() => undefined);
		if (!this.#notified) {
			this.#notified = true;
			try { this.#unretired(); } catch (cleanup) { remember(this.#failures, cleanup); }
		}
	}
	#early(): void { if (this.#closed) throw this.#reason; Reflect.apply(CHECK, this.#scope.signal, []); }
	#assertCurrent(): void { this.#early(); Reflect.apply(this.#assert, this.#scope, []); this.#early(); }
	#check(entry: Entry): void { Reflect.apply(CHECK, entry.signal, []); this.#assertCurrent(); Reflect.apply(CHECK, entry.signal, []); }
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
