/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import { catalogOriginalId } from '../src/common/editor/storage/media-catalog-original-schema.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { LIGHTSCAPER_NATIVE_ORIGINAL_CHUNK_BYTES_CURRENT_V1 as MAXIMUM } from './lightscaper-native-original-contract-current-v1.ts';
import { readLightscaperNativePhotoOriginalEnvelopeCurrentV1 as readLightscaperNativeOriginalCurrentV1 } from './lightscaper-native-photo-original-envelope-current-v1.ts';
import type { PhotoOriginalV1 } from '../src/lightscaper/catalog/types.ts';
import type { LightscaperNativeCatalogStoreCurrentV1 as Catalog } from './lightscaper-native-catalog-store-current-v1.ts';
import type { LightscaperNativePhotoMediaCurrentV1 as Media } from './lightscaper-native-photo-media-current-v1.ts';
import type { LightscaperNativePhotoSettingsCurrentV1 as Settings } from './lightscaper-native-photo-settings-current-v1.ts';
import type { LightscaperNativePhotoMediaOriginalReadCurrentV1 as Lease } from './lightscaper-native-photo-media-original-reads-current-v1.ts';
import { readPhotoLibraryOriginalGroupCurrentV1 } from '../src/lightscaper/controller/photo-library-original-group-contract-current-v1.ts';
import type { LightscaperNativePhotoOriginalGroupReservationCurrentV1 as GroupReservation } from './lightscaper-native-photo-original-read-pins-current-v1.ts';
import { activateLightscaperNativePhotoOriginalReadReservationCurrentV1 as activate,
	activateLightscaperNativePhotoOriginalGroupReservationCurrentV1 as activateGroup } from './lightscaper-native-photo-original-read-pins-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check,
	linkLightscaperNativePhotoMediaSignalsCurrentV1 as link } from './lightscaper-native-photo-media-lifetime-current-v1.ts';

const NativeController = AbortController, ABORT = AbortController.prototype.abort;
const SIGNAL = Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal')!.get!;
function readFailure(error: unknown, signal: AbortSignal): unknown { try { check(signal); } catch (aborted) { return aborted; } return error; }
function detachLinks(first: () => void, second: () => void): void {
	const failures: unknown[] = []; try { first(); } catch (error) { failures.push(error); } try { second(); } catch (error) { failures.push(error); }
	if (failures.length) throw new AggregateError(failures, 'Native Original signal links did not retire.');
}
type Options = Readonly<{ signal?: AbortSignal }>;
type Request = Readonly<{ catalogId: string; photoId: string; original: Readonly<PhotoOriginalV1> }>;
type Scope = Readonly<{ signal: AbortSignal; assertCurrent(): void }>;
export interface LightscaperNativePhotoOriginalViewCurrentV1 {
	readonly original: Readonly<PhotoOriginalV1>; read(offset: number, length: number): Promise<Uint8Array>;
}
export interface LightscaperNativePhotoOriginalGroupViewCurrentV1 {
	readonly originals: readonly Readonly<PhotoOriginalV1>[]; read(index: number, offset: number, length: number): Promise<Uint8Array>;
}
type GroupSlot = Readonly<{ group: Readonly<GroupReservation>; index: number }>;
/** Main-private composition captures genuine owner methods before components
	* escape. A consumer is owned independently of the Catalog and Media queues. */
