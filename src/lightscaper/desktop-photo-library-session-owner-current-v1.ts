/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertPhotoStackQuerySignalV1 } from './catalog/photo-stack-query-signal-v1.ts';
import type { PhotoLibrarySessionCurrentV1 as Session } from './controller/photo-library-session-current-v1.ts';

const NativeController = AbortController, ABORT = AbortController.prototype.abort;
const CHECK = AbortSignal.prototype.throwIfAborted;
const SIGNAL = Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal')!.get!;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;
type Local = Readonly<{ close(): Promise<void> }>;
interface Entry { readonly owner: Local; close?: () => Promise<void>; failure?: unknown; failed: boolean }

/** The actual local construction/consumer barrier installed before native
 * lease admission. Remote admission is deliberately NOT owned by this latch:
 * its failure path may itself be waiting for this exact local close. */
export class DesktopPhotoLibrarySessionOwnerCurrentV1 {
	readonly #controller = new NativeController();
	readonly #locals = new Map<Local, Entry>();
	readonly #cleanup: unknown[] = [];
	#detach: (() => void) | undefined;
	#constructing: Promise<void> | undefined;
	#entered = false;
	#inside = false;
	#stopped = false;
	#innerClose: (() => Promise<void>) | undefined;
	#innerClosing: Promise<void> | undefined;
	#resourcesClosing: Promise<void> | undefined;
	#closing: Promise<void> | undefined;

	get signal(): AbortSignal { return Reflect.apply(SIGNAL, this.#controller, []) as AbortSignal; }

	captureOpeningSignal(value: unknown): void {
		this.assertAccepting();
		if (value === undefined) return;
		assertPhotoStackQuerySignalV1(value);
		if (this.#detach) throw new TypeError('Native Session opening signal was already captured.');
		const forward = (): void => {
			if (Reflect.apply(ABORTED, this.signal, []) === false) Reflect.apply(ABORT, this.#controller, [Reflect.apply(REASON, value, [])]);
		};
		Reflect.apply(ADD, value, ['abort', forward, { once: true }]);
		this.#detach = () => { Reflect.apply(REMOVE, value, ['abort', forward]); };
		if (Reflect.apply(ABORTED, value, []) === true) forward();
		this.assertAccepting();
	}

	finishOpening(): void {
		if (!this.#detach) return;
		try { this.#detach(); this.#detach = undefined; }
		catch (failure) { this.#cleanup.push(failure); throw failure; }
	}

	assertAccepting(): void {
		Reflect.apply(CHECK, this.signal, []);
		if (this.#stopped) throw new Error('Native Current Session construction is stopped.');
	}

	construct(run: () => Session): Session {
		this.assertAccepting();
		if (this.#entered) throw new Error('Native Current Session construction can only enter once.');
		this.#entered = true; this.#inside = true;
		let complete!: () => void; this.#constructing = new Promise<void>(resolve => { complete = resolve; });
		try {
			const inner = run(), close = inner.close;
			if (typeof close !== 'function') throw new TypeError('Native Current construction requires its actual inner Session close.');
			// Capture before the factory installs the public outer close. A stop
			// reentered during construction still joins this real returned kernel.
			this.#innerClose = () => Reflect.apply(close, inner, []) as Promise<void>;
			if (this.#stopped) this.#startInnerClose();
			return inner;
		} finally { this.#inside = false; complete(); }
	}

	ownLocal(owner: Local): void {
		if (!this.#inside) throw new Error('Native local owners must be registered inside accepted construction.');
		if (this.#locals.has(owner)) return;
		// Retain the actual returned Source before even its close reflection.
		// Local Close awaits the entered construction before reading this map.
		const entry: Entry = { owner, failed: false }; this.#locals.set(owner, entry);
		try {
			const close = owner.close;
			if (typeof close !== 'function') throw new TypeError('Native local resource requires its actual retirement method.');
			entry.close = () => Reflect.apply(close, owner, []) as Promise<void>;
		} catch (failure) { entry.failed = true; entry.failure = failure; throw failure; }
	}

	/** Only this local barrier belongs in inner ports.closeResources. It must
	 * never call the native storage/outer close that is waiting for the inner. */
	closeResources(): Promise<void> {
		if (this.#resourcesClosing) return this.#resourcesClosing;
		this.#resourcesClosing = Promise.resolve().then(async () => {
			const results = await Promise.allSettled([...this.#locals.values()].map(async entry => {
				if (entry.failed) throw entry.failure;
				if (!entry.close) throw new Error('Native local owner has no captured retirement.');
				await entry.close();
			}));
			const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
			if (failures.length) throw new AggregateError(failures, 'Native Current local resource retirement is unproved.');
			this.#locals.clear();
		});
		return this.#resourcesClosing;
	}

	#startInnerClose(): void {
		if (!this.#innerClose || this.#innerClosing) return;
		let resolve!: () => void, reject!: (failure: unknown) => void;
		// Cache before real Close synchronously aborts its consumer listeners.
		// The actual promise is joined, never awaited by this stop barrier.
		this.#innerClosing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		void this.#innerClosing.catch(() => undefined);
		try { void this.#innerClose().then(resolve, reject); } catch (failure) { reject(failure); }
	}

	stop(): void {
		if (this.#stopped) return; this.#stopped = true;
		// Fence the actual Session lifetime before dispatching owner listeners.
		// During construction capture starts it before resolving that latch.
		this.#startInnerClose();
		try { Reflect.apply(ABORT, this.#controller, [new DOMException('Native Current Session is closing.', 'AbortError')]); }
		catch (failure) { this.#cleanup.push(failure); throw failure; }
	}

	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolve!: () => void, reject!: (failure: unknown) => void;
		this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		try { this.stop(); } catch { /* Exact owned failure is retained in cleanup. */ }
		void Promise.resolve().then(async () => {
			await this.#constructing;
			const failures: unknown[] = [];
			this.#startInnerClose();
			try { await this.#innerClosing; } catch (failure) { failures.push(failure); }
			try { await this.closeResources(); } catch (failure) { failures.push(failure); }
			try { this.finishOpening(); } catch { /* Exact owned failure is retained in cleanup. */ }
			for (const failure of this.#cleanup) if (!failures.some(held => Object.is(held, failure))) failures.push(failure);
			if (failures.length === 1) throw failures[0];
			if (failures.length) throw new AggregateError(failures, 'Native Current inner Session and local retirement failed.');
		}).then(resolve, reject);
		return this.#closing;
	}
}
