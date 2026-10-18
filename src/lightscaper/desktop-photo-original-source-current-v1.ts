/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';
import { assertPhotoStackQuerySignalV1 } from './catalog/photo-stack-query-signal-v1.ts';
import type { PhotoLibraryOriginalRequestCurrentV1, PhotoLibraryOriginalSourceCurrentV1 } from './controller/photo-library-original-source-current-v1.ts';
import { DesktopPhotoOriginalStageCurrentV1 } from './desktop-photo-original-stage-current-v1.ts';
import { DESKTOP_PHOTO_ORIGINAL_LIMITS_CURRENT_V1 as LIMITS, readDesktopPhotoOriginalRequestCurrentV1 as request,
	readDesktopPhotoOriginalTicketCurrentV1 as ticket, readDesktopPhotoOriginalTicketIdCurrentV1 as ticketId,
	type DesktopPhotoOriginalStorageCurrentV1, type DesktopPhotoOriginalSourceOptionsCurrentV1,
	type DesktopPhotoOriginalTransportCurrentV1 } from './desktop-photo-original-contract-current-v1.ts';
export type { DesktopPhotoOriginalStorageCurrentV1, DesktopPhotoOriginalTransportCurrentV1 } from './desktop-photo-original-contract-current-v1.ts';

const NativeController = AbortController, ABORT = AbortController.prototype.abort;
const SIGNAL = Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal')!.get!;
const CHECK = AbortSignal.prototype.throwIfAborted, ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;
export interface DesktopPhotoOriginalLeaseCurrentV1 { readonly body: File; close(): Promise<void> }
interface Entry {
	readonly controller: AbortController; readonly signal: AbortSignal; readonly stage: DesktopPhotoOriginalStageCurrentV1;
	readonly done: Promise<void>; readonly resolveDone: () => void;
	detach: () => void; release?: () => Promise<void>; published: boolean; reservedBytes: number;
}

/** Fixed renderer staging owner. Live File leases are retired by the scoped
 * consumer after its real work joins; owner close cannot infer that barrier.
 * No production Session/IPC selection or public policy is installed here. */
export class DesktopPhotoOriginalSourceCurrentV1 implements PhotoLibraryOriginalSourceCurrentV1 {
	readonly #transport: Readonly<DesktopPhotoOriginalTransportCurrentV1>;
	readonly #storage: DesktopPhotoOriginalStorageCurrentV1;
	readonly #createId: () => string;
	readonly #entries = new Set<Entry>();
	// An unproved writer/native retirement keeps its actual objects strongly
	// owned even after the public acquisition rejects; GC is not retirement.
	readonly #quarantined = new Set<Entry>();
	readonly #cleanupFailures: unknown[] = [];
	#acquisitions = 0;
	#stages = 0;
	#bytes = 0;
	#closed = false;
	#closing: Promise<void> | undefined;

