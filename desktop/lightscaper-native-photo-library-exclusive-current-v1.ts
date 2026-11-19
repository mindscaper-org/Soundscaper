/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoCatalogImportExclusiveV1 } from '../src/lightscaper/import/catalog-write-lock-v1.ts';
import { id } from '../src/lightscaper/catalog/value-validation.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { consumeLightscaperNativePhotoSessionExclusiveClaimCurrentV1 as consumeClaim } from './lightscaper-native-photo-session-claim-current-v1.ts';

type Binding = ReturnType<typeof consumeClaim>;
type Listener = Readonly<{ source: AbortSignal; forward(): void }>;
const CONSTRUCT = Object.freeze({}), QUARANTINED = new Set<object>();
const NativeController = AbortController, ABORT = AbortController.prototype.abort;
const SIGNAL = Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal')!.get!;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const CHECK = AbortSignal.prototype.throwIfAborted;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

/** Callback exclusivity is subordinate to the actual selected manager guard.
	* No callback waits on a manager/Media queue, and no Map claims process locks.
	* The parent keeps the overall Session role until all local/physical owners join. */
export class LightscaperNativePhotoLibraryExclusiveCurrentV1 {
	readonly #binding: Binding;
	readonly #assertCurrent: Binding['assertCurrent']; readonly #quarantineScope: Binding['quarantine'];
	readonly #shutdown = new NativeController(); readonly #cleanup: unknown[] = [];
	#pending: Promise<unknown> | null = null; #stopped = false; #closing: Promise<void> | null = null;
	private constructor(binding: Binding, construction: object) {
	 if (construction !== CONSTRUCT) throw new TypeError('Native selected exclusivity requires its genuine one-use claim.');
	 this.#binding = binding; this.#assertCurrent = binding.assertCurrent; this.#quarantineScope = binding.quarantine;
	 this.#assertAccepting(); Object.freeze(this);
	}
	static create(claim: unknown): LightscaperNativePhotoLibraryExclusiveCurrentV1 {
	 return new LightscaperNativePhotoLibraryExclusiveCurrentV1(consumeClaim(claim), CONSTRUCT);
	}
	readonly exclusive: PhotoCatalogImportExclusiveV1 = Object.freeze(<Result>(catalogId: string,
	 operation: (signal?: AbortSignal) => Promise<Result>, caller?: AbortSignal): Promise<Result> => {
	 try { this.#assertAccepting(); if (this.#pending) throw new Error('A native selected Session callback is already active.'); }
	 catch (error) { return Promise.reject(error); }
	 let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (reason: unknown) => void;
	 const pending = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; });
	 // Registration and the busy latch precede every borrowed signal, ID or callback.
	 this.#pending = pending;
	 const controller = new NativeController(), selected = Reflect.apply(SIGNAL, controller, []) as AbortSignal;
	 const listeners: Listener[] = []; let captured = false, primary: unknown;
	 const attach = (source: AbortSignal): void => {
	  const forward = (): void => {
	   if (Reflect.apply(ABORTED, selected, []) === false) Reflect.apply(ABORT, controller, [Reflect.apply(REASON, source, [])]);
	  };
	  Reflect.apply(ADD, source, ['abort', forward, { once: true }]); listeners.push(Object.freeze({ source, forward }));
	  if (Reflect.apply(ABORTED, source, []) === true) forward();
	 };
	 try {
	  attach(Reflect.apply(SIGNAL, this.#shutdown, []) as AbortSignal); attach(this.#binding.signal); check(selected);
	  if (caller !== undefined) { assertPhotoStackQuerySignalV1(caller); attach(caller); }
	  if (id(catalogId, 'native exclusive catalog ID') !== this.#binding.catalogId) throw new Error('Native selected exclusivity belongs to another catalog.');
	  if (typeof operation !== 'function') throw new TypeError('Native selected exclusivity requires a callable operation.');
	  this.#assertAccepting(); check(selected); captured = true;
	 } catch (error) { primary = error; try { check(selected); } catch (reason) { primary = reason; } }
	 const finish = (succeeded: boolean, result: unknown): void => {
	  const cleanup: unknown[] = [];
	  for (const listener of listeners.reverse()) {
	   try { Reflect.apply(REMOVE, listener.source, ['abort', listener.forward]); }
	   catch (error) { cleanup.push(error); this.#quarantine(error); }
	  }
	  this.#pending = null;
	  if (cleanup.length) reject(new AggregateError([...(succeeded ? [] : [result]), ...cleanup], 'Native selected callback and signal retirement failed.', { cause: cleanup[0] }));
	  else if (succeeded) resolve(result as Result); else reject(result);
	 };
	 void Promise.resolve().then(() => {
	  if (!captured) throw primary;
	  check(selected);
	  try { this.#assertAccepting(); } catch (error) { check(selected); throw error; }
	  check(selected);
	  return Reflect.apply(operation, undefined, [selected]) as Promise<Result>;
	 }).then(value => { finish(true, value); }, (error: unknown) => { finish(false, error); });
	 return pending;
	});
	stop(): void { this.#stop(); }
	close(): Promise<void> {
	 if (this.#closing) return this.#closing;
	 let resolve!: () => void, reject!: (error: unknown) => void;
	 this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
	 const pending = this.#pending; this.#stop();
	 void Promise.allSettled(pending ? [pending] : []).then(() => {
	  if (this.#cleanup.length) throw new AggregateError([...this.#cleanup], 'Native selected callback retirement is unproved; owner retained.');
	 }).then(resolve, reject); return this.#closing;
	}
	#assertAccepting(): void {
	 if (this.#stopped || this.#closing || this.#cleanup.length) throw new Error('Native selected exclusivity is stopped, closed or quarantined.');
	 check(this.#binding.signal); Reflect.apply(this.#assertCurrent, this.#binding, []);
	}
	#stop(): void {
	 if (this.#stopped) return; this.#stopped = true;
	 try { Reflect.apply(ABORT, this.#shutdown, [new Error('Native selected Session writer is stopping.')]); }
	 catch (error) { this.#quarantine(error); }
	}
	#quarantine(error: unknown): void {
	 this.#cleanup.push(error); QUARANTINED.add(this);
	 try { Reflect.apply(this.#quarantineScope, this.#binding, []); } catch (cleanup) { this.#cleanup.push(cleanup); }
	}
}
