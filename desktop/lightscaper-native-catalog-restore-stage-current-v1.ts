/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { types } from 'node:util';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/foundation/closed-domain-value.ts';
import { PhotoCatalogRestoreDeliveryForProfileV1 } from '../src/lightscaper/catalog/internal/photo-catalog-restore-records-kernel-v1.ts';
import { assertPhotoSmartCollectionArchiveQueryV1 } from '../src/lightscaper/catalog/photo-smart-collection-contract-v1.ts';
import { readPhotoSmartCollectionSignalOptionsV1 } from '../src/lightscaper/catalog/photo-smart-collection-repository-types-v1.ts';
import { normalizePhotoLibraryRestoreAllocationV1, type PhotoLibraryRestoreAllocationV1 as Allocation } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';
import type { PhotoCatalogRootV1 } from '../src/lightscaper/catalog/types.ts';
import type { PhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { id } from '../src/lightscaper/catalog/value-validation.ts';
import { linkLightscaperNativePhotoMediaSignalsCurrentV1 as link } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import { openLightscaperNativePhotoLibraryRestoreComponentCurrentV1,
	createLightscaperNativePhotoLibraryRestoreCleanupFailureCurrentV1 as cleanupError,
	markLightscaperNativePhotoLibraryRestoreCleanupFailureCurrentV1 as markCleanup } from './lightscaper-native-photo-library-restore-claim-current-v1.ts';
import { openLightscaperNativeCatalogDatabaseCurrentV1 } from './lightscaper-native-catalog-files-current-v1.ts';
import { readLightscaperNativePhotoRowCurrentV1 } from './lightscaper-native-catalog-records-current-v1.ts';
import { writeLightscaperNativeLegacyQueryBuildCurrentV1 } from './lightscaper-native-legacy-query-write-current-v1.ts';
import { writeLightscaperNativeQueryBuildCurrentV1 } from './lightscaper-native-query-write-current-v1.ts';
import { auditLightscaperNativeCatalogRestoreCurrentV1, assertCatalogRestoreControlsCurrentV1, assertCatalogRestoreCountsCurrentV1,
	hashCatalogRestoreInventoryCurrentV1, readCatalogRestorePointCurrentV1, type LightscaperNativeCatalogRestoreAuditCountsCurrentV1 as Counts } from './lightscaper-native-catalog-restore-audit-current-v1.ts';
import { rootPacket, photoPacket, stackPacket, savedPacket, initializeCatalogRestoreCurrentV1,
	insertCatalogRestorePhotoCurrentV1, insertCatalogRestoreStackCurrentV1, insertCatalogRestoreSavedCurrentV1,
	catalogRestorePhotoMembershipPageCurrentV1, catalogRestoreStackMembershipPageCurrentV1,
	catalogRestoreTransactionCurrentV1 as transaction,
	checkCatalogRestoreCurrentV1 as check, catalogRestoreCleanupFailureCurrentV1 as cleanupFailure,
	type LightscaperNativeCatalogRestoreRootCurrentV1 as Root } from './lightscaper-native-catalog-restore-records-current-v1.ts';

export interface LightscaperNativeCatalogRestoreReceiptCurrentV1 {
	readonly catalogId: string; readonly catalogRevision: number; readonly photoCount: number; readonly stackCount: number;
	readonly savedCollectionCount: number; readonly indexRevision: 0; readonly inventorySha256: string;
}
export interface LightscaperNativeCatalogRestorePhotoKeyPageCurrentV1 {
	readonly keys: readonly Readonly<{ key: string; photoId: string }>[]; readonly afterKey: string | null;
}
export interface LightscaperNativeCatalogRestoreStageCurrentV1 {
	writePhoto(value: unknown): Promise<void>;
	writeStack(value: unknown): Promise<void>;
	writeSavedCollection(value: unknown): Promise<void>;
	finish(): Promise<Readonly<LightscaperNativeCatalogRestoreReceiptCurrentV1>>;
	readPhotoKeyPage(afterKey: string | null): Promise<Readonly<LightscaperNativeCatalogRestorePhotoKeyPageCurrentV1>>;
	readPhoto(photoId: string): Promise<Readonly<PhotoDocumentCurrentV1>>;
	close(): Promise<void>;
}
export interface LightscaperNativeCatalogRestoreAuditCurrentV1 {
	readonly inventorySha256: string;
	readonly root: Readonly<PhotoCatalogRootV1>;
	readonly readPhotoKeyPage: LightscaperNativeCatalogRestoreStageCurrentV1['readPhotoKeyPage'];
	readonly readPhoto: LightscaperNativeCatalogRestoreStageCurrentV1['readPhoto'];
}
type Binding = Readonly<{ allocation: Readonly<Allocation>; appDataPath: string; signal: AbortSignal; assertCurrent(): void }>;
const stages = new WeakMap<object, Stage>(), receipts = new WeakMap<object, Stage>();

/** Only the actual fresh Scopes candidate can open this owner. A caller-owned
 * connection, path, normalized allocation or cloned ready DTO is insufficient. */
export function createLightscaperNativeCatalogRestoreStageCurrentV1(claim: unknown,
	options: Readonly<{ root: unknown; savedState: unknown; signal?: AbortSignal }>): Promise<Readonly<LightscaperNativeCatalogRestoreStageCurrentV1>> {
	return openLightscaperNativePhotoLibraryRestoreComponentCurrentV1(claim, 'catalog', async binding => {
		const input = record(options, 'native catalog restore options', ['root', 'savedState', 'signal'], ['root', 'savedState']);
		const caller = readPhotoSmartCollectionSignalOptionsV1(Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal', 'native catalog restore options') } : {}).signal;
		const selected = link(caller, binding.signal), signal = selected.signal; let database: DatabaseSync | undefined;
		try {
			check(signal); binding.assertCurrent();
			const root = rootPacket(field(input, 'root', 'native catalog restore options'), field(input, 'savedState', 'native catalog restore options'));
			if (root.root.id !== binding.allocation.catalogId) throw new TypeError('Native catalog restore root differs from its genuine allocation.');
			// Only this fixed native opener receives its actual private path; no
			// caller signal/DTO participates in its AggregateError provenance.
			try { database = await openLightscaperNativeCatalogDatabaseCurrentV1(binding.appDataPath); }
			catch (failure) { if (types.isNativeError(failure) && Object.getOwnPropertyDescriptor(failure, 'errors') !== undefined) markCleanup(failure); throw failure; }
			check(signal); binding.assertCurrent(); const state = new Stage(database, binding, root, signal, selected.detach);
			const result = Object.freeze<LightscaperNativeCatalogRestoreStageCurrentV1>({ writePhoto: value => state.writePhoto(value), writeStack: value => state.writeStack(value),
				writeSavedCollection: value => state.writeSaved(value), finish: () => state.finish(), readPhotoKeyPage: key => state.readKeys(key),
				readPhoto: photoId => state.readPhoto(photoId), close: () => state.close() }); stages.set(result, state); return result;
		} catch (primary) {
			if (cleanupFailure(primary)) markCleanup(primary); let error = primary;
			try { selected.detach(); } catch (failure) { error = cleanupError(error, failure, 'Native catalog restore admission links did not retire.'); }
			try { database?.close(); } catch (failure) { error = cleanupError(error, failure, 'Native catalog restore opening and retirement failed.'); }
			throw error;
		}
	});
}
export function readLightscaperNativeCatalogRestoreReceiptCurrentV1(value: unknown, allocation: unknown): Readonly<LightscaperNativeCatalogRestoreReceiptCurrentV1> {
	const state = value !== null && typeof value === 'object' ? receipts.get(value) : undefined;
	if (!state || !state.receipt || state.receipt !== value) throw new TypeError('Native catalog ready requires its actual issued receipt.');
	state.assertAllocation(allocation); return state.receipt;
}
export function readLightscaperNativeCatalogRestoreAuditCurrentV1(value: unknown, allocation: unknown): Readonly<LightscaperNativeCatalogRestoreAuditCurrentV1> {
	const state = value !== null && typeof value === 'object' ? stages.get(value) : undefined;
	if (!state) throw new TypeError('Native media audit requires its actual sealed catalog stage.');
	state.assertAllocation(allocation); state.assertSealed();
	const receipt = state.receipt; if (!receipt) throw new TypeError('Native catalog audit has no actual issued receipt.');
	return Object.freeze<LightscaperNativeCatalogRestoreAuditCurrentV1>({ inventorySha256: receipt.inventorySha256, root: state.root.root,
		readPhotoKeyPage: key => state.readKeys(key), readPhoto: photoId => state.readPhoto(photoId) });
}

class Stage {
	readonly #database: DatabaseSync; readonly #binding: Binding; readonly root: Root;
	readonly #controller = new AbortController(); readonly #signal: AbortSignal; readonly #detach: () => void;
	readonly #delivery: PhotoCatalogRestoreDeliveryForProfileV1<'current4'>;
	readonly #cleanup: unknown[] = [];
	#count: Counts = { photos: 0, stacks: 0, saved: 0, legacy: 0 };
	#active: Promise<unknown> | null = null; #closing: Promise<void> | null = null;
	#failed = false; #sealed = false; #dataVersion: number | null = null;
	receipt: Readonly<LightscaperNativeCatalogRestoreReceiptCurrentV1> | null = null;
	constructor(database: DatabaseSync, binding: Binding, root: Root, signal: AbortSignal, detachOuter: () => void) {
		this.#database = database; this.#binding = binding; this.root = root;
		const selected = link(signal, this.#controller.signal); this.#signal = selected.signal; let detached = false;
		this.#detach = () => { if (detached) return; detached = true; let failed = false, primary: unknown;
			try { selected.detach(); } catch (error) { failed = true; primary = error; }
			try { detachOuter(); } catch (error) { throw cleanupError(primary, error, 'Native catalog restore signal links did not retire.'); }
			if (failed) { markCleanup(primary); throw primary; }
		};
		this.#delivery = new PhotoCatalogRestoreDeliveryForProfileV1('current4', root.root.id);
		try { this.#transaction(true, () => initializeCatalogRestoreCurrentV1(database, root)); }
		catch (primary) { try { this.#detach(); } catch (failure) { throw cleanupError(primary, failure, 'Native catalog restore initialization links did not retire.'); } throw primary; }
	}
	assertAllocation(value: unknown): void {
		if (JSON.stringify(normalizePhotoLibraryRestoreAllocationV1(value)) !== JSON.stringify(this.#binding.allocation)) throw new TypeError('Native restore receipt belongs to another allocation.');
		if (this.#cleanup.length) throw new Error('Native catalog restore retirement is unproved.');
	}
	assertSealed(): void {
		if (!this.receipt || this.#closing || this.#failed) throw new Error('Native catalog audit requires its live successfully sealed owner.');
		this.#check(); this.#assertVersion();
	}
	writePhoto(value: unknown): Promise<void> {
		return this.#run(async () => {
			if (this.#count.stacks || this.#count.saved || this.#count.photos >= this.root.root.photoCount) throw new RangeError('Restored Photos must precede complete grouping and stay within declared count.');
			const packet = photoPacket('current4', this.root.root, value); this.#budget(packet, packet.photo.document); this.#delivery.admit(packet.photo.document);
			this.#transaction(true, () => insertCatalogRestorePhotoCurrentV1(this.#database, packet));
			for (let offset = 0; offset < packet.memberships.length; offset += 64) { this.#transaction(true, () => catalogRestorePhotoMembershipPageCurrentV1(this.#database, packet, offset)); await this.#yield(); }
			this.#count = { ...this.#count, photos: this.#count.photos + 1, legacy: this.#count.legacy + (packet.queryV1 === null ? 0 : 1) };
		});
	}
	writeStack(value: unknown): Promise<void> {
		return this.#run(async () => {
			if (this.#count.photos !== this.root.root.photoCount || this.#count.saved) throw new Error('Restored stacks require all preceding Photos.');
			if (this.#count.stacks >= Math.floor(this.root.root.photoCount / 2)) throw new RangeError('Restored stacks exceed their source capacity.');
			const packet = stackPacket(this.root.root, value); this.#budget(packet, packet.stack.document); this.#delivery.admit(packet.stack.document);
			this.#transaction(true, () => insertCatalogRestoreStackCurrentV1(this.#database, packet));
			for (let offset = 0; offset < packet.memberships.length; offset += 64) { this.#transaction(true, () => catalogRestoreStackMembershipPageCurrentV1(this.#database, packet, offset)); await this.#yield(); }
			this.#count = { ...this.#count, stacks: this.#count.stacks + 1 };
		});
	}
	writeSaved(value: unknown): Promise<void> {
		return this.#run(async () => {
			if (this.#count.photos !== this.root.root.photoCount || this.#count.saved >= (this.root.savedState?.collectionCount ?? 0)) throw new RangeError('Restored saved recipes require complete Photos and declared physical state.');
			const packet = savedPacket(this.root.root, value); assertPhotoSmartCollectionArchiveQueryV1(packet.definition.document, { ...packet.definition, document: value });
			this.#budget(packet, packet.definition.document); this.#delivery.admit(packet.definition.document); this.#transaction(true, () => insertCatalogRestoreSavedCurrentV1(this.#database, packet));
			this.#count = { ...this.#count, saved: this.#count.saved + 1 };
		});
	}
	finish(): Promise<Readonly<LightscaperNativeCatalogRestoreReceiptCurrentV1>> {
		return this.#run(async () => {
			this.#sealed = true; const version = this.#version();
			const expected = await auditLightscaperNativeCatalogRestoreCurrentV1(this.#database, this.root, this.#count, this.#delivery, this.#signal);
			const inventorySha256 = await hashCatalogRestoreInventoryCurrentV1(this.#database, this.#signal, this.#count);
			const receipt = Object.freeze({ catalogId: this.root.root.id, catalogRevision: this.root.root.revision, photoCount: this.#count.photos,
				stackCount: this.#count.stacks, savedCollectionCount: this.#count.saved, indexRevision: 0 as const, inventorySha256 });
			this.#transaction(true, () => {
				if (this.#version() !== version) throw new Error('Native catalog restore changed on an independent connection during audit.');
				assertCatalogRestoreControlsCurrentV1(this.#database, this.root, this.#count, false); assertCatalogRestoreCountsCurrentV1(this.#database, expected);
				writeLightscaperNativeLegacyQueryBuildCurrentV1(this.#database, { ...this.root.queryBuildV1, ready: this.#count.legacy === this.#count.photos, indexedCount: this.#count.legacy });
				writeLightscaperNativeQueryBuildCurrentV1(this.#database, { ...this.root.queryBuildV2, ready: true, indexedCount: this.#count.photos });
				this.#database.prepare('UPDATE native_photo_stack_states SET stack_count=? WHERE catalog_id=?').run(this.#count.stacks, this.root.root.id);
				assertCatalogRestoreControlsCurrentV1(this.#database, this.root, this.#count, true); this.#dataVersion = version;
			});
			// No post-COMMIT cancellation/reflection can retract this exact ACK.
			this.receipt = receipt; receipts.set(receipt, this); return receipt;
		}, true);
	}
	readKeys(value: string | null): Promise<Readonly<LightscaperNativeCatalogRestorePhotoKeyPageCurrentV1>> {
		return this.#run(async () => {
			this.assertSealed(); const after = value === null ? null : this.#key(value);
			return this.#transaction(false, () => {
				this.#assertVersion(); const rows = this.#database.prepare(`SELECT CASE WHEN length(photo_key)<=257 THEN photo_key END AS key,
					CASE WHEN length(photo_id)<=128 THEN photo_id END AS photoId FROM native_photos WHERE catalog_id=? ${after === null ? '' : 'AND photo_key>?'} ORDER BY photo_key LIMIT 64`)
					.all(this.root.root.id, ...(after === null ? [] : [after]));
				const keys = rows.map(row => { const photoId = id(row.photoId, 'restored photo ID'); if (row.key !== `${this.root.root.id}|${photoId}`) throw new TypeError('Native sealed Photo key is invalid.'); return Object.freeze({ key: row.key, photoId }); });
				return Object.freeze({ keys: Object.freeze(keys), afterKey: keys.length === 64 ? keys.at(-1)!.key : null });
			});
		}, false, true);
	}
	readPhoto(value: string): Promise<Readonly<PhotoDocumentCurrentV1>> {
		return this.#run(async () => {
			this.assertSealed(); const photoId = id(value, 'restored photo ID');
			return this.#transaction(false, () => {
				this.#assertVersion(); const raw = readCatalogRestorePointCurrentV1(this.#database, 'native_photos', `${this.root.root.id}|${photoId}`);
				if (!raw) throw new ReferenceError('Restored Photo is missing.');
				const photo = readLightscaperNativePhotoRowCurrentV1(raw, this.root.root.id, photoId); this.#delivery.assertDelivered(photo); return photo;
			});
		}, false, true);
	}
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolve!: () => void, reject!: (reason: unknown) => void;
		this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		void Promise.resolve().then(async () => {
			await Promise.allSettled([this.#active]); const failures: unknown[] = [...this.#cleanup];
			if (this.receipt) { try { this.#assertVersion(); } catch (error) { failures.push(error); } }
			try { this.#detach(); } catch (error) { failures.push(error); }
			try { this.#database.close(); } catch (error) { failures.push(error); }
			if (failures.length) { this.#cleanup.push(...failures); throw new AggregateError(failures, 'Native catalog restore close is unproved.'); }
			this.#delivery.clear();
		}).then(resolve, reject);
		this.#controller.abort(new Error('Native catalog restore is closing.')); return this.#closing;
	}
	#run<Result>(operation: () => Promise<Result>, finishing = false, reading = false): Promise<Result> {
		try { this.#check(); if (this.#closing || this.#active || this.#failed || this.#sealed && !reading) throw new Error('Native catalog restore is busy, failed, sealed or closed.'); }
		catch (error) { return Promise.reject(error); }
		let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (reason: unknown) => void;
		const work = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; }); this.#active = work;
		try { void operation().then(value => { this.#active = null; resolve(value); }, (error: unknown) => { if (cleanupFailure(error)) this.#cleanup.push(error); if (!reading || finishing) this.#failed = true; this.#active = null; reject(error); }); }
		catch (error) { this.#failed = true; this.#active = null; reject(error); } return work;
	}
	#transaction<Result>(writing: boolean, run: () => Result): Result {
		try { return transaction(this.#database, this.#signal, writing, () => { this.#binding.assertCurrent(); return run(); }); }
		catch (error) { if (cleanupFailure(error)) this.#cleanup.push(error); throw error; }
	}
	#version(): number { const version = this.#database.prepare('PRAGMA data_version').get()?.data_version; if (typeof version !== 'number' || !Number.isSafeInteger(version)) throw new TypeError('Native catalog data version is invalid.'); return version; }
	#assertVersion(): void { if (this.#dataVersion === null || this.#version() !== this.#dataVersion) throw new Error('Sealed native catalog changed through another connection.'); }
	#key(value: string): string { if (typeof value !== 'string' || !value.startsWith(`${this.root.root.id}|`)) throw new TypeError('Restored cursor belongs to another catalog.'); id(value.slice(this.root.root.id.length + 1), 'restored cursor photo'); return value; }
	#budget(value: unknown, source: unknown): void { if (Buffer.byteLength(JSON.stringify(this.root.root), 'utf8') + Buffer.byteLength(JSON.stringify(source), 'utf8') + Buffer.byteLength(JSON.stringify(value), 'utf8') > 8 * 1024 * 1024) throw new RangeError('Native restore source and projections exceed their combined byte budget.'); }
	#check(): void { check(this.#signal); this.#binding.assertCurrent(); check(this.#signal); }
	async #yield(): Promise<void> { await nextTurn(); this.#check(); }
}
