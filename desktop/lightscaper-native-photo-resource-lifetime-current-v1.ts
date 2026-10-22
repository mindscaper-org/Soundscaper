/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import type { LightscaperNativePhotoResourceFamilyCurrentV1 } from './lightscaper-native-photo-resource-body-current-v1.ts';

type Slot = `${LightscaperNativePhotoResourceFamilyCurrentV1}:${'render' | 'verify' | 'install'}`;
const NativeController = AbortController, SIGNAL = Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal')!.get!;
const CHECK = AbortSignal.prototype.throwIfAborted, ABORT = AbortController.prototype.abort;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;

/** Six fixed borrowers, no queue. The placeholder exists before any borrowed
 * record is reflected. Each promise owns its full native work and cleanup. */
export class LightscaperNativePhotoResourceLifetimeCurrentV1 {
	readonly #shutdown = new NativeController();
	readonly #active = new Map<Slot, Promise<unknown>>();
	#closed = false;
	#closing: Promise<void> | null = null;

	assertAccepting(): void { if (this.#closed) throw new Error('Native Photo resources are closed.'); }

	run<Captured, Result>(slot: Slot, optionsValue: unknown, capture: (signal: AbortSignal) => Captured,
		operation: (value: Captured, signal: AbortSignal) => Promise<Result>, retire?: (value: Captured) => void): Promise<Result> {
		try { this.assertAccepting(); } catch (error) { return Promise.reject(error); }
		if (this.#active.has(slot)) return Promise.reject(new Error('A native Photo resource operation is pending in this slot.'));
		let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (error: unknown) => void;
		const work = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; });
		this.#active.set(slot, work);
		let signal = Reflect.apply(SIGNAL, this.#shutdown, []) as AbortSignal;
		let detach = (): void => undefined, captured: { value: Captured } | undefined;
		const finish = (succeeded: boolean, value: unknown): void => {
			const cleanup: unknown[] = [];
			if (captured && retire) try { retire(captured.value); } catch (error) { cleanup.push(error); }
			try { detach(); } catch (error) { cleanup.push(error); }
			if (this.#active.get(slot) === work) this.#active.delete(slot);
			if (cleanup.length) reject(new AggregateError([...(succeeded ? [] : [value]), ...cleanup], 'Native Photo resource scope retirement failed.', { cause: cleanup[0] }));
			else if (succeeded) resolve(value as Result); else reject(value);
		};
		try {
			const options = optionsValue === undefined ? {} : optionsValue;
			const descriptor = options && typeof options === 'object' ? Object.getOwnPropertyDescriptor(options, 'signal') : undefined;
			const caller = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value as unknown : undefined;
			if (caller !== undefined) assertPhotoStackQuerySignalV1(caller);
			const joined = join(caller as AbortSignal | undefined, signal); signal = joined.signal; detach = joined.detach;
			const input = record(options, 'native Photo resource options', ['signal'], []);
			const admitted = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'native Photo resource options') : undefined;
			if (admitted !== caller) throw new TypeError('Native Photo resource signal changed during admission.');
			check(signal); captured = { value: capture(signal) }; check(signal);
			const value = captured.value;
			void Promise.resolve().then(() => { check(signal); return operation(value, signal); }).then(
				result => { finish(true, result); }, (error: unknown) => { finish(false, error); });
		} catch (error) {
			try { check(signal); finish(false, error); } catch (reason) { finish(false, reason); }
		}
		return work;
	}

	close(cleanup: () => void | Promise<void>): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true;
		let resolve!: () => void, reject!: (error: unknown) => void;
		const closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		this.#closing = closing;
		const active = [...this.#active.values()], failures: unknown[] = [];
		try { Reflect.apply(ABORT, this.#shutdown, []); } catch (error) { failures.push(error); }
		void Promise.allSettled(active).then(async () => {
			try { await cleanup(); } catch (error) { failures.push(error); }
			if (failures.length) throw new AggregateError(failures, 'Native Photo resource owner retirement failed.');
		}).then(resolve, reject);
		return closing;
	}
}

function join(caller: AbortSignal | undefined, shutdown: AbortSignal): Readonly<{ signal: AbortSignal; detach(): void }> {
	const controller = new NativeController(), signal = Reflect.apply(SIGNAL, controller, []) as AbortSignal;
	const listeners: Array<Readonly<{ source: AbortSignal; forward: () => void }>> = [];
	const detach = (): void => { for (const { source, forward } of listeners) Reflect.apply(REMOVE, source, ['abort', forward]); };
	try {
		for (const source of caller === undefined ? [shutdown] : [caller, shutdown]) {
			const forward = (): void => {
				if (Reflect.apply(ABORTED, signal, []) === false) Reflect.apply(ABORT, controller, [Reflect.apply(REASON, source, [])]);
			};
			Reflect.apply(ADD, source, ['abort', forward, { once: true }]); listeners.push({ source, forward });
			if (Reflect.apply(ABORTED, source, []) === true) forward();
		}
		return Object.freeze({ signal, detach });
	} catch (primary) {
		try { detach(); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native Photo resource signal cleanup failed.', { cause: cleanup }); }
		throw primary;
	}
}
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }
