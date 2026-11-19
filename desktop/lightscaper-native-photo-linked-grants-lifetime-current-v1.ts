/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/foundation/closed-domain-value.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { createLinkedGrantCleanupFailureCurrentV1 as cleanup, linkedGrantCleanupIsUnprovedCurrentV1 as unproved,
	rememberLinkedGrantFailureCurrentV1 as remember, combineLinkedGrantFailuresCurrentV1 as combine } from './lightscaper-native-photo-linked-grants-failures-current-v1.ts';
const Controller = AbortController, SIGNAL = Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal')!.get!;
const ABORT = AbortController.prototype.abort, CHECK = AbortSignal.prototype.throwIfAborted;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!, REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;
const QUARANTINE = new Set<object>();
export interface LinkedGrantOperationCurrentV1 {
	readonly promise: Promise<unknown>; readonly controller: AbortController; readonly signal: AbortSignal;
	grantId: string | null; acknowledged: boolean;
}
interface Entry extends LinkedGrantOperationCurrentV1 { readonly detaches: Array<() => void>; readonly control: boolean }
export function checkLinkedGrantSignalCurrentV1(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }
export function captureLinkedGrantSignalCurrentV1(value: unknown): AbortSignal {
	assertPhotoStackQuerySignalV1(value); return value;
}
/** Registered immediate bounded work; cleanup/revocation never waits for a
 * data slot. No scope/caller abort is forwarded into the shared native peer. */
export class LinkedGrantLifetimeCurrentV1 {
	readonly #shutdown = new Controller(); readonly #scope: AbortSignal; readonly #notify: () => void; readonly #owner: object;
	readonly #active = new Set<Entry>(); readonly #retained = new Set<Entry>(); readonly #failures: unknown[] = [];
	#closed = false; #failed = false; #notified = false; #closing: Promise<void> | null = null;
	constructor(scope: AbortSignal, notify: () => void, owner: object) { this.#scope = scope; this.#notify = notify; this.#owner = owner; }
	check(entry?: LinkedGrantOperationCurrentV1): void {
		if (this.#closed || this.#failed) throw new Error('Native folder grants are closed or quarantined.');
		checkLinkedGrantSignalCurrentV1(this.#scope); if (entry) checkLinkedGrantSignalCurrentV1(entry.signal);
	}
	fail(error: unknown): void {
		remember(this.#failures, error); this.#failed = true; QUARANTINE.add(this.#owner);
		try { Reflect.apply(ABORT, this.#shutdown, [error]); } catch (failure) { remember(this.#failures, cleanup([failure], 'Native grant shutdown failed.')); }
		if (!this.#notified) { this.#notified = true; try { this.#notify(); } catch (failure) { remember(this.#failures, failure); } }
	}
	run<Input, Result>(control: boolean, optionsValue: unknown, capture: (entry: LinkedGrantOperationCurrentV1) => Input,
		operation: (input: Awaited<Input>, entry: LinkedGrantOperationCurrentV1) => Promise<Result> | Result): Promise<Result> {
		try { this.check(); } catch (error) { return Promise.reject(error); }
		let count = 0; for (const accepted of this.#active) if (accepted.control === control) count++;
		if (count >= 4) return Promise.reject(new Error('Native folder-grant capacity is busy.'));
		let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (error: unknown) => void;
		const pending = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; }), controller = new Controller();
		const entry: Entry = { promise: pending, controller, signal: Reflect.apply(SIGNAL, controller, []) as AbortSignal,
			grantId: null, acknowledged: false, detaches: [], control }; this.#active.add(entry);
		let input: Promise<Awaited<Input>>;
		try {
			this.#link(entry, Reflect.apply(SIGNAL, this.#shutdown, []) as AbortSignal); this.#link(entry, this.#scope);
			const value = optionsValue === undefined ? {} : optionsValue;
			const descriptor = value !== null && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
			const caller: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
			if (caller !== undefined) this.#link(entry, captureLinkedGrantSignalCurrentV1(caller));
			const options = record(value, 'native grant options', ['signal'], []);
			if ((Object.hasOwn(options, 'signal') ? field(options, 'signal', 'native grant options') : undefined) !== caller) throw new TypeError('Native grant signal changed during capture.');
			this.check(entry); input = Promise.resolve(capture(entry));
		} catch (error) { input = Promise.reject(error); }
		void input.catch(() => undefined);
		const finish = (okay: boolean, value: unknown): void => {
			let succeeded = okay, result = value;
			if (succeeded && !entry.acknowledged) { try { this.check(entry); } catch (error) { succeeded = false; result = error; } }
			const failures: unknown[] = [];
			for (const detach of entry.detaches) { try { detach(); } catch (error) { remember(failures, error); } }
			if (unproved(result)) this.fail(result);
			if (failures.length) { this.#retained.add(entry); this.fail(cleanup(failures, 'Native grant signal retirement failed.')); }
			this.#active.delete(entry);
			if (failures.length && !entry.acknowledged) reject(combine([...(succeeded ? [] : [result]), ...failures], 'Native grant operation and signal retirement failed.'));
			else if (succeeded) resolve(result as Result); else reject(result);
		};
		void input.then(captured => { this.check(entry); return operation(captured, entry); }).then(value => { finish(true, value); }, (error: unknown) => { finish(false, error); });
		return pending;
	}
	async cancelGrant(grantId: string, except: LinkedGrantOperationCurrentV1): Promise<void> {
		const pending = [...this.#active].filter(entry => entry !== except && entry.grantId === grantId);
		const reason = new Error('Native folder grant is being revoked.');
		for (const entry of pending) Reflect.apply(ABORT, entry.controller, [reason]);
		await Promise.allSettled(pending.map(entry => entry.promise));
	}
	close(retire: () => void | Promise<void>): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true; let resolve!: () => void, reject!: (error: unknown) => void;
		this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		try { Reflect.apply(ABORT, this.#shutdown, [new Error('Native folder grants are closing.')]); } catch (error) { this.fail(cleanup([error], 'Native grant close dispatch failed.')); }
		void Promise.allSettled([...this.#active].map(entry => entry.promise)).then(async () => {
			try { await retire(); } catch (error) { this.fail(error); }
			if (this.#failures.length) throw combine(this.#failures, 'Native folder-grant retirement is unproved.');
		}).then(resolve, reject); return this.#closing;
	}
	#link(entry: Entry, source: AbortSignal): void {
		const forward = (): void => { if (Reflect.apply(ABORTED, entry.signal, []) === false) Reflect.apply(ABORT, entry.controller, [Reflect.apply(REASON, source, [])]); };
		Reflect.apply(ADD, source, ['abort', forward, { once: true }]);
		entry.detaches.push(() => { Reflect.apply(REMOVE, source, ['abort', forward]); });
		if (Reflect.apply(ABORTED, source, []) === true) forward();
	}
}
