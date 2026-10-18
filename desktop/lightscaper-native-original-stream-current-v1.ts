/* SPDX-License-Identifier: AGPL-3.0-only */

import { types } from 'node:util';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { LIGHTSCAPER_NATIVE_ORIGINAL_CHUNK_BYTES_CURRENT_V1 as CHUNK } from './lightscaper-native-original-contract-current-v1.ts';
import { readLightscaperNativeOriginalBindingCurrentV1 } from './lightscaper-native-original-index-current-v1.ts';
import type { LightscaperNativeOriginalBindingCurrentV1 } from './lightscaper-native-original-index-current-v1.ts';
import { LightscaperNativeOriginalStoreCurrentV1 } from './lightscaper-native-original-store-current-v1.ts';
import type { LightscaperNativeOriginalPublicationCurrentV1 } from './lightscaper-native-original-store-current-v1.ts';

type Item = IteratorResult<Uint8Array>;
type PendingWrite = {
	readonly promise: Promise<void>; readonly accept: () => void; readonly refuse: (reason: unknown) => void;
	bytes: Uint8Array | null; offset: number; delivered: boolean;
};
type PendingPull = Readonly<{ accept: (item: Item) => void; refuse: (reason: unknown) => void }>;
const TypedArrayPrototype: object = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BYTE_LENGTH = Object.getOwnPropertyDescriptor(TypedArrayPrototype, 'byteLength')!.get!;
const SET = Uint8Array.prototype.set, FILL = Uint8Array.prototype.fill, SUBARRAY = Uint8Array.prototype.subarray;
const STORE = LightscaperNativeOriginalStoreCurrentV1.prototype.storeBinding;
const NativeController = AbortController, ABORT = AbortController.prototype.abort;
const SIGNAL = Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;

/** Main-private backpressured bridge into the actual immutable file/index owner.
 * One copied emission is held, with <=1 MiB native pulls. A write is acknowledged
 * only on the consumer pull following its last physical chunk write. There is no
 * second body spool, fake publication receipt or abandoned producer next(). */
export class LightscaperNativeOriginalStreamCurrentV1 {
	readonly maximumChunkBytes = 4 * 1024 * 1024;
	readonly #binding: Readonly<LightscaperNativeOriginalBindingCurrentV1>;
	readonly #controller = new NativeController();
	readonly #result: Promise<LightscaperNativeOriginalPublicationCurrentV1>;
	#written = 0;
	#active: PendingWrite | null = null;
	#pull: PendingPull | null = null;
	#finishing = false;
	#producerRetired = false;
	#committed = false;
	#failed = false;
	#failure: unknown;
	#reported: unknown;
	#expectedStop = false;
	#stopping: Promise<void> | null = null;

