/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/foundation/closed-domain-value.ts';
import { name } from './catalog/value-validation.ts';
import { PhotoLibrarySessionCurrentV1 as Session } from './controller/photo-library-session-current-v1.ts';
import type { PhotoLibrarySessionPortsCurrentV1 as Ports } from './controller/photo-library-session-ports-current-v1.ts';
import { capturePhotoLibraryRawImportSourceCurrentV1 } from './controller/photo-library-raw-import-current-v1.ts';
import { preparePhotoImportGestureCurrentV1 } from './import/photo-import-preparation-current-v1.ts';
import { capturePhotoLibraryRawSourceCurrentV1 } from './controller/photo-library-raw-source-current-v1.ts';
import type { PhotoLibraryOriginalSourceCurrentV1 as OriginalPort } from './controller/photo-library-original-source-current-v1.ts';
import type { DesktopPhotoLibrarySessionServiceCurrentV1 as Service, DesktopPhotoLibrarySessionStorageCurrentV1 as Storage } from './desktop-photo-library-session-storage-current-v1.ts';
import { DesktopPhotoLibrarySessionOwnerCurrentV1 as Owner } from './desktop-photo-library-session-owner-current-v1.ts';
import { DesktopPhotoDevelopAvailabilityOwnerCurrentV1 as Availability } from './desktop-photo-develop-availability-current-v1.ts';
import { DesktopPhotoLinkedLibraryCurrentV1 as LinkedLibrary } from './desktop-photo-linked-library-current-v1.ts';
import { DesktopPhotoOriginalSourceCurrentV1 as OriginalSource } from './desktop-photo-original-source-current-v1.ts';
import type { DesktopPhotoOriginalSourceOptionsCurrentV1 as SourceOptions, DesktopPhotoOriginalStorageCurrentV1 as OriginalStorage } from './desktop-photo-original-contract-current-v1.ts';
import { PhotoPreviewSchedulerCurrentV1 as Scheduler } from './preview/photo-preview-scheduler-current-v1.ts';
import { PhotoPreviewCacheV1, PHOTO_PREVIEW_CACHE_PROFILE_V1 } from './preview/photo-preview-cache-v1.ts';
import { PhotoNativeRawPreviewCacheCurrentV1 } from './preview/photo-native-raw-preview-cache-current-v1.ts';
import { PhotoCullingPreviewCacheCurrentV1 } from './preview/photo-culling-preview-cache-current-v1.ts';
import { PhotoHdrPreviewCacheCurrentV1 } from './preview/photo-hdr-preview-cache-current-v1.ts';
import { verifyPhotoResourcesCurrentV1 } from './storage/photo-media-resource-verification-current-v1.ts';
import { photoImportIntentKeyV1 } from './import/import-intent-v1.ts';

export interface DesktopPhotoLibrarySessionRuntimeOptionsCurrentV1 {
	readonly name: string;
	readonly service: Service;
	readonly signal?: AbortSignal;
	/** Trusted local storage injection; never native namespace authority. */
	readonly originalSourceOptions?: SourceOptions;
}
const CHECK = AbortSignal.prototype.throwIfAborted;

/** Complete renderer Current Session over one genuine selected native storage
 * service. Main retains SQLite/body authority; real browser preparation and
 * decoder/preview kernels remain here. This installs no IPC or menu selection. */
