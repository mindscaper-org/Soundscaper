/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { types } from 'node:util';
import type { LightscaperNativeOriginalStoreCurrentV1 } from './lightscaper-native-original-store-current-v1.ts';
import { LIGHTSCAPER_NATIVE_ORIGINAL_CHUNK_BYTES_CURRENT_V1 as MAXIMUM } from './lightscaper-native-original-contract-current-v1.ts';
import { registerLightscaperNativePhotoOriginalPinsCurrentV1, holdLightscaperNativePhotoOriginalReadReservationCurrentV1,
	type LightscaperNativePhotoOriginalGroupReservationCurrentV1 as GroupReservation,
	type LightscaperNativePhotoOriginalReadReservationCurrentV1 as Reservation } from './lightscaper-native-photo-original-read-pins-current-v1.ts';
import { readLightscaperNativePhotoOriginalAuthorityCurrentV1 as authorize,
	type LightscaperNativePhotoOriginalReadRequestCurrentV1 as Request } from './lightscaper-native-photo-original-read-authority-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check,
	linkLightscaperNativePhotoMediaSignalsCurrentV1 as link } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import { catalogOriginalId } from '../src/common/editor/storage/media-catalog-original-schema.ts';

type Run = <Input, Result>(options: unknown, capture: () => Input,
	operation: (input: Input, signal: AbortSignal) => Result | Promise<Result>) => Promise<Result>;
export interface LightscaperNativePhotoMediaOriginalReadCurrentV1 {
	read(offset: number, length: number, importId: string | null, reservation: Readonly<Reservation>): Promise<Uint8Array>;
	assertCurrent(importId: string | null): Promise<void>;
	close(): Promise<void>;
}
type Tracked = Readonly<{ stop(): void; done: Promise<void> }>;
const NativeController = AbortController, ABORT = AbortController.prototype.abort;
const SIGNAL = Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal')!.get!;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const CHECK = AbortSignal.prototype.throwIfAborted, REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
function cleanupFailure(error: unknown, signal: AbortSignal): boolean {
	if (error === Reflect.apply(REASON, signal, [])) return false;
	return types.isNativeError(error) && Object.getOwnPropertyDescriptor(error, 'errors') !== undefined;
}
/** Scalar consumer pins are independent of the short Media publication queue.
	* Closing signals escaped readers, then joins their explicit lease retirement;
	* it never treats cancellation or final-byte delivery as consumer completion. */