	constructor(originals: LightscaperNativeOriginalStoreCurrentV1, binding: Readonly<LightscaperNativeOriginalBindingCurrentV1>, signal: AbortSignal) {
		assertPhotoStackQuerySignalV1(signal);
		this.#binding = readLightscaperNativeOriginalBindingCurrentV1(binding);
		assertPhotoStackQuerySignalV1(signal);
		const forward = (): void => { this.#stop(Reflect.apply(REASON, signal, [])); };
		const privateSignal = Reflect.apply(SIGNAL, this.#controller, []) as AbortSignal;
		const iterator: AsyncIterator<Uint8Array> = Object.freeze({
			next: () => this.#next(),
			return: () => { this.#producerRetired = true; this.#wipe(); this.#wake(); return Promise.resolve({ done: true as const, value: undefined }); },
		});
		let acquired = false;
		const source: AsyncIterable<Uint8Array> = Object.freeze({ [Symbol.asyncIterator]: () => {
			if (acquired) throw new Error('Native Original stream producer was already acquired.');
			acquired = true; return iterator;
		} });
		Reflect.apply(ADD, signal, ['abort', forward, { once: true }]);
		let work: Promise<LightscaperNativeOriginalPublicationCurrentV1>;
		try {
			// Calling the actual method brands its private receiver. A forged or
			// proxied OriginalStore cannot substitute a descriptor-only producer.
			work = Reflect.apply(STORE, originals, [this.#binding, source, { signal: privateSignal }]) as Promise<LightscaperNativeOriginalPublicationCurrentV1>;
		} catch (error) { Reflect.apply(REMOVE, signal, ['abort', forward]); throw error; }
		this.#result = work.then(proof => {
			this.#committed = true; this.#finishing = true; this.#producerRetired = true;
			Reflect.apply(REMOVE, signal, ['abort', forward]); this.#wipe(); this.#wake(); return proof;
		}, (error: unknown) => {
			if (!this.#failed) { this.#failed = true; this.#failure = error; }
			this.#reported = error === this.#failure ? error : new AggregateError([this.#failure, error], 'Native Original stream failed and its physical owner reported another failure.');
			this.#finishing = true; this.#producerRetired = true;
			Reflect.apply(REMOVE, signal, ['abort', forward]); this.#wipe(); this.#wake();
			const active = this.#active; this.#active = null; active?.refuse(this.#reported);
			throw this.#reported;
		});
		// The actual store may refuse before the caller writes or finishes.
		void this.#result.catch(() => undefined); Object.freeze(this);
	}

	get bytesWritten(): number { return this.#written; }

	write(input: Uint8Array): Promise<void> {
		if (this.#finishing || this.#producerRetired || this.#failed) return this.#refused();
		if (this.#active) return Promise.reject(new Error('A native Original stream write is already in progress.'));
		let accept!: () => void, refuse!: (reason: unknown) => void;
		const promise = new Promise<void>((resolve, reject) => { accept = resolve; refuse = reject; });
		const active: PendingWrite = { promise, accept, refuse, bytes: null, offset: 0, delivered: false };
		this.#active = active;
		try {
			if (!types.isUint8Array(input)) throw new TypeError('Native Original stream emissions require native Uint8Array bytes.');
			const length = Reflect.apply(BYTE_LENGTH, input, []) as number;
			if (length > this.maximumChunkBytes || length > this.#binding.byteLength - this.#written) throw new RangeError('Native Original stream emission exceeds its four-MiB or declared body bound.');
			// Native set validates detached/out-of-bounds buffers and bypasses
			// borrowed iterators, .slice(), and byteLength/length shadows.
			const bytes = new Uint8Array(length); Reflect.apply(SET, bytes, [input]); active.bytes = bytes;
			if (length === 0) { this.#active = null; active.accept(); }
			else this.#wake();
		} catch (error) { this.#stop(error); }
		return promise;
	}

	/** The one actual file/hash/index completion, shared by repeated calls. */
	finish(): Promise<LightscaperNativeOriginalPublicationCurrentV1> {
		this.#finishing = true; this.#wake(); return this.#result;
	}

	/** Stop admission immediately, then join the actual iterator/file retirement.
	 * Only an exact expected source/cancellation failure is suppressed. A distinct
	 * physical or cleanup failure remains observable; no error is introspected. */
	abort(): Promise<void> {
		if (this.#stopping) return this.#stopping;
		if (!this.#committed && !this.#failed) this.#stop(new DOMException('Native Original stream was aborted.', 'AbortError'));
		this.#stopping = this.#result.then(() => undefined, (error: unknown) => {
			if (!this.#expectedStop || error !== this.#failure) throw error;
		});
		void this.#stopping.catch(() => undefined); return this.#stopping;
	}

	#stop(reason: unknown): void {
		if (this.#committed || this.#failed) return;
		this.#failed = true; this.#failure = reason; this.#expectedStop = true; this.#finishing = true;
		Reflect.apply(ABORT, this.#controller, [reason]); this.#wake();
	}
	#refused(): Promise<void> {
		if (this.#failed) return this.#result.then(() => { throw this.#failure; }, (error: unknown) => { throw error; });
		return Promise.reject(new Error('The native Original stream is closed.'));
	}
	#next(): Promise<Item> {
		if (this.#pull) return Promise.reject(new Error('Native Original stream cannot service concurrent consumer pulls.'));
		if (this.#failed) return Promise.reject(this.#failure);
		const active = this.#active;
		if (active?.delivered) {
			active.delivered = false;
			if (active.bytes && active.offset === active.bytes.byteLength) {
				this.#written += active.bytes.byteLength; this.#wipe(); this.#active = null; active.accept();
			}
		}
		const item = this.#take();
		if (item) return Promise.resolve(item);
		return new Promise<Item>((accept, refuse) => { this.#pull = { accept, refuse }; });
	}
	#take(): Item | null {
		const active = this.#active;
		if (active?.bytes) {
			const offset = active.offset; active.offset = Math.min(offset + CHUNK, active.bytes.byteLength); active.delivered = true;
			return { done: false, value: Reflect.apply(SUBARRAY, active.bytes, [offset, active.offset]) as Uint8Array };
		}
		return this.#finishing || this.#producerRetired ? { done: true, value: undefined } : null;
	}
	#wake(): void {
		const pull = this.#pull;
		if (!pull) return;
		if (this.#failed) { this.#pull = null; pull.refuse(this.#failure); return; }
		const item = this.#take();
		if (item) { this.#pull = null; pull.accept(item); }
	}
	#wipe(): void { if (this.#active?.bytes) { Reflect.apply(FILL, this.#active.bytes, [0]); this.#active.bytes = null; } }
}
