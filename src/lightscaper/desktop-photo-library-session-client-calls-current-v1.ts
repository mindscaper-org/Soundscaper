/* SPDX-License-Identifier: AGPL-3.0-only */

import { DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as CHANNELS,
	type DesktopPhotoLibrarySessionDescriptorCurrentV1 as Descriptor } from './desktop-photo-library-session-protocol-current-v1.ts';
import { readDesktopPhotoLibrarySessionPacketCurrentV1 } from './desktop-photo-library-session-packets-current-v1.ts';
import { readPhotoStackSignalOptionsV1 } from './catalog/photo-stack-repository-contract-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';

export type Channel = keyof typeof CHANNELS;
export type Invoke = (channel: string, payload: unknown) => Promise<unknown>;
const CHECK = AbortSignal.prototype.throwIfAborted, ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;
const ABORT = AbortController.prototype.abort, REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const CLONE = structuredClone, FILL = Uint8Array.prototype.fill;

/** One installed document connection. Data and cleanup have independent lanes;
	* request IDs are allocated only at synchronous SEND, after body staging. */
export class DesktopPhotoSessionClientCallsCurrentV1 {
	readonly descriptor: Readonly<Descriptor>;
	readonly signal: AbortSignal;
	readonly #invoke: Invoke;
	readonly #controller: AbortController;
	readonly #pending = new Set<Promise<unknown>>();
	#sequence = 0;
	#active = 0;
	#bodies = 0;
	#bytes = 0;
	#exclusive: string | null = null;
	#stopped = false;
	readonly #failures: unknown[] = [];
	constructor(descriptor: Readonly<Descriptor>, controller: AbortController, invoke: Invoke) {
		this.descriptor = descriptor; this.signal = controller.signal; this.#controller = controller; this.#invoke = invoke;
	}
	assert(): void { if (this.#stopped) throw new Error('The desktop Photo Session is stopped.'); Reflect.apply(CHECK, this.signal, []); }
	catalog(value: unknown): string { this.assert(); if (value !== this.descriptor.catalogId) throw new TypeError('Foreign selected catalog.'); return this.descriptor.catalogId; }
	own<Value>(operation: () => Value | Promise<Value>, cleanup = false): Promise<Value> {
		let resolve!: (value: Value | PromiseLike<Value>) => void, reject!: (reason: unknown) => void;
		const work = new Promise<Value>((yes, no) => { resolve = yes; reject = no; });
		try { if (!cleanup) this.assert(); } catch (error) { reject(error); return work; }
		this.#pending.add(work);
		void work.then(() => { this.#pending.delete(work); }, () => { this.#pending.delete(work); });
		try { resolve(operation()); } catch (error) { reject(error); }
		return work;
	}
	send<Value>(channel: Channel, capture: () => unknown, read: (value: unknown) => Value | Promise<Value>,
		signal?: AbortSignal, cleanup = false, mutation: boolean | ((value: Value) => boolean) = false): Promise<Value> {
		return this.own(async () => {
			if (!cleanup && this.#active >= 16) throw new Error('Desktop Photo Session data capacity is occupied.');
			if (!cleanup) this.#active++;
			let detach = (): void => undefined; let packet: Readonly<Record<string, unknown>> | undefined;
			try {
				const admittedSignal = readPhotoStackSignalOptionsV1(signal === undefined ? {} : { signal }).signal;
				const payload = readDesktopPhotoLibrarySessionPacketCurrentV1(CHANNELS[channel], capture(), this.descriptor.catalogId); packet = payload;
				if (!cleanup) this.assert(); if (admittedSignal) Reflect.apply(CHECK, admittedSignal, []);
				const requestId = this.#next(), identity = Object.freeze({ schemaVersion: 1, sessionId: this.descriptor.sessionId, requestId, exclusiveId: this.#exclusive });
				const cancel = (): void => {
					const cancelId = this.#next();
					void this.own(() => this.#invoke(CHANNELS.cancel, { identity: { ...identity, requestId: cancelId }, payload: { requestId } }), true).catch(error => this.notice(error));
				};
				if (admittedSignal) { Reflect.apply(ADD, admittedSignal, ['abort', cancel, { once: true }]); detach = () => Reflect.apply(REMOVE, admittedSignal, ['abort', cancel]); }
				let result: unknown;
				try { result = await this.#invoke(CHANNELS[channel], { identity, payload }); }
				catch (error) { if (admittedSignal) Reflect.apply(CHECK, admittedSignal, []); throw error; }
				const value = await read(result);
				if (!(typeof mutation === 'function' ? mutation(value) : mutation) && !cleanup) { if (admittedSignal) Reflect.apply(CHECK, admittedSignal, []); this.assert(); }
				return value;
			} finally { detach(); if ((channel === 'upload' || channel === 'rawInput') && packet?.operation === 'write' && packet.bytes instanceof Uint8Array) Reflect.apply(FILL, packet.bytes, [0]); if (!cleanup) this.#active--; }
		}, cleanup);
	}
	reserve(byteLength: number): () => void {
		this.assert(); if (!Number.isSafeInteger(byteLength) || byteLength < 0 || this.#bodies >= 16 || byteLength > 134_217_728 - this.#bytes)
			throw new RangeError('Desktop Photo Session retained body capacity exceeded.');
		this.#bodies++; this.#bytes += byteLength; let active = true;
		return () => { if (active) { active = false; this.#bodies--; this.#bytes -= byteLength; } };
	}
	enterExclusive(value: string): void { if (this.#exclusive !== null) throw new Error('A native writer callback is already held.'); this.#exclusive = value; }
	leaveExclusive(value: string): void { if (this.#exclusive === value) this.#exclusive = null; }
	fence(): void { this.#stopped = true; }
	stop(): void { this.fence(); if (!this.signal.aborted) Reflect.apply(ABORT, this.#controller, [new DOMException('The desktop Photo Session stopped.', 'AbortError')]); }
	notice(value: unknown): void { if (!this.#failures.some(error => Object.is(error, value))) this.#failures.push(value); }
	async drain(): Promise<void> { while (this.#pending.size) await Promise.allSettled([...this.#pending]); if (this.#failures.length) throw new AggregateError(this.#failures, 'Desktop client cleanup failed.'); }
	#next(): number { if (this.#sequence === Number.MAX_SAFE_INTEGER) { this.stop(); throw new RangeError('Desktop request counter exhausted.'); } return ++this.#sequence; }
}
export function cloneDesktopPhotoValueCurrentV1(value: unknown): unknown { return CLONE(value); }
export function desktopPhotoSignalCurrentV1(value: unknown = {}): AbortSignal | undefined { return readPhotoStackSignalOptionsV1(value).signal; }
export function desktopPhotoVoidCurrentV1(value: unknown): void { if (value !== undefined) throw new TypeError('Expected an empty desktop reply.'); }
export function desktopPhotoBooleanCurrentV1(value: unknown): boolean { if (typeof value !== 'boolean') throw new TypeError('Expected a boolean desktop reply.'); return value; }
export function desktopPhotoRecordCurrentV1(value: unknown, keys: readonly string[], required = keys): Record<string, unknown> { return record(value, 'desktop Photo reply', keys, required); }
export function desktopPhotoFieldCurrentV1(value: Record<string, unknown>, key: string): unknown { return field(value, key, 'desktop Photo reply'); }
export function desktopPhotoReasonCurrentV1(signal: AbortSignal): unknown { return Reflect.apply(REASON, signal, []); }