export class LightscaperNativePhotoMediaOriginalReadsCurrentV1 {
	readonly #database: DatabaseSync; readonly #originals: LightscaperNativeOriginalStoreCurrentV1; readonly #run: Run;
	readonly #pins: ReturnType<typeof registerLightscaperNativePhotoOriginalPinsCurrentV1>;
	readonly #leases = new Set<Tracked>(); #closed = false; #closing: Promise<void> | null = null;
	constructor(database: DatabaseSync, originals: LightscaperNativeOriginalStoreCurrentV1, run: Run) {
		this.#database = database; this.#originals = originals; this.#run = run; this.#pins = registerLightscaperNativePhotoOriginalPinsCurrentV1(database);
	}
	reserve(): Readonly<{ release(): void }> { if (this.#closed) throw new Error('Native Original reads are closed.'); return this.#pins.reserve(); }
	reserveGroup(count: number): Readonly<GroupReservation> { if (this.#closed) throw new Error('Native Original reads are closed.'); return this.#pins.reserveGroup(count); }
	acquireGroup(request: Request, group: Readonly<GroupReservation>, index: number, caller?: AbortSignal): Readonly<LightscaperNativePhotoMediaOriginalReadCurrentV1> {
		this.#pins.assertGroup(group, index); return this.#acquire(request, caller, { group, index });
	}
	acquire(request: Request, caller?: AbortSignal): Readonly<LightscaperNativePhotoMediaOriginalReadCurrentV1> { return this.#acquire(request, caller); }
	#acquire(request: Request, caller?: AbortSignal, reserved?: Readonly<{ group: Readonly<GroupReservation>; index: number }>): Readonly<LightscaperNativePhotoMediaOriginalReadCurrentV1> {
		if (this.#closed) throw new Error('Native Original reads are closed.'); check(caller);
		const authority = authorize(this.#database, request, request.importId), pin = reserved ? this.#pins.pinGroup(authority.storageKey, authority.token, reserved.group, reserved.index) : this.#pins.pin(authority.storageKey, authority.token);
		const controller = new NativeController(), shutdown = Reflect.apply(SIGNAL, controller, []) as AbortSignal; let linked: ReturnType<typeof link>;
		try { linked = link(caller, shutdown); } catch (error) { pin.release(); throw error; }
		const signal = linked.signal, active = new Set<Promise<unknown>>(), failures: unknown[] = [];
		let closing: Promise<void> | null = null, busy = false, resolveDone!: () => void, rejectDone!: (reason: unknown) => void;
		const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; }); void done.catch(() => undefined);
		const stop = (): void => { if (Reflect.apply(ABORTED, shutdown, []) === false) Reflect.apply(ABORT, controller, [new Error('Native Original reader is closing.')]); };
		const tracked: Tracked = Object.freeze({ stop, done }); this.#leases.add(tracked);
		const run = <Input, Result>(capture: () => Input, operation: (input: Input, selected: AbortSignal) => Result | Promise<Result>): Promise<Result> => {
			if (closing || this.#closed) return Promise.reject(new Error('Native Original reader is closed.'));
			const work = this.#run({ signal }, capture, operation); active.add(work);
			void work.then(() => { active.delete(work); }, (error: unknown) => { active.delete(work); if (cleanupFailure(error, signal)) failures.push(error); });
			return work;
		};
		const close = (): Promise<void> => {
			if (closing) return closing;
			let resolve!: () => void, reject!: (reason: unknown) => void;
			closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; }); stop();
			void Promise.allSettled([...active]).then(() => {
				try { linked.detach(); } catch (error) { failures.push(error); }
				if (failures.length) throw new AggregateError(failures, 'Native Original read retirement is unproved.');
				pin.release(); this.#leases.delete(tracked);
			}).then(() => { resolveDone(); resolve(); }, (error: unknown) => { rejectDone(error); reject(error); });
			return closing;
		};
		return Object.freeze({
			read: (offset: number, length: number, imported: string | null, reservation: Readonly<Reservation>): Promise<Uint8Array> => {
				if (busy) return Promise.reject(new Error('A native Original pull is already active.'));
				let held: Readonly<{ retire(): void }>;
				try { held = holdLightscaperNativePhotoOriginalReadReservationCurrentV1(this.#database, reservation); } catch (error) { return Promise.reject(error); }
				busy = true;
				const work = run(() => {
					Reflect.apply(CHECK, signal, []);
					if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || Object.is(offset, -0)
						|| typeof length !== 'number' || !Number.isSafeInteger(length) || length < 1 || length > MAXIMUM || offset + length > authority.byteLength) {
						throw new RangeError('Native Original pull exceeds its bounded byte range.');
					}
					return { offset, length, imported: imported === null ? null : catalogOriginalId(imported) };
				}, async (input, selected) => {
					authorize(this.#database, request, input.imported, authority);
					const bytes = await this.#originals.readBinding({ storageKey: authority.storageKey, byteLength: authority.byteLength, contentSha256: authority.contentSha256 }, input.offset, input.length, { signal: selected });
					try { check(selected); authorize(this.#database, request, input.imported, authority); return new Uint8Array(bytes); }
					finally { bytes.fill(0); }
				});
				void work.then(() => { held.retire(); busy = false; }, () => { held.retire(); busy = false; }); return work;
			},
			assertCurrent: (imported: string | null): Promise<void> => run(() => imported === null ? null : catalogOriginalId(imported), (current, selected) => {
				check(selected); authorize(this.#database, request, current, authority); check(selected);
			}),
			close,
		});
	}
	close(): Promise<void> {
		if (this.#closing) return this.#closing; this.#closed = true;
		let resolve!: () => void, reject!: (error: unknown) => void;
		this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		const leases = [...this.#leases];
		for (const lease of leases) lease.stop();
		void Promise.allSettled(leases.map(lease => lease.done)).then(results => {
			const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
			if (failures.length) throw new AggregateError(failures, 'Native Original consumer retirement is unproved.');
			return this.#pins.close();
		}).then(resolve, reject); return this.#closing;
	}
}