export class LightscaperNativePhotoOriginalsCurrentV1 {
	readonly #load: Catalog['loadPhoto']; readonly #catalog: Catalog;
	readonly #intent: Settings['readImportIntentCurrentV1']; readonly #settings: Settings;
	readonly #acquire: Media['acquireOriginalRead']; readonly #reserve: Media['reserveOriginalRead'];
	readonly #acquireGroup: Media['acquireOriginalGroupRead']; readonly #reserveGroup: Media['reserveOriginalGroup'];
	readonly #scope: Scope; readonly #assert: Scope['assertCurrent'];
	readonly #shutdown = new NativeController(); readonly #linked: ReturnType<typeof link>;
	readonly #active = new Set<Promise<unknown>>(); readonly #cleanup: unknown[] = [];
	readonly #quarantinedGroups = new Set<Readonly<GroupReservation>>();
	#closing: Promise<void> | null = null;
	private constructor(catalog: Catalog, media: Media, settings: Settings, scope: Scope) {
		this.#catalog = catalog; this.#load = catalog.loadPhoto;
		this.#settings = settings; this.#intent = settings.readImportIntentCurrentV1;
		if (typeof this.#intent !== 'function') throw new TypeError('Native Original reader requires its genuine bounded selected import-intent reader.');
		this.#acquire = media.acquireOriginalRead; this.#reserve = media.reserveOriginalRead;
		this.#acquireGroup = media.acquireOriginalGroupRead; this.#reserveGroup = media.reserveOriginalGroup;
		if (typeof this.#acquireGroup !== 'function' || typeof this.#reserveGroup !== 'function') throw new TypeError('Native Original reader requires complete physical group booking.');
		this.#scope = scope; this.#assert = scope.assertCurrent; this.#linked = link(scope.signal, Reflect.apply(SIGNAL, this.#shutdown, []) as AbortSignal);
	}
	static create(value: Readonly<{ catalog: Catalog; media: Media; settings: Settings; scope: Scope }>): LightscaperNativePhotoOriginalsCurrentV1 {
		const input = record(value, 'native Original reader owners', ['catalog', 'media', 'settings', 'scope']);
		const scopeValue = field(input, 'scope', 'native Original reader owners');
		const scope = record(scopeValue, 'native Original reader scope', ['signal', 'assertCurrent']);
		const signal: unknown = field(scope, 'signal', 'native Original reader scope'), current: unknown = field(scope, 'assertCurrent', 'native Original reader scope');
		assertPhotoStackQuerySignalV1(signal); if (typeof current !== 'function') throw new TypeError('Native Original reader requires its main-owned scope assertion.');
		return new LightscaperNativePhotoOriginalsCurrentV1(field(input, 'catalog', 'native Original reader owners') as Catalog,
			field(input, 'media', 'native Original reader owners') as Media, field(input, 'settings', 'native Original reader owners') as Settings,
			Object.freeze({ signal, assertCurrent: () => { Reflect.apply(current, scopeValue, []); } }));
	}
	withOriginal<Result>(value: unknown, consume: (view: Readonly<LightscaperNativePhotoOriginalViewCurrentV1>) => Result | PromiseLike<Result>, options: Options = {}): Promise<Result> {
		return this.#withOriginal(value, consume, options);
	}
	#withOriginal<Result>(value: unknown, consume: (view: Readonly<LightscaperNativePhotoOriginalViewCurrentV1>) => Result | PromiseLike<Result>,
		options: Options = {}, group?: GroupSlot): Promise<Result> {
		if (this.#closing) return Promise.reject(new Error('Native Original reader is closed.'));
		let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (error: unknown) => void;
		const pending = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; }); this.#active.add(pending);
		let captured: Request, selected: ReturnType<typeof link> | undefined, controller: AbortController | undefined;
		let detach = (): void => undefined, reservation: Readonly<{ release(): void }> | undefined;
		try {
			const descriptor = options && typeof options === 'object' ? Object.getOwnPropertyDescriptor(options, 'signal') : undefined;
			const caller: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
			if (caller !== undefined) assertPhotoStackQuerySignalV1(caller);
			const callerLink = link(caller as AbortSignal | undefined, this.#linked.signal); detach = callerLink.detach; controller = new NativeController();
			selected = link(callerLink.signal, Reflect.apply(SIGNAL, controller, []) as AbortSignal);
			const owned = selected; detach = () => { detachLinks(owned.detach, callerLink.detach); };
			this.#check(selected.signal);
			const admitted = record(options, 'native Original reader options', ['signal'], []);
			if ((Object.hasOwn(admitted, 'signal') ? field(admitted, 'signal', 'native Original reader options') : undefined) !== caller) throw new TypeError('Native Original reader signal changed during capture.');
			this.#check(selected.signal);
			const input = record(value, 'native Original consumer request', ['catalogId', 'photoId', 'original']);
			captured = Object.freeze({ catalogId: catalogOriginalId(field(input, 'catalogId', 'native Original consumer request')),
				photoId: catalogOriginalId(field(input, 'photoId', 'native Original consumer request')),
				original: readLightscaperNativeOriginalCurrentV1(field(input, 'original', 'native Original consumer request')) });
			if (typeof consume !== 'function') throw new TypeError('Native Original requires its owning consumer callback.');
			this.#check(selected.signal); reservation = this.#reserve(); activate(reservation);
		} catch (error) {
			let primary = readFailure(error, selected?.signal ?? this.#linked.signal);
			reservation?.release(); try { detach(); } catch (cleanup) { this.#cleanup.push(cleanup); primary = new AggregateError([primary, cleanup], 'Native Original admission retirement failed.', { cause: cleanup }); }
			this.#active.delete(pending); reject(primary); return pending;
		}
		const signal = selected!.signal, capturedController = controller!;
		void this.#consume(captured, consume, signal, capturedController, reservation!, group).then(value => {
			try { detach(); } catch (cleanup) { this.#cleanup.push(cleanup); throw cleanup; } return value;
		}, (primary: unknown) => {
			try { detach(); } catch (cleanup) { this.#cleanup.push(cleanup); throw new AggregateError([primary, cleanup], 'Native Original signal retirement failed.', { cause: cleanup }); } throw primary;
		}).then(value => { this.#active.delete(pending); resolve(value); }, (error: unknown) => { this.#active.delete(pending); reject(error); });
		return pending;
	}
	/** Book every authority synchronously before the first per-Photo lookup.
	 * The booking remains occupied until all real alias callbacks/pulls join. */
	withOriginalGroup<Result>(value: unknown, consume: (view: Readonly<LightscaperNativePhotoOriginalGroupViewCurrentV1>) => Result | PromiseLike<Result>, options: Options = {}): Promise<Result> {
		if (this.#closing || this.#cleanup.length) return Promise.reject(new Error('Native Original reader is closed.'));
		let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (error: unknown) => void;
		const pending = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; }); this.#active.add(pending);
		let selected: ReturnType<typeof link> | undefined, controller: AbortController | undefined, booking: Readonly<GroupReservation> | undefined;
		let detach = (): void => undefined, requests: readonly Request[];
		try {
			const descriptor = options && typeof options === 'object' ? Object.getOwnPropertyDescriptor(options, 'signal') : undefined;
			const caller: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
			if (caller !== undefined) assertPhotoStackQuerySignalV1(caller);
			const callerLink = link(caller as AbortSignal | undefined, this.#linked.signal); detach = callerLink.detach; controller = new NativeController();
			selected = link(callerLink.signal, Reflect.apply(SIGNAL, controller, []) as AbortSignal);
			const owned = selected; detach = () => { detachLinks(owned.detach, callerLink.detach); }; this.#check(selected.signal);
			const admitted = record(options, 'native Original group options', ['signal'], []);
			if ((Object.hasOwn(admitted, 'signal') ? field(admitted, 'signal', 'native Original group options') : undefined) !== caller) throw new TypeError('Native Original group signal changed during capture.');
			const plan = readPhotoLibraryOriginalGroupCurrentV1(value);
			requests = Object.freeze(plan.requests.map(request => Object.freeze({ catalogId: request.catalogId, photoId: request.photoId,
				original: readLightscaperNativeOriginalCurrentV1(request.original) })));
			if (typeof consume !== 'function') throw new TypeError('Native Original group requires its owning consumer callback.');
			this.#check(selected.signal); booking = this.#reserveGroup(requests.length); activateGroup(booking);
		} catch (error) {
			let primary = readFailure(error, selected?.signal ?? this.#linked.signal); booking?.release();
			try { detach(); } catch (cleanup) { this.#cleanup.push(cleanup); primary = new AggregateError([primary, cleanup], 'Native Original group admission retirement failed.', { cause: cleanup }); }
			this.#active.delete(pending); reject(primary); return pending;
		}
		const cleanupEpoch = this.#cleanup.length, ownedBooking = booking!;
		const retire = (): void => {
			try { detach(); } catch (cleanup) { this.#cleanup.push(cleanup); }
			if (this.#cleanup.length !== cleanupEpoch) {
				this.#quarantinedGroups.add(ownedBooking);
				const failure = new AggregateError(this.#cleanup.slice(cleanupEpoch), 'Native Original group retirement is unproved.');
				ownedBooking.quarantine(failure); throw failure;
			}
			ownedBooking.release();
		};
		void this.#consumeGroup(requests, consume, selected!.signal, controller!, ownedBooking).then(result => {
			retire(); return result;
		}, (primary: unknown) => {
			try { retire(); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native Original group and retirement failed.', { cause: cleanup }); } throw primary;
		}).then(result => { this.#active.delete(pending); resolve(result); }, (error: unknown) => { this.#active.delete(pending); reject(error); });
		return pending;
	}
	async #consumeGroup<Result>(requests: readonly Request[], consume: (view: Readonly<LightscaperNativePhotoOriginalGroupViewCurrentV1>) => Result | PromiseLike<Result>,
		signal: AbortSignal, controller: AbortController, booking: Readonly<GroupReservation>): Promise<Result> {
		let release!: () => void; const retired = new Promise<void>(resolve => { release = resolve; });
		const views: Readonly<LightscaperNativePhotoOriginalViewCurrentV1>[] = [], tasks: Promise<void>[] = [];
		let live = true, failed = false, primary: unknown, result!: Result;
		try {
			for (let index = 0; index < requests.length; index++) {
				this.#check(signal); let ready!: () => void, refuse!: (error: unknown) => void;
				const entered = new Promise<void>((accept, reject) => { ready = accept; refuse = reject; });
				const task = this.#withOriginal(requests[index], async view => { views.push(view); ready(); await retired; }, { signal }, { group: booking, index });
				tasks.push(task); void task.then(() => { refuse(new Error('Native Original alias retired before publication.')); }, refuse); await entered;
			}
			this.#check(signal);
			const view = Object.freeze({ originals: Object.freeze(views.map(value => value.original)), read: (index: number, offset: number, length: number): Promise<Uint8Array> => {
				if (!live) return Promise.reject(new Error('Native Original group view has retired.'));
				if (!Number.isSafeInteger(index) || Object.is(index, -0) || index < 0 || index >= views.length) return Promise.reject(new RangeError('Native Original group index is invalid.'));
				return views[index]!.read(offset, length);
			} });
			result = await Reflect.apply(consume, undefined, [view]) as Result; this.#check(signal);
		} catch (error) { failed = true; primary = readFailure(error, signal); Reflect.apply(ABORT, controller, [primary]); }
		live = false; release();
		const terminal = await Promise.allSettled(tasks);
		for (const value of terminal) if (value.status === 'rejected' && (!failed || !Object.is(value.reason, primary))) {
			primary = failed ? new AggregateError([primary, value.reason as unknown], 'Native Original group and alias retirement failed.', { cause: value.reason }) : value.reason as unknown; failed = true;
		}
		if (failed) throw primary; this.#check(signal); return result;
	}

	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolve!: () => void, reject!: (error: unknown) => void;
		this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		Reflect.apply(ABORT, this.#shutdown, [new Error('Native Original reader is closing.')]);
		void Promise.allSettled([...this.#active]).then(() => {
			try { this.#linked.detach(); } catch (error) { this.#cleanup.push(error); }
			if (this.#cleanup.length) throw new AggregateError(this.#cleanup, 'Native Original consumers did not retire.');
		}).then(resolve, reject); return this.#closing;
	}
	async #consume<Result>(request: Request, consume: (view: Readonly<LightscaperNativePhotoOriginalViewCurrentV1>) => Result | PromiseLike<Result>,
		signal: AbortSignal, controller: AbortController, reservation: Readonly<{ release(): void }>, group?: GroupSlot): Promise<Result> {
		let lease: Readonly<Lease> | undefined, failed = false, primary: unknown, result!: Result;
		let live = true, busy = false, pull: Promise<Uint8Array> | null = null;
		try {
			const imported = await this.#current(request, signal);
			lease = group ? await this.#acquireGroup({ ...request, importId: imported }, group.group, group.index, { signal })
				: await this.#acquire({ ...request, importId: imported }, { signal });
			await lease.assertCurrent(await this.#current(request, signal)); this.#check(signal);
		} catch (error) { failed = true; primary = readFailure(error, signal); }
		finally { reservation.release(); }
		if (!failed && lease) {
			const accepted = lease;
			const view = Object.freeze({ original: request.original, read: (offset: number, length: number): Promise<Uint8Array> => {
				if (!live) return Promise.reject(new Error('Native Original view has retired.'));
				if (busy) return Promise.reject(new Error('A native Original view pull is already active.'));
				busy = true;
				const work = this.#pull(request, accepted, offset, length, signal); pull = work;
				void work.then(() => { busy = false; if (pull === work) pull = null; }, () => { busy = false; if (pull === work) pull = null; });
				return work;
			} });
			try { result = await Reflect.apply(consume, undefined, [view]) as Result; this.#check(signal); }
			catch (error) { failed = true; primary = readFailure(error, signal); Reflect.apply(ABORT, controller, [primary]); }
		}
		live = false;
		if (pull) { try { await pull; } catch (error) { if (!failed) { failed = true; primary = error; } } }
		try { await lease?.close(); }
		catch (cleanup) { this.#cleanup.push(cleanup); primary = failed ? new AggregateError([primary, cleanup], 'Native Original consumer and retirement failed.', { cause: cleanup }) : cleanup; failed = true; }
		if (failed) throw primary;
		this.#check(signal); return result;
	}
	async #pull(request: Request, lease: Readonly<Lease>, offset: number, length: number, signal: AbortSignal): Promise<Uint8Array> {
		this.#check(signal);
		if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || Object.is(offset, -0)
			|| typeof length !== 'number' || !Number.isSafeInteger(length) || length < 1 || length > MAXIMUM || offset + length > request.original.byteLength) throw new RangeError('Native Original view requires a bounded byte range.');
		const reservation = this.#reserve(); activate(reservation); let bytes: Uint8Array | undefined;
		try {
			const imported = await this.#current(request, signal); bytes = await lease.read(offset, length, imported, reservation);
			await lease.assertCurrent(await this.#current(request, signal)); this.#check(signal); return bytes;
		} catch (error) { bytes?.fill(0); throw readFailure(error, signal); }
		finally { reservation.release(); }
	}
	async #current(request: Request, signal: AbortSignal): Promise<string | null> {
		this.#check(signal);
		const photo = await Reflect.apply(this.#load, this.#catalog, [request.catalogId, request.photoId]) as Awaited<ReturnType<Catalog['loadPhoto']>>; this.#check(signal);
		if (!photo || photo.catalogId !== request.catalogId || photo.id !== request.photoId
			|| JSON.stringify(readLightscaperNativeOriginalCurrentV1(photo.original)) !== JSON.stringify(request.original)) throw new Error('Native Original differs from the actual selected stored Photo.');
		const intent = await Reflect.apply(this.#intent, this.#settings, [request.catalogId]) as Awaited<ReturnType<Settings['readImportIntentCurrentV1']>>; this.#check(signal);
		return intent === null ? null : intent.importId;
	}
	#check(signal: AbortSignal): void { check(signal); Reflect.apply(this.#assert, this.#scope, []); check(signal); }
}