export async function createDesktopPhotoLibrarySessionCurrentV1(options: DesktopPhotoLibrarySessionRuntimeOptionsCurrentV1): Promise<Session> {
	const owner = new Owner(); let storage: Readonly<Storage> | undefined, closeNative: (() => Promise<void>) | undefined;
	let closing: Promise<void> | undefined;
	const close = (): Promise<void> => {
		if (closing) return closing;
		let resolve!: () => void, reject!: (failure: unknown) => void;
		closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		const failures: unknown[] = [];
		try { owner.stop(); } catch (failure) { failures.push(failure); }
		let actual: Promise<void>;
		try { actual = closeNative ? closeNative() : owner.close(); } catch (failure) { actual = Promise.reject(failure); }
		void actual.then(() => {
			if (failures.length) reject(new AggregateError(failures, 'Native Session stop failed.')); else resolve();
		}, (failure: unknown) => { if (failures.length) reject(new AggregateError([...failures, failure], 'Native Session stop and close failed.')); else reject(failure); });
		return closing;
	};
	try {
		// The owner exists before caller reflection and never stores/awaits the
		// remote admission promise from its local retirement method.
		const descriptor = options && typeof options === 'object' ? Object.getOwnPropertyDescriptor(options, 'signal') : undefined;
		const signal: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
		owner.captureOpeningSignal(signal);
		const input = record(options, 'desktop Current Session', ['name', 'service', 'signal', 'originalSourceOptions'], ['name', 'service']);
		const admittedSignal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'desktop Current Session') : undefined;
		if (admittedSignal !== signal) throw new TypeError('Native Session opening signal changed during capture.');
		const catalogName = name(field(input, 'name', 'desktop Current Session'), 'catalog name');
		const service = field(input, 'service', 'desktop Current Session') as Service, open = service?.open;
		if (typeof open !== 'function') throw new TypeError('Desktop Current Session requires its actual selected storage service.');
		const sourceOptions = captureSourceOptions(Object.hasOwn(input, 'originalSourceOptions') ? field(input, 'originalSourceOptions', 'desktop Current Session') : undefined);
		owner.assertAccepting();
		storage = await Reflect.apply(open, service, [{ name: catalogName, signal: owner.signal }, owner]) as Readonly<Storage>;
		const actual = storage, retire = actual.close;
		if (typeof retire !== 'function') throw new TypeError('Native selected storage requires its actual close.');
		closeNative = () => Reflect.apply(retire, actual, []) as Promise<void>;
		owner.assertAccepting(); check(actual.signal);
		let linked: LinkedLibrary | undefined, availability: Availability | undefined;
		const session = owner.construct(() => {
			const physical = new OriginalSource(actual.components.originalTickets.transport, sourceOptions); owner.ownLocal(physical);
			if (typeof physical.acquireGroup !== 'function') throw new TypeError('Complete native Session requires all six Original transport methods.');
			const raw = capturePhotoLibraryRawSourceCurrentV1(actual.components.raw);
			const source: Readonly<OriginalPort> = Object.freeze({ acquire: physical.acquire.bind(physical),
				acquireGroup: physical.acquireGroup.bind(physical), ...(raw ? { raw } : {}) });
			owner.assertAccepting(); check(actual.signal);
			const linkedPort = actual.components.linked;
			if (linkedPort) { linked = new LinkedLibrary(linkedPort, { signal: owner.signal, sourceOptions, rawImport: actual.components.rawImport }); owner.ownLocal(linked); }
			if (linked) availability = Availability.create(actual, owner, linked);
			const ports = completePorts(actual, source, owner, linked);
			owner.assertAccepting(); check(actual.signal);
			return new Session(ports);
		});
		linked?.bind(session); availability?.bind(session);
		// Original close was captured inside construct before this own outer
		// method. All prototype methods and Current/legacy children remain real.
		Object.defineProperty(session, 'close', { value: close, enumerable: false, writable: false, configurable: false });
		assertComplete(session); owner.assertAccepting(); check(actual.signal);
		owner.finishOpening(); return session;
	} catch (caught) {
		// Preserve a known native opening cancellation before cleanup creates
		// its later stop reason or a borrowed getter failure masks the first.
		let primary = caught;
		try { check(owner.signal); } catch (reason) { primary = reason; }
		// Native Close starts writer quiescence before its local barrier. Also
		// join the local owner if admission failed before native storage delivery.
		const results = await Promise.allSettled([close(), owner.close()]);
		const failures: unknown[] = [primary];
		for (const result of results) if (result.status === 'rejected' && !failures.some(held => Object.is(held, result.reason))) failures.push(result.reason as unknown);
		if (failures.length === 1) throw primary;
		throw new AggregateError(failures, 'Native Current Session construction and actual retirement failed.', { cause: caught });
	}
}