	constructor(transport: DesktopPhotoOriginalTransportCurrentV1, options: DesktopPhotoOriginalSourceOptionsCurrentV1 = {}) {
		const input = record(transport, 'desktop Original transport', ['open', 'read', 'close']);
		const open = field(input, 'open', 'desktop Original transport') as DesktopPhotoOriginalTransportCurrentV1['open'];
		const read = field(input, 'read', 'desktop Original transport') as DesktopPhotoOriginalTransportCurrentV1['read'];
		const close = field(input, 'close', 'desktop Original transport') as DesktopPhotoOriginalTransportCurrentV1['close'];
		if (typeof open !== 'function' || typeof read !== 'function' || typeof close !== 'function') throw new TypeError('Complete bounded native Original transport is required.');
		this.#transport = Object.freeze<DesktopPhotoOriginalTransportCurrentV1>({ open: value => Reflect.apply(open, transport, [value]) as Promise<unknown>,
			read: (value, offset, length) => Reflect.apply(read, transport, [value, offset, length]) as Promise<unknown>,
			close: value => Reflect.apply(close, transport, [value]) as Promise<void> });
		const config = record(options, 'desktop Original source options', ['storage', 'createId'], []);
		const storage = (Object.hasOwn(config, 'storage') ? field(config, 'storage', 'desktop Original source options') : globalThis.navigator?.storage) as DesktopPhotoOriginalStorageCurrentV1 | undefined;
		if (!storage || typeof storage.getDirectory !== 'function') throw new TypeError('Original materialization requires native OPFS storage.');
		const getDirectory = storage.getDirectory;
		this.#storage = Object.freeze({ getDirectory: () => Reflect.apply(getDirectory, storage, []) as ReturnType<DesktopPhotoOriginalStorageCurrentV1['getDirectory']> });
		const configured = Object.hasOwn(config, 'createId') ? field(config, 'createId', 'desktop Original source options') : undefined;
		if (configured !== undefined && typeof configured !== 'function') throw new TypeError('Original staging requires a directory ID factory.');
		const generate = configured as (() => string) | undefined;
		this.#createId = generate ? () => Reflect.apply(generate, options, []) as string : () => crypto.randomUUID();
	}

	readonly acquire = (value: unknown, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Readonly<DesktopPhotoOriginalLeaseCurrentV1>> => {
		try { this.#assertAccepting(); } catch (error) { return Promise.reject(error); }
		if (this.#acquisitions >= LIMITS.maximumAcquisitions) return Promise.reject(new RangeError('Original acquisition capacity is full.'));
		let resolve!: (lease: Readonly<DesktopPhotoOriginalLeaseCurrentV1>) => void, reject!: (error: unknown) => void;
		const work = new Promise<Readonly<DesktopPhotoOriginalLeaseCurrentV1>>((accept, refuse) => { resolve = accept; reject = refuse; });
		let resolveDone!: () => void;
		const done = new Promise<void>(accept => { resolveDone = accept; }), controller = new NativeController();
		const entry: Entry = { controller, signal: Reflect.apply(SIGNAL, controller, []) as AbortSignal,
			stage: new DesktopPhotoOriginalStageCurrentV1(), done, resolveDone, detach: () => undefined, published: false, reservedBytes: 0 };
		this.#entries.add(entry); this.#acquisitions++;
		try {
			this.#link(entry, options); check(entry.signal);
			const captured = request(value); check(entry.signal);
			if (this.#stages >= LIMITS.maximumStages || captured.original.byteLength > LIMITS.maximumEncodedBytes - this.#bytes) throw new RangeError('Original stage capacity is full.');
			this.#stages++; this.#bytes += captured.original.byteLength; entry.reservedBytes = captured.original.byteLength;
			void Promise.resolve().then(() => this.#materialize(entry, captured)).then(
				lease => { this.#acquisitions--; resolve(lease); }, (error: unknown) => { this.#acquisitions--; reject(error); });
		} catch (error) {
			let primary = error; try { check(entry.signal); } catch (reason) { primary = reason; }
			void this.#retire(entry, primary).then(cleanup => {
				this.#acquisitions--; reject(combine([primary, ...cleanup], 'Original admission and retirement failed.'));
			});
		}
		return work;
	};

	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true;
		let resolve!: () => void, reject!: (error: unknown) => void;
		const closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; }); this.#closing = closing;
		const entries = [...this.#entries];
		for (const entry of entries) {
			try { Reflect.apply(ABORT, entry.controller, [new DOMException('Original source is closed.', 'AbortError')]); }
			catch (error) { remember(this.#cleanupFailures, error); }
		}
		void Promise.all(entries.map(entry => entry.done)).then(() => {
			if (this.#cleanupFailures.length) throw combine(this.#cleanupFailures, 'Original source retirement is unproved.');
		}).then(resolve, reject);
		return closing;
	}

	async #materialize(entry: Entry, captured: Readonly<PhotoLibraryOriginalRequestCurrentV1>): Promise<Readonly<DesktopPhotoOriginalLeaseCurrentV1>> {
		try {
			check(entry.signal); const result = await this.#transport.open(captured);
			const id = ticketId(result); entry.release = this.#release(Object.freeze({ id }));
			if (isAborted(entry.signal)) void entry.release().catch(() => undefined);
			const issued = ticket(result, captured); check(entry.signal);
			const body = await entry.stage.materialize(this.#storage, this.#createId, this.#transport, issued, entry.signal); check(entry.signal);
			entry.published = true; let closing: Promise<void> | undefined;
			return Object.freeze({ body, close: (): Promise<void> => {
				closing ??= Promise.resolve().then(async () => {
					const errors = await this.#retire(entry);
					if (errors.length) throw combine(errors, 'Original File lease retirement failed.');
				}); return closing;
			} });
		} catch (error) {
			let primary = error; try { check(entry.signal); } catch (reason) { primary = reason; }
			const cleanup = await this.#retire(entry, primary);
			throw combine([primary, ...cleanup], 'Original materialization and retirement failed.');
		}
	}

	#release(value: Readonly<{ id: string }>): () => Promise<void> {
		let closing: Promise<void> | undefined;
		return () => {
			if (closing) return closing;
			let resolve!: () => void, reject!: (error: unknown) => void;
			closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
			try { void this.#transport.close(value).then(resolve, reject); } catch (error) { reject(error); }
			void closing.catch(() => undefined); return closing;
		};
	}

	async #retire(entry: Entry, reason?: unknown): Promise<unknown[]> {
		const errors: unknown[] = [], release = entry.release?.();
		const failed = (error: unknown): void => {
			remember(errors, error); this.#quarantined.add(entry); this.#latch(entry, error);
		};
		// Fence the first known cleanup refusal immediately; independently join
		// the remaining native retirement even when its acknowledgement is held.
		try { await entry.stage.retire(reason); } catch (error) { failed(error); }
		try { await release; } catch (error) { failed(error); }
		try { entry.detach(); } catch (error) { failed(error); }
		if (!errors.length && entry.reservedBytes) { this.#stages--; this.#bytes -= entry.reservedBytes; entry.reservedBytes = 0; }
		this.#entries.delete(entry); entry.resolveDone();
		return errors;
	}

	#latch(retiring: Entry, error: unknown): void {
		remember(this.#cleanupFailures, error);
		for (const sibling of this.#entries) if (sibling !== retiring && !sibling.published && !isAborted(sibling.signal)) {
			try { Reflect.apply(ABORT, sibling.controller, [new DOMException('Original staging retirement is unproved.', 'AbortError')]); }
			catch (cleanup) { remember(this.#cleanupFailures, cleanup); }
		}
	}

	#link(entry: Entry, options: unknown): void {
		const signalDescriptor = options && typeof options === 'object' ? Object.getOwnPropertyDescriptor(options, 'signal') : undefined;
		const external: unknown = signalDescriptor && Object.hasOwn(signalDescriptor, 'value') ? signalDescriptor.value : undefined;
		if (external !== undefined) assertPhotoStackQuerySignalV1(external);
		const caller = external as AbortSignal | undefined;
		const cancelled = (): void => { if (!entry.published && entry.release) void entry.release().catch(() => undefined); };
		const forward = (): void => { if (caller && !isAborted(entry.signal)) Reflect.apply(ABORT, entry.controller, [Reflect.apply(REASON, caller, [])]); };
		entry.detach = () => {
			Reflect.apply(REMOVE, entry.signal, ['abort', cancelled]);
			if (caller) Reflect.apply(REMOVE, caller, ['abort', forward]);
		};
		Reflect.apply(ADD, entry.signal, ['abort', cancelled, { once: true }]);
		if (caller) { Reflect.apply(ADD, caller, ['abort', forward, { once: true }]); if (isAborted(caller)) forward(); }
		const input = record(options, 'desktop Original acquire options', ['signal'], []);
		if ((Object.hasOwn(input, 'signal') ? field(input, 'signal', 'desktop Original acquire options') : undefined) !== caller) throw new TypeError('Original signal changed during admission.');
	}
	#assertAccepting(): void { if (this.#closed || this.#cleanupFailures.length) throw new Error('Original staging source is closed or retirement is unproved.'); }
}
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }
function isAborted(signal: AbortSignal): boolean { return Reflect.apply(ABORTED, signal, []) === true; }
function remember(errors: unknown[], value: unknown): void { if (!errors.some(error => Object.is(error, value))) errors.push(value); }
function combine(values: readonly unknown[], message: string): unknown {
	const errors: unknown[] = []; for (const value of values) remember(errors, value);
	return errors.length === 1 ? errors[0] : new AggregateError(errors, message, { cause: errors[0] });
}
