/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainRecord as record, readClosedDomainField as field } from '../common/editor/closed-domain-value.ts';
import { normalizeCatalogOriginalRepairBindingV1 } from '../common/editor/storage/media-catalog-original-repair-contract.ts';
import { captureRepairSignalV1, checkRepairSignalV1 as check } from '../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { id, integer } from './catalog/value-validation.ts';
import { normalizePhotoDocumentCurrentV1 } from './catalog/photo-document-current-v1.ts';
import { PhotoCatalogRevisionConflictError } from './catalog/repository-types.ts';
import { getDesktopPhotoLinkedLibraryCurrentV1, type DesktopPhotoLinkedLibraryCurrentV1 as Linked } from './desktop-photo-linked-library-current-v1.ts';
import { readDesktopPhotoLinkedInspectionCurrentV1 } from './desktop-photo-linked-management-contract-current-v1.ts';
import type { DesktopPhotoLibrarySessionStorageCurrentV1 as Storage } from './desktop-photo-library-session-storage-current-v1.ts';
import type { DesktopPhotoLibrarySessionOwnerCurrentV1 as Local } from './desktop-photo-library-session-owner-current-v1.ts';
import type { PhotoLibrarySessionCurrentV1 as Session } from './controller/photo-library-session-current-v1.ts';
import { registerDesktopPhotoDevelopAvailabilityCurrentV1, type DesktopPhotoDevelopAvailabilityCurrentV1 } from './desktop-photo-develop-availability-registry-current-v1.ts';
export { getDesktopPhotoDevelopAvailabilityCurrentV1, aliasDesktopPhotoDevelopAvailabilityCurrentV1 } from './desktop-photo-develop-availability-registry-current-v1.ts';
export type { DesktopPhotoDevelopAvailabilityCurrentV1 } from './desktop-photo-develop-availability-registry-current-v1.ts';
const QUARANTINE = new Set<object>();
const NativeController = AbortController, ABORT = AbortController.prototype.abort;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!, REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;
export class DesktopPhotoDevelopAvailabilityOwnerCurrentV1 {
	readonly #stop = new NativeController(); readonly #cleanup: unknown[] = [];
	#parent = this.#stop.signal; #assert = (): void => undefined; #fence = (): void => undefined;
	#catalogId = ''; #load!: Storage['components']['catalog']['loadPhoto']; #inspect!: Linked['inspectOriginal']; #linked!: Linked;
	#pending: Promise<unknown> | undefined; #closing: Promise<void> | undefined;
	readonly #facet = Object.freeze<DesktopPhotoDevelopAvailabilityCurrentV1>({ read: (request, options) => this.#read(request, options) });
	private constructor() {}
	static create(storage: Readonly<Storage>, local: Local, linked: Linked): DesktopPhotoDevelopAvailabilityOwnerCurrentV1 {
		const owner = new DesktopPhotoDevelopAvailabilityOwnerCurrentV1(); local.ownLocal(owner);
		const assert = local.assertAccepting, stop = local.stop; owner.#parent = local.signal;
		owner.#assert = () => { Reflect.apply(assert, local, []); }; owner.#fence = () => { Reflect.apply(stop, local, []); };
		owner.#current(); owner.#catalogId = id(storage.catalogId, 'selected availability catalog');
		const catalog = storage.components.catalog, load = catalog.loadPhoto, inspect = linked.inspectOriginal;
		if (typeof load !== 'function' || typeof inspect !== 'function') throw new TypeError('Native availability requires actual captured Catalog/linked inspection.');
		owner.#load = (...args) => Reflect.apply(load, catalog, args) as ReturnType<typeof load>;
		owner.#inspect = (...args) => Reflect.apply(inspect, linked, args) as ReturnType<typeof inspect>; owner.#linked = linked;
		owner.#current(); return owner;
	}
	bind(session: Session): void {
		this.#current(); if (getDesktopPhotoLinkedLibraryCurrentV1(session) !== this.#linked) throw new TypeError('Availability requires its actual bound native Session.');
		registerDesktopPhotoDevelopAvailabilityCurrentV1(session.develop, this.#facet);
	}
	#current(): void { check(this.#parent); check(this.#stop.signal); if (this.#closing || this.#cleanup.length) throw new Error('Native Develop availability is retiring or quarantined.'); this.#assert(); }
	#quarantine(error: unknown): void { this.#cleanup.push(error); QUARANTINE.add(this); try { this.#fence(); } catch (secondary) { this.#cleanup.push(secondary); } }
	#read(value: unknown, options: Readonly<{ signal?: AbortSignal }> = {}): ReturnType<DesktopPhotoDevelopAvailabilityCurrentV1['read']> {
		try { this.#current(); if (this.#pending) throw new Error('Native Develop availability is occupied.'); } catch (error) { return Promise.reject(error); }
		let resolve!: (value: Awaited<ReturnType<DesktopPhotoDevelopAvailabilityCurrentV1['read']>>) => void, reject!: (error: unknown) => void;
		const work = new Promise<Awaited<ReturnType<DesktopPhotoDevelopAvailabilityCurrentV1['read']>>>((yes, no) => { resolve = yes; reject = no; }); this.#pending = work;
		let linked: ReturnType<typeof link> | undefined;
		const finish = (outcome: { value: Awaited<typeof work> } | { error: unknown }): void => {
			try { linked?.detach(); } catch (cleanup) { this.#quarantine(cleanup); }
			if (this.#pending === work) this.#pending = undefined;
			if (this.#cleanup.length) reject(new AggregateError([...('error' in outcome ? [outcome.error] : []), ...this.#cleanup], 'Native availability listener retirement is unproved.'));
			else if ('error' in outcome) reject(outcome.error); else resolve(outcome.value);
		};
		try {
			const descriptor = options && typeof options === 'object' ? Object.getOwnPropertyDescriptor(options, 'signal') : undefined;
			const caller = captureRepairSignalV1(descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined);
			linked = link([this.#parent, this.#stop.signal, ...(caller ? [caller] : [])], error => { this.#quarantine(error); });
			const config = record(options, 'native Develop availability options', ['signal'], []);
			if ((Object.hasOwn(config, 'signal') ? field(config, 'signal', 'native Develop availability options') : undefined) !== caller) throw new TypeError('Availability cancellation changed during capture.');
			const request = record(value, 'native Develop availability request', ['photoId', 'expectedRevision']);
			const photoId = id(field(request, 'photoId', 'native Develop availability request'), 'availability Photo');
			const expectedRevision = integer(field(request, 'expectedRevision', 'native Develop availability request'), 0, Number.MAX_SAFE_INTEGER, 'availability revision');
			if (Object.is(expectedRevision, -0)) throw new TypeError('Availability requires an exact revision.');
			const signal = linked.signal; check(signal); this.#current();
			void this.#query(photoId, expectedRevision, signal).then(value => { finish({ value }); }, (caught: unknown) => { let error = caught; try { check(signal); } catch (reason) { error = reason; } finish({ error }); });
		} catch (caught) { let error = caught; try { check(linked?.signal ?? this.#parent); check(this.#stop.signal); } catch (reason) { error = reason; } finish({ error }); }
		return work;
	}
	async #photo(photoId: string, revision: number, signal: AbortSignal) {
		check(signal); this.#current(); const raw = await this.#load(this.#catalogId, photoId); check(signal); this.#current();
		if (!raw) throw new ReferenceError('Selected availability Photo is missing.'); const photo = normalizePhotoDocumentCurrentV1(raw);
		if (photo.id !== photoId || photo.catalogId !== this.#catalogId || photo.revision !== revision) throw new PhotoCatalogRevisionConflictError('photo'); return photo;
	}
	async #query(photoId: string, revision: number, signal: AbortSignal): ReturnType<DesktopPhotoDevelopAvailabilityCurrentV1['read']> {
		const photo = await this.#photo(photoId, revision, signal), original = photo.original;
		if (original.retention === 'managed') return Object.freeze({ quality: 'original', locatorRevision: null });
		if (original.retention !== 'linked') throw new TypeError('Unsupported native Original retention cannot select preview.');
		const binding = normalizeCatalogOriginalRepairBindingV1({ catalogId: this.#catalogId, importId: null, photoId, assetId: original.storageKey,
			sourceId: original.id, sha256: original.contentSha256, size: original.byteLength, name: original.name, mimeType: original.mimeType });
		const inspection = readDesktopPhotoLinkedInspectionCurrentV1(await this.#inspect(binding, { signal })); check(signal); this.#current();
		const current = await this.#photo(photoId, revision, signal);
		if (JSON.stringify(current.original) !== JSON.stringify(original)) throw new PhotoCatalogRevisionConflictError('photo');
		return Object.freeze({ quality: inspection.status === 'unavailable' ? 'preview-derivative' : 'original', locatorRevision: inspection.locatorRevision });
	}
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolve!: () => void, reject!: (error: unknown) => void; this.#closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
		const pending = this.#pending; try { Reflect.apply(ABORT, this.#stop, [new DOMException('Native availability retired.', 'AbortError')]); } catch (error) { this.#quarantine(error); }
		void Promise.allSettled(pending ? [pending] : []).then(() => { if (this.#cleanup.length) throw new AggregateError([...this.#cleanup], 'Native availability retirement is unproved.'); }).then(resolve, reject);
		return this.#closing;
	}
}
function link(sources: readonly AbortSignal[], unretired: (error: unknown) => void) {
	const controller = new NativeController(), detachers: (() => void)[] = [];
	try {
		for (const source of sources) {
			const forward = (): void => { if (Reflect.apply(ABORTED, controller.signal, []) === false) Reflect.apply(ABORT, controller, [Reflect.apply(REASON, source, [])]); };
			detachers.push(() => { Reflect.apply(REMOVE, source, ['abort', forward]); }); Reflect.apply(ADD, source, ['abort', forward, { once: true }]);
			if (Reflect.apply(ABORTED, source, []) === true) forward();
		}
	} catch (primary) { const errors: unknown[] = [primary]; for (const detach of detachers) try { detach(); } catch (cleanup) { unretired(cleanup); errors.push(cleanup); } throw errors.length === 1 ? primary : new AggregateError(errors, 'Availability signal construction failed.'); }
	return { signal: controller.signal, detach(): void { const errors: unknown[] = []; for (const detach of detachers.splice(0)) try { detach(); } catch (error) { errors.push(error); } if (errors.length) throw new AggregateError(errors, 'Availability signal retirement failed.'); } };
}
