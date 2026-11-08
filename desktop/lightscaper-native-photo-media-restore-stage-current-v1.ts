/* SPDX-License-Identifier: AGPL-3.0-only */

import { DatabaseSync } from 'node:sqlite';
import { types } from 'node:util';
import type { LightscaperNativePhotoOriginalReadRequestCurrentV1 as BodyRequest } from './lightscaper-native-photo-original-read-authority-current-v1.ts';
import type { MediaAssetWriter } from '../src/common/editor/storage/media-asset-write-contract.ts';
import { readValidatedPhotoCatalogRootV1 } from '../src/lightscaper/catalog/documents.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { validatePhotoCatalogReferencesV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { PhotoCatalogRestoreDeliveryForProfileV1 } from '../src/lightscaper/catalog/internal/photo-catalog-restore-records-kernel-v1.ts';
import { readPhotoSmartCollectionSignalOptionsV1 } from '../src/lightscaper/catalog/photo-smart-collection-repository-types-v1.ts';
import { encodeLightscaperNativePhotoSettingKeyCurrentV1 as settingKey } from './lightscaper-native-photo-settings-request-current-v1.ts';
import { photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { normalizePhotoLibraryRestoreAllocationV1 } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';
import { field, record } from '../src/lightscaper/catalog/value-validation.ts';
import type { PhotoCatalogRootV1 } from '../src/lightscaper/catalog/types.ts';
import { readLightscaperNativeOriginalCurrentV1 } from './lightscaper-native-original-contract-current-v1.ts';
import { LightscaperNativePhotoMediaCurrentV1 as Media } from './lightscaper-native-photo-media-current-v1.ts';
import { LightscaperNativePhotoResourcesCurrentV1 as Resources } from './lightscaper-native-photo-resources-current-v1.ts';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from './lightscaper-native-photo-settings-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 } from './lightscaper-native-original-index-current-v1.ts';
import { deriveLightscaperNativePhotoResourcePathsCurrentV1 } from './lightscaper-native-photo-resources-database-current-v1.ts';
import { deriveLightscaperNativePhotoSettingsPathsCurrentV1 } from './lightscaper-native-photo-settings-database-current-v1.ts';
import { openLightscaperNativePhotoLibraryRestoreComponentCurrentV1, markLightscaperNativePhotoLibraryRestoreCleanupFailureCurrentV1 as markCleanup,
	createLightscaperNativePhotoLibraryRestoreCleanupFailureCurrentV1 as cleanupError,
	type LightscaperNativePhotoLibraryRestoreBindingCurrentV1 as Binding } from './lightscaper-native-photo-library-restore-claim-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check, linkLightscaperNativePhotoMediaSignalsCurrentV1 as link } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import { readLightscaperNativeCatalogRestoreAuditCurrentV1 } from './lightscaper-native-catalog-restore-stage-current-v1.ts';
import { admitLightscaperNativePhotoResourceReferenceCurrentV1, captureLightscaperNativePhotoResourceBodyCurrentV1,
	wipeLightscaperNativePhotoResourceBodyCurrentV1, type LightscaperNativePhotoResourceFamilyCurrentV1 as Family } from './lightscaper-native-photo-resource-body-current-v1.ts';
import { captureLightscaperNativePhotoMediaRestoreDeclarationsCurrentV1 as declarations,
	captureLightscaperNativePhotoMediaRestorePresetCurrentV1 as preset, lightscaperNativePhotoMediaRestoreDigestCurrentV1 as digest,
	type LightscaperNativePhotoMediaRestoreDeclarationsCurrentV1 as Declarations } from './lightscaper-native-photo-media-restore-contract-current-v1.ts';
import { captureLightscaperNativePhotoMediaRestoreOriginalCurrentV1 as originalInput,
	writeLightscaperNativePhotoMediaRestoreOriginalCurrentV1 as writeOriginal,
	type LightscaperNativePhotoMediaRestoreOriginalReceiptCurrentV1 as OriginalReceipt } from './lightscaper-native-photo-media-restore-original-current-v1.ts';
import { auditLightscaperNativePhotoMediaRestoreCurrentV1 as audit, readLightscaperNativePhotoMediaRestoreVersionsCurrentV1 as versions } from './lightscaper-native-photo-media-restore-audit-current-v1.ts';

export interface LightscaperNativePhotoMediaRestoreReceiptCurrentV1 {
	readonly catalogId: string; readonly photoCount: number; readonly originalCount: number; readonly originalByteLength: number;
	readonly inventorySha256: string; readonly catalogInventorySha256: string;
}
export interface LightscaperNativePhotoMediaRestoreStageCurrentV1 {
	writeOriginal(photo: unknown, source: AsyncIterable<Uint8Array>): Promise<Readonly<OriginalReceipt>>;
	writeDevelopPresets(value: unknown): Promise<void>;
	writeLut(reference: unknown, bytes: unknown): Promise<void>;
	writeMaskRaster(reference: unknown, bytes: unknown): Promise<void>;
	finish(sealedCatalog: unknown): Promise<Readonly<LightscaperNativePhotoMediaRestoreReceiptCurrentV1>>;
	close(): Promise<void>;
}
type Options = Readonly<{ root: unknown; developPresets: unknown; lutResources: unknown; maskRasters: unknown; signal?: AbortSignal }>;
type Owners = Readonly<{ media: Media; resources: Resources; settings: Settings; database: DatabaseSync; resourcesDatabase: DatabaseSync; settingsDatabase: DatabaseSync }>;
const receipts = new WeakMap<object, Stage>();
const NativeController = AbortController, ABORT = AbortController.prototype.abort;

/** Only a genuine fresh media-purpose claim can select physical storage. This
 * child never changes the active library, issues whole-ready authority or deletes
 * its generation. All ordinary owners are actual native implementations. */
export function createLightscaperNativePhotoMediaRestoreStageCurrentV1(claim: unknown, options: Options): Promise<Readonly<LightscaperNativePhotoMediaRestoreStageCurrentV1>> {
	return openLightscaperNativePhotoLibraryRestoreComponentCurrentV1(claim, 'media', async binding => {
		const input = record(options, 'native media restore options', ['root', 'developPresets', 'lutResources', 'maskRasters', 'signal'], ['root', 'developPresets', 'lutResources', 'maskRasters']);
		const caller = readPhotoSmartCollectionSignalOptionsV1(Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal') } : {}).signal;
		const outer = link(caller, binding.signal), controller = new NativeController(), local = link(outer.signal, controller.signal);
		let media: Media | undefined, resources: Resources | undefined, settings: Settings | undefined;
		let database: DatabaseSync | undefined, resourcesDatabase: DatabaseSync | undefined, settingsDatabase: DatabaseSync | undefined;
		const detach = (): void => { let failed = false, primary: unknown; try { local.detach(); } catch (error) { failed = true; primary = error; }
			try { outer.detach(); } catch (error) { throw cleanupError(primary, error, 'Native restore admission links failed to retire.'); } if (failed) { markCleanup(primary); throw primary; } };
		try {
			check(local.signal); binding.assertCurrent(); const root = readValidatedPhotoCatalogRootV1(field(input, 'root'));
			if (root.id !== binding.allocation.catalogId) throw new TypeError('Native media root belongs to another fresh allocation.');
			const declared = declarations(field(input, 'developPresets'), field(input, 'lutResources'), field(input, 'maskRasters'));
			check(local.signal); binding.assertCurrent();
			media = await ownedOpen(() => Media.open({ appDataPath: binding.appDataPath })); check(local.signal); binding.assertCurrent();
			resources = await ownedOpen(() => Resources.open({ appDataPath: binding.appDataPath })); check(local.signal); binding.assertCurrent();
			settings = await ownedOpen(() => Settings.open({ appDataPath: binding.appDataPath, scope: 'selected:library' })); check(local.signal); binding.assertCurrent();
			database = new DatabaseSync(deriveLightscaperNativePhotoOriginalPathsCurrentV1(binding.appDataPath).databasePath, { readOnly: true });
			resourcesDatabase = new DatabaseSync(deriveLightscaperNativePhotoResourcePathsCurrentV1(binding.appDataPath).databasePath, { readOnly: true });
			settingsDatabase = new DatabaseSync(deriveLightscaperNativePhotoSettingsPathsCurrentV1(binding.appDataPath).databasePath, { readOnly: true });
			check(local.signal); binding.assertCurrent(); const state = new Stage(binding, root, declared,
				{ media, resources, settings, database, resourcesDatabase, settingsDatabase }, controller, local.signal, detach);
			return Object.freeze<LightscaperNativePhotoMediaRestoreStageCurrentV1>({ writeOriginal: (photo, source) => state.writeOriginal(photo, source),
				writeDevelopPresets: value => state.writePresets(value), writeLut: (reference, bytes) => state.writeResource('lut', reference, bytes),
				writeMaskRaster: (reference, bytes) => state.writeResource('brush', reference, bytes), finish: catalog => state.finish(catalog), close: () => state.close() });
		} catch (primary) {
			let error = primary;
			for (const db of [settingsDatabase, resourcesDatabase, database]) { try { db?.close(); } catch (failure) { error = cleanupError(error, failure, 'Native restore admission SQL close failed.'); } }
			for (const owner of [settings, resources, media]) { try { await owner?.close(); } catch (failure) { error = cleanupError(error, failure, 'Native restore admission owner close failed.'); } }
			try { detach(); } catch (failure) { error = cleanupError(error, failure, 'Native restore admission links failed to retire.'); } throw error;
		}
	});
}
export function readLightscaperNativePhotoMediaRestoreReceiptCurrentV1(value: unknown, allocation: unknown): Readonly<LightscaperNativePhotoMediaRestoreReceiptCurrentV1> {
	const stage = value !== null && typeof value === 'object' ? receipts.get(value) : undefined;
	if (!stage || !stage.receipt || stage.receipt !== value) throw new TypeError('Native media readiness requires its actual issued receipt.');
	stage.assertAllocation(allocation); return stage.receipt;
}
/** This classifier surrounds only fixed native static opens with one captured
 * private path. No callback, signal, iterator or borrowed options enters it. */
async function ownedOpen<Owner>(open: () => Promise<Owner>): Promise<Owner> {
	try { return await open(); } catch (error) {
		if (types.isNativeError(error) && Object.getOwnPropertyDescriptor(error, 'errors') !== undefined) markCleanup(error); throw error;
	}
}

class Stage {
	readonly #binding: Readonly<Binding>; readonly #root: PhotoCatalogRootV1; readonly #declared: Declarations; readonly #owners: Owners;
	readonly #controller: AbortController; readonly #signal: AbortSignal; readonly #detach: () => void;
	readonly #delivery: PhotoCatalogRestoreDeliveryForProfileV1<'current4'>;
	readonly #locators = new Map<string, string>(); readonly #bodyRequests = new Map<string, Readonly<BodyRequest>>(); readonly #metadata = new Map<string, string>(); readonly #resources = new Set<string>();
	readonly #cleanup: unknown[] = []; readonly #unretired = new Set<AsyncIterator<Uint8Array>>();
	#active: Promise<unknown> | null = null; #closing: Promise<void> | null = null; #finishing: Promise<Readonly<LightscaperNativePhotoMediaRestoreReceiptCurrentV1>> | null = null;
	#failed = false; #writer: MediaAssetWriter | null = null; #photos = 0; #bytes = 0; #locatorBytes = 0; #presetDigest: string | null = null;
	#versions: readonly number[] | null = null; #presetPayloadBytes: number | null = null;
	receipt: Readonly<LightscaperNativePhotoMediaRestoreReceiptCurrentV1> | null = null;
	constructor(binding: Readonly<Binding>, root: PhotoCatalogRootV1, declared: Declarations, owners: Owners, controller: AbortController, signal: AbortSignal, detach: () => void) {
		this.#binding = binding; this.#root = root; this.#declared = declared; this.#owners = owners; this.#controller = controller; this.#signal = signal; this.#detach = detach;
		this.#delivery = new PhotoCatalogRestoreDeliveryForProfileV1('current4', root.id);
	}
	assertAllocation(value: unknown): void {
		if (this.#cleanup.length || JSON.stringify(normalizePhotoLibraryRestoreAllocationV1(value)) !== JSON.stringify(this.#binding.allocation)) throw new TypeError('Native media receipt belongs to another allocation or unretired owner.');
	}
	writeOriginal(value: unknown, source: AsyncIterable<Uint8Array>): Promise<Readonly<OriginalReceipt>> {
		return this.#run(() => {
			if (this.#photos >= this.#root.photoCount || this.#resources.size || this.#presetDigest !== null) throw new Error('Native restore Originals precede late resources and declared count.');
			const photo = normalizePhotoDocumentCurrentV1(value); validatePhotoCatalogReferencesV1(photo, this.#root); readLightscaperNativeOriginalCurrentV1(photo.original); this.#delivery.admit(photo);
			const identity = JSON.stringify([photo.original.contentSha256, photo.original.byteLength]), previous = this.#locators.get(photo.original.storageKey);
			if (previous !== undefined && previous !== identity) throw new Error('Native restore repeated locator has conflicting identity.');
			const request = Object.freeze({ catalogId: photo.catalogId, photoId: photo.id, original: photo.original, importId: this.#binding.allocation.operationId });
			const charged = 4 + 64 + Buffer.byteLength(JSON.stringify(request), 'utf8') + Buffer.byteLength(photo.original.storageKey, 'utf8') + Buffer.byteLength(identity, 'utf8');
			if (previous === undefined && charged > 16 * 1024 * 1024 - this.#locatorBytes) throw new RangeError('Native restore locator ledger exceeds its fixed bound.');
			return { input: originalInput(photo, source), identity, charged, known: previous !== undefined, request, previousRequest: this.#bodyRequests.get(photo.original.storageKey) };
		}, async ({ input, identity, charged, known, request, previousRequest }) => {
			const receipt = await writeOriginal(input, this.#owners.media, this.#owners.database, this.#binding.allocation.operationId, this.#signal, previousRequest,
				writer => { this.#writer = writer; }, (iterator, error) => { this.#unretired.add(iterator); this.#cleanup.push(error); });
			this.#photos++;
			if (!known) { this.#locators.set(input.photo.original.storageKey, identity); this.#bodyRequests.set(input.photo.original.storageKey, request); this.#metadata.set(input.photo.original.storageKey, digest({ name: input.photo.original.name, mimeType: input.photo.original.mimeType, lastModified: 0 })); this.#locatorBytes += charged; this.#bytes += receipt.size;
				if (!Number.isSafeInteger(this.#bytes)) throw new RangeError('Native restored Original total exceeds its scalar budget.'); }
			return receipt;
		});
	}
	writePresets(value: unknown): Promise<void> {
		return this.#run(() => {
			if (this.#photos !== this.#root.photoCount || this.#presetDigest !== null) throw new Error('Restored presets require complete Originals and one declared delivery.');
			return preset(value, this.#root.id, this.#declared.presets);
		}, async row => {
			this.#check(); const stored = await this.#owners.settings.settingsRepository.putIfAbsent(photoDevelopPresetsKeyV1(this.#root.id), row);
			if (!stored) throw new Error('Native restore preset setting was already physical.'); this.#presetDigest = digest(row);
			const payload = this.#owners.settingsDatabase.prepare('SELECT length(payload) AS bytes FROM native_photo_settings WHERE scope=? AND key=?').get('selected:library', settingKey(photoDevelopPresetsKeyV1(this.#root.id)))?.bytes;
			if (typeof payload !== 'number' || !Number.isSafeInteger(payload) || payload < 1) throw new Error('Native restored preset payload is missing.'); this.#presetPayloadBytes = payload;
		});
	}
	writeResource(family: Family, reference: unknown, bytes: unknown): Promise<void> {
		return this.#run(() => {
			if (this.#photos !== this.#root.photoCount) throw new Error('Native restored resources require complete preceding Originals.');
			const admitted = admitLightscaperNativePhotoResourceReferenceCurrentV1(family, reference), expected = (family === 'lut' ? this.#declared.luts : this.#declared.brushes).find(item => item.storageKey === admitted.storageKey);
			if (!expected || JSON.stringify(expected) !== JSON.stringify(admitted) || this.#resources.has(admitted.storageKey)) throw new Error('Native restored resource has no unique exact declaration.');
			return captureLightscaperNativePhotoResourceBodyCurrentV1(family, admitted, bytes);
		}, async body => {
			try {
				this.#check(); const capabilities = body.family === 'lut' ? await this.#owners.resources.cubeLutResources() : await this.#owners.resources.maskRasterResources();
				await capabilities.put(body.reference, body.bytes, { signal: this.#signal }); this.#resources.add(body.reference.storageKey);
			} finally { wipeLightscaperNativePhotoResourceBodyCurrentV1(body); }
		});
	}
	finish(value: unknown): Promise<Readonly<LightscaperNativePhotoMediaRestoreReceiptCurrentV1>> {
		if (this.#closing) return Promise.reject(new Error('Native media restore is closed.'));
		if (this.#finishing) return this.#finishing;
		this.#finishing = this.#run(() => {
			const catalog = readLightscaperNativeCatalogRestoreAuditCurrentV1(value, this.#binding.allocation);
			if (JSON.stringify(catalog.root) !== JSON.stringify(this.#root) || this.#photos !== this.#root.photoCount
				|| this.#resources.size !== this.#declared.luts.length + this.#declared.brushes.length || (this.#declared.presets !== null) !== (this.#presetDigest !== null)) throw new Error('Native restored delivery is incomplete or belongs to another root.');
			return catalog;
		}, async catalog => {
			const result = await audit({ ...this.#owners, root: this.#root, allocation: this.#binding.allocation, declarations: this.#declared,
				catalog, presetDigest: this.#presetDigest, presetPayloadBytes: this.#presetPayloadBytes, originalCount: this.#locators.size, originalByteLength: this.#bytes,
				locatorMetadata: this.#metadata, signal: this.#signal, assertCurrent: () => { this.#binding.assertCurrent(); }, delivery: this.#delivery });
			const receipt = Object.freeze({ catalogId: this.#root.id, photoCount: this.#photos, originalCount: this.#locators.size, originalByteLength: this.#bytes,
				inventorySha256: result.inventorySha256, catalogInventorySha256: catalog.inventorySha256 });
			this.#versions = result.versions; this.receipt = receipt; receipts.set(receipt, this); return receipt;
		}, true); return this.#finishing;
	}
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolve!: () => void, reject!: (reason: unknown) => void;
		this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		const aborts: Promise<unknown>[] = [];
		try { Reflect.apply(ABORT, this.#controller, [new Error('Native media restore is closing.')]); } catch (error) { this.#cleanup.push(error); }
		// Interrupt the escaped physical producer before waiting for its owner.
		try { if (this.#writer) aborts.push(this.#writer.abort()); } catch (error) { this.#cleanup.push(error); }
		void Promise.allSettled([this.#active, ...aborts]).then(async results => {
			for (const result of results.slice(1)) if (result.status === 'rejected') this.#cleanup.push(result.reason);
			try { if (this.#versions && JSON.stringify(versions(this.#owners)) !== JSON.stringify(this.#versions)) this.#cleanup.push(new Error('Sealed native media changed before joined close.')); } catch (error) { this.#cleanup.push(error); }
			for (const owner of [this.#owners.settings, this.#owners.resources, this.#owners.media]) { try { await owner.close(); } catch (error) { this.#cleanup.push(error); } }
			for (const db of [this.#owners.settingsDatabase, this.#owners.resourcesDatabase, this.#owners.database]) { try { db.close(); } catch (error) { this.#cleanup.push(error); } }
			try { this.#detach(); } catch (error) { this.#cleanup.push(error); }
			if (this.#cleanup.length) { const error = new AggregateError(this.#cleanup, 'Native media restore retirement is unproved; candidate retained.'); markCleanup(error); throw error; }
			this.#delivery.clear(); this.#locators.clear(); this.#bodyRequests.clear(); this.#metadata.clear(); this.#resources.clear();
		}).then(resolve, reject); return this.#closing;
	}
	#run<Input, Result>(capture: () => Input, operation: (input: Input) => Promise<Result>, finishing = false): Promise<Result> {
		try { if (this.#closing || this.#active || this.#failed || this.#finishing && !finishing) throw new Error('Native media restore is closed, failed, sealed or busy.'); this.#check(); }
		catch (error) { return Promise.reject(error); }
		let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (reason: unknown) => void;
		const pending = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; }); this.#active = pending;
		const failed = (error: unknown): void => { this.#failed = true; this.#active = null; reject(error); };
		try { const input = capture(); void operation(input).then(value => { this.#active = null; resolve(value); }, failed); }
		catch (error) { failed(error); } return pending;
	}
	#check(): void { check(this.#signal); this.#binding.assertCurrent(); check(this.#signal); }
}