function completePorts(storage: Readonly<Storage>, source: Readonly<OriginalPort>, owner: Owner, linked?: LinkedLibrary): Readonly<Ports> {
	const c = storage.components, catalog = c.catalog, selected = c.settings.settingsRepository;
	const rawImport = capturePhotoLibraryRawImportSourceCurrentV1(c.rawImport);
	const cube = c.resources.cubeLutResources.bind(c.resources), masks = c.resources.maskRasterResources.bind(c.resources);
	const resourceHost = Object.freeze({ cubeLutResources: cube, maskRasterResources: masks });
	const core = c.media.createBinaryDerivativeCache(PHOTO_PREVIEW_CACHE_PROFILE_V1);
	const canonical = new PhotoPreviewCacheV1(core), culling = new PhotoCullingPreviewCacheCurrentV1(core), hdr = new PhotoHdrPreviewCacheCurrentV1(core), native = new PhotoNativeRawPreviewCacheCurrentV1(core);
	const cache = Object.freeze({ load: canonical.load.bind(canonical), store: canonical.store.bind(canonical), trim: canonical.trim.bind(canonical) });
	const cullingCache = Object.freeze({ load: culling.load.bind(culling), store: culling.store.bind(culling), trim: culling.trim.bind(culling) });
	const nativeCache = Object.freeze({ load: native.load.bind(native), store: native.store.bind(native), trim: native.trim.bind(native) });
	const hdrCache = Object.freeze({ load: hdr.load.bind(hdr), store: hdr.store.bind(hdr), trim: hdr.trim.bind(hdr) });
	const readIntent = c.settings.readImportIntentCurrentV1.bind(c.settings), putIntent = selected.putIfAbsent.bind(selected), deleteIntent = selected.deleteIfCurrent.bind(selected);
	const intentKey = photoImportIntentKeyV1(storage.catalogId);
	const intent = <Result>(key: string, run: () => Promise<Result>): Promise<Result> => {
		try { owner.assertAccepting(); check(storage.signal); if (key !== intentKey) throw new TypeError('Native import journal accepts only its selected catalog intent key.'); return run(); }
		catch (failure) { return Promise.reject(failure); }
	};
	const journal: Ports['journal'] = Object.freeze({
		get: key => intent(key, async () => {
			const value = await readIntent(storage.catalogId); owner.assertAccepting(); check(storage.signal);
			return value === null ? undefined : value;
		}),
		putIfAbsent: (key, value) => intent(key, () => putIntent(key, value)),
		deleteIfCurrent: (key, expected) => intent(key, () => deleteIntent(key, expected)),
	});
	const load = catalog.loadPhoto.bind(catalog), root = catalog.loadCatalog.bind(catalog);
	return Object.freeze<Ports>({
		catalog, stacks: catalog, smartCollections: catalog,
		...(linked ? { prepare: linked.prepare } : rawImport ? { prepare: (value: unknown) => preparePhotoImportGestureCurrentV1(value, { rawImport }) } : {}),
		media: Object.freeze({ writeAsset: c.media.writeAsset.bind(c.media), custody: c.media.catalogOriginals, findManagedOriginalDigestPageCurrentV1: c.media.findManagedOriginalDigestPageCurrentV1.bind(c.media),
			...(linked ? { stageLinkedOriginalCurrentV1: linked.stageLinkedOriginalCurrentV1 } : {}) }),
		journal, settings: storage.importPresets, developPresetSettings: selected, exportJournalSettings: selected, exportPresetSettings: selected,
		originalSource: source, exclusive: storage.exclusive.bind(storage), cubeLutResources: cube, maskRasterResources: masks,
		verifyResources: (photo, signal) => verifyPhotoResourcesCurrentV1(photo, resourceHost, signal),
		originalInspection: Object.freeze<NonNullable<Ports['originalInspection']>>({ inspect: (binding, signal) => c.media.inspectCatalogOriginalBody(binding, { signal }) }),
		originalRestoration: Object.freeze({ restoreCatalogOriginalBody: c.media.restoreCatalogOriginalBody.bind(c.media) }),
		backup: Object.freeze({ readSnapshot: catalog.readSnapshot.bind(catalog), captureSmartCollectionArchiveV1: catalog.captureSmartCollectionArchiveV1.bind(catalog) }),
		initialize: async signal => {
			owner.assertAccepting(); check(signal); check(storage.signal);
			const value = await root(storage.catalogId); owner.assertAccepting(); check(signal); check(storage.signal);
			if (!value || value.id !== storage.catalogId) throw new ReferenceError('Actual selected native catalog is missing or differs.'); return value;
		},
		createPreviewScheduler: async catalogId => {
			owner.assertAccepting(); check(storage.signal);
			if (catalogId !== storage.catalogId) throw new Error('Native preview scheduler belongs to another selected catalog.');
			return new Scheduler({ catalogId, loadPhoto: photoId => load(catalogId, photoId), originalSource: source, cache, cullingCache, hdrCache, nativeCache });
		},
		closeResources: () => owner.closeResources(),
	});
}

