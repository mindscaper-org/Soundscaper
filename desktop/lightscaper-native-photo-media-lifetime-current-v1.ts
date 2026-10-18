/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';

const NativeController = AbortController, SIGNAL = Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal')!.get!;
const CHECK = AbortSignal.prototype.throwIfAborted, ABORT = AbortController.prototype.abort;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;

/** One publication queue, with registered captures before borrower reflection.
 * Close cancels prepublication work and joins its real completion, never races
 * a native read/producer. A completed operation owns its ACK without a postcheck. */
export class LightscaperNativePhotoMediaLifetimeCurrentV1 {
	readonly #shutdown = new NativeController();
	readonly #active = new Set<Promise<unknown>>();
	#tail: Promise<void> = Promise.resolve();
	#closed = false;
	#closing: Promise<void> | null = null;

	run<Input, Result>(optionsValue: unknown, capture: (signal: AbortSignal) => Input | Promise<Input>,
		operation: (input: Input, signal: AbortSignal) => Promise<Result> | Result): Promise<Result> {
		if (this.#closed) return Promise.reject(new Error('Native Photo media is closed.'));
		let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (error: unknown) => void;
		const pending = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; });
		const previous = this.#tail;
		this.#active.add(pending); this.#tail = pending.then(() => undefined, () => undefined);
		let signal = Reflect.apply(SIGNAL, this.#shutdown, []) as AbortSignal, detach = (): void => undefined;
		let input: Promise<Input>;
		try {
			const options = optionsValue === undefined ? {} : optionsValue;
			const descriptor = options && typeof options === 'object' ? Object.getOwnPropertyDescriptor(options, 'signal') : undefined;
			const caller: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
			if (caller !== undefined) assertPhotoStackQuerySignalV1(caller);
			const linked = linkLightscaperNativePhotoMediaSignalsCurrentV1(caller as AbortSignal | undefined, signal); signal = linked.signal; detach = linked.detach;
			const closed = record(options, 'native Photo media options', ['signal'], []);
			const admitted = Object.hasOwn(closed, 'signal') ? field(closed, 'signal', 'native Photo media options') : undefined;
			if (admitted !== caller) throw new TypeError('Native Photo media signal changed during admission.');
			checkLightscaperNativePhotoMediaSignalCurrentV1(signal);
			input = Promise.resolve(capture(signal));
		} catch (error) { input = Promise.reject(error); }
		void input.catch(() => undefined);
		const finish = (succeeded: boolean, result: unknown): void => {
			let cleanup: unknown, failed = false;
			try { detach(); } catch (error) { failed = true; cleanup = error; }
			this.#active.delete(pending);
			if (failed) reject(new AggregateError([...(succeeded ? [] : [result]), cleanup], 'Native Photo media signal retirement failed.', { cause: cleanup }));
			else if (succeeded) resolve(result as Result); else reject(result);
		};
		void previous.then(async () => {
			// Await capture even after shutdown: its accepted Blob/codec work is
			// still owned, and a failed capture cannot release a live sibling.
			const captured = await input; checkLightscaperNativePhotoMediaSignalCurrentV1(signal);
			return operation(captured, signal);
		}).then(value => { finish(true, value); }, (error: unknown) => { finish(false, error); });
		return pending;
	}

	close(retire: () => void | Promise<void>): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true;
		let resolve!: () => void, reject!: (error: unknown) => void;
		this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		const active = [...this.#active], failures: unknown[] = [];
		try { Reflect.apply(ABORT, this.#shutdown, [new Error('Native Photo media is closing.')]); } catch (error) { failures.push(error); }
		void Promise.allSettled(active).then(async () => {
			try { await retire(); } catch (error) { failures.push(error); }
			if (failures.length) throw new AggregateError(failures, 'Native Photo media retirement failed.');
		}).then(resolve, reject);
		return this.#closing;
	}
}

export function checkLightscaperNativePhotoMediaSignalCurrentV1(signal?: AbortSignal): void {
	if (signal !== undefined) Reflect.apply(CHECK, signal, []);
}

export function linkLightscaperNativePhotoMediaSignalsCurrentV1(caller: AbortSignal | undefined, shutdown: AbortSignal): Readonly<{ signal: AbortSignal; detach(): void }> {
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
		try { detach(); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native Photo media signal linkage failed.', { cause: cleanup }); }
		throw primary;
	}
}