function captureSourceOptions(value: unknown): Readonly<SourceOptions> {
	const config = record(value === undefined ? {} : value, 'native Original source options', ['storage', 'createId'], []);
	const selected = Object.hasOwn(config, 'storage') ? field(config, 'storage', 'native Original source options') : globalThis.navigator?.storage;
	if (!selected || typeof selected !== 'object') throw new TypeError('Native Current Session requires real local OPFS storage.');
	const getDirectory: unknown = Reflect.get(selected, 'getDirectory');
	if (typeof getDirectory !== 'function') throw new TypeError('Native Current Session requires real local OPFS storage.');
	const storage: OriginalStorage = Object.freeze({ getDirectory: () => Reflect.apply(getDirectory, selected, []) as ReturnType<OriginalStorage['getDirectory']> });
	const generate = Object.hasOwn(config, 'createId') ? field(config, 'createId', 'native Original source options') : undefined;
	if (generate !== undefined && typeof generate !== 'function') throw new TypeError('Native Original staging requires a callable ID factory.');
	return Object.freeze({ storage, ...(typeof generate === 'function' ? { createId: () => Reflect.apply(generate, value, []) as string } : {}) });
}

function assertComplete(session: Session): void {
	const methods: unknown[] = [session.develop.original?.withFrame, session.develop.original?.withDerivedFrame,
		session.develop.settingsCurrent?.applyBatch, session.develop.presetsCurrent?.write,
		session.develop.maskRasters?.source.withBytes, session.legacyDevelop?.original?.withFrame,
		session.legacyDevelop?.settings?.applyBatch, session.legacyDevelop?.presets?.write,
		session.savedCollections?.readPage, session.cullingNavigation?.readDestinationPage, session.hdrMergeCurrent?.merge,
		session.imageHandoffCurrent?.withCapture, session.collectionHandoffCurrent?.withCapture, session.imageReceiveCurrent?.receive,
		session.exportJournal?.open, session.exportJournalCurrent?.open, session.exportPresetsCurrent?.open,
		session.developImportCurrent?.importFiles, session.batchRenameCurrent?.readBatchRenameSelection];
	if (session.develop.schemaVersion !== 3 || session.legacyDevelop?.schemaVersion !== 2 || methods.some(method => typeof method !== 'function')) {
		throw new TypeError('Native Current Session composition lacks a complete Current or strict legacy child.');
	}
}
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }
