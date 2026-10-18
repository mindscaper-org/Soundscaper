/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { openLightscaperNativeCatalogDatabaseCurrentV1 as openCatalogDatabase } from './lightscaper-native-catalog-files-current-v1.ts';
import { initializeLightscaperNativeDefaultCatalogCurrentV1 as initializeDefault } from './lightscaper-native-catalog-transactions-current-v1.ts';
import { randomBytes } from 'node:crypto';
import { canonicalKeyValueComparison as canonical } from '../src/common/editor/storage/key-value-canonical-comparison.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoLibraryRestoreAllocationV1, type PhotoLibraryRestoreAllocationV1 as Allocation } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';
import { LightscaperNativeCatalogStoreCurrentV1 as Catalog } from './lightscaper-native-catalog-store-current-v1.ts';
import { openLightscaperNativePhotoLibraryOwnerCurrentV1 as openOwner } from './lightscaper-native-photo-library-components-current-v1.ts';
import type { LightscaperNativePhotoSettingsCurrentV1 as Settings } from './lightscaper-native-photo-settings-current-v1.ts';
import type { LightscaperNativePhotoLibraryScopeRegistryCurrentV1 as Registry } from './lightscaper-native-photo-library-scope-registry-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import { readLightscaperNativePhotoLibrarySelectionCurrentV1 as readSelection, readLightscaperNativePhotoLibraryCommitCurrentV1 as readCommit,
	lightscaperNativePhotoLibraryCommitKeyCurrentV1 as commitKey, LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_SELECTION_KEY_CURRENT_V1 as POINTER,
	LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_ACTIVE_RESTORE_KEY_CURRENT_V1 as ACTIVE, type LightscaperNativePhotoLibrarySelectionCurrentV1 as Pointer } from './lightscaper-native-photo-library-selection-contract-current-v1.ts';
import type { LightscaperNativePhotoLibraryRestoreReadyBindingCurrentV1 as Ready } from './lightscaper-native-photo-library-restore-ready-current-v1.ts';
export interface LightscaperNativePhotoLibrarySelectionSnapshotCurrentV1 {
	readonly raw: unknown; readonly pointer: Readonly<Pointer>;
	readonly binding: Readonly<{ allocation: Readonly<Allocation> | null; appDataPath: string }>;
}
export interface LightscaperNativePhotoLibraryPublicationCurrentV1 {
	readonly selectionToken: string; readonly receipt: Ready['receipt']; readonly status: 'committed' | 'reconciled';
}
/** Private fixed-anchor state owner. Scalar profiles never replace real
 * registry+manifest authentication or the manager's actual single-use Ready. */
export class LightscaperNativePhotoLibrarySelectionCurrentV1 {
	readonly #anchor: Settings; readonly #registry: Registry; readonly #appDataPath: string;
	readonly #assert: () => void; readonly #quarantine: () => void; readonly #unretired = new Set<Catalog | DatabaseSync>();
	constructor(anchor: Settings, registry: Registry, appDataPath: string, assert: () => void, quarantine: () => void) {
		this.#anchor = anchor; this.#registry = registry; this.#appDataPath = appDataPath; this.#assert = assert; this.#quarantine = quarantine;
	}
	async open(name: string, signal: AbortSignal): Promise<Readonly<LightscaperNativePhotoLibrarySelectionSnapshotCurrentV1>> {
		this.#check(signal); let entry = await this.#anchor.readLibraryAnchorEntryCurrentV1(POINTER); this.#check(signal);
		if (!entry.present) {
			const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: `catalog-${randomBytes(16).toString('hex')}`,
				name, revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
			const database = await openOwner(() => openCatalogDatabase(this.#appDataPath), this.#quarantine); this.#unretired.add(database);
			let failed = false, primary: unknown;
			try { this.#check(signal); initializeDefault(database, root); } catch (error) { failed = true; primary = error; }
			try { database.close(); this.#unretired.delete(database); }
			catch (cleanup) { this.#quarantine(); if (failed) throw new AggregateError([primary, cleanup], 'Native default creation and actual DB close failed.', { cause: cleanup }); throw cleanup; }
			if (failed) throw primary;
			this.#check(signal); const pointer = readSelection({ schemaVersion: 1, kind: 'native-photo-library-selection', selectionToken: randomBytes(16).toString('hex'), catalogId: root.id, namespaceToken: null });
			let publicationPrimary: unknown, publicationFailed = false;
			try { await this.#anchor.settingsRepository.putIfAbsent(POINTER, pointer); } catch (error) { publicationPrimary = error; publicationFailed = true; }
			try { entry = await this.#anchor.readLibraryAnchorEntryCurrentV1(POINTER); if (!entry.present) throw new Error('Native default selection has no durable pointer.'); }
			catch (failure) { if (publicationFailed) throw new AggregateError([publicationPrimary, failure], 'Native default selection acknowledgment could not be reconciled.', { cause: failure }); throw failure; }
		}
		const pointer = readSelection(entry.value); let binding: Readonly<{ allocation: Readonly<Allocation> | null; appDataPath: string }>;
		if (pointer.namespaceToken === null) binding = Object.freeze({ allocation: null, appDataPath: this.#appDataPath });
		else {
			const history = await this.#anchor.readLibraryAnchorEntryCurrentV1(commitKey(pointer.namespaceToken)); this.#check(signal);
			if (!history.present) throw new Error('Native selected generation has no permanent installation history.');
			const commit = readCommit(history.value);
			if (JSON.stringify(commit.replacement) !== JSON.stringify(pointer)) throw new Error('Native selected pointer differs from its permanent installation history.');
			binding = await this.#registry.resume(pointer.namespaceToken, signal); const identity = this.#registry.readRestoreIdentityCurrentV1(commit.allocation);
			if (identity.registryOwner !== commit.registryOwner || identity.manifestSha256 !== commit.manifestSha256 || JSON.stringify(binding.allocation) !== JSON.stringify(commit.allocation)) throw new Error('Native selected generation differs from its actual registry and manifest.');
		}
		await this.#catalog(binding.appDataPath, async catalog => {
			const current = await catalog.readSnapshot(pointer.catalogId, { signal }); if (!current) throw new ReferenceError('Native selected catalog is missing.');
		});
		this.#check(signal); return Object.freeze({ raw: entry.value, pointer, binding });
	}
	async admitRestore(previous: Readonly<LightscaperNativePhotoLibrarySelectionSnapshotCurrentV1>, signal: AbortSignal): Promise<void> {
		await this.#assertPointer(previous, signal); const entry = await this.#anchor.readLibraryAnchorEntryCurrentV1(ACTIVE);
		if (entry.present) await this.#authenticateActive(entry.value, signal); this.#check(signal);
	}
	async stage(allocation: Readonly<Allocation>, previous: Readonly<LightscaperNativePhotoLibrarySelectionSnapshotCurrentV1>, signal: AbortSignal): Promise<void> {
		this.#check(signal); await this.#assertPointer(previous, signal);
		const identity = this.#registry.readRestoreIdentityCurrentV1(allocation), current = await this.#anchor.readLibraryAnchorEntryCurrentV1(ACTIVE); this.#check(signal);
		if (current.present) await this.#authenticateActive(current.value, signal);
		const journal = Object.freeze({ schemaVersion: 1, kind: 'native-photo-library-restore-active', allocation, previous: previous.pointer,
			registryOwner: identity.registryOwner, manifestSha256: identity.manifestSha256 });
		const saved = current.present ? await this.#anchor.settingsRepository.replaceIfCurrent(ACTIVE, current.value, journal) : await this.#anchor.settingsRepository.putIfAbsent(ACTIVE, journal);
		if (!saved) throw new Error('Native restore journal changed during allocation.');
		const actual = await this.#anchor.readLibraryAnchorEntryCurrentV1(ACTIVE);
		if (!actual.present || canonical(actual.value) !== canonical(journal)) throw new Error('Native restore journal has no exact durable reservation.');
		this.#check(signal);
	}
	async publish(ready: Readonly<Ready>, previous: Readonly<LightscaperNativePhotoLibrarySelectionSnapshotCurrentV1>, signal: AbortSignal): Promise<Readonly<LightscaperNativePhotoLibraryPublicationCurrentV1>> {
		ready.assertCurrent(); this.#check(signal); await this.#assertPointer(previous, signal);
		const identity = this.#registry.readRestoreIdentityCurrentV1(ready.allocation);
		if (identity.registryOwner !== ready.registryOwner || identity.manifestSha256 !== ready.manifestSha256) throw new Error('Native Ready generation no longer matches its durable registry.');
		const replacement = readSelection({ schemaVersion: 1, kind: 'native-photo-library-selection', selectionToken: randomBytes(16).toString('hex'), catalogId: ready.allocation.catalogId, namespaceToken: ready.allocation.namespaceToken });
		const commit = readCommit({ schemaVersion: 1, kind: 'native-photo-library-restore-commit', previous: previous.pointer, replacement,
			allocation: ready.allocation, registryOwner: ready.registryOwner, manifestSha256: ready.manifestSha256, receipt: ready.receipt });
		const key = commitKey(ready.allocation.namespaceToken); let status: 'committed' | 'reconciled' = 'committed';
		let primary: unknown, failed = false, acknowledged = false;
		try { acknowledged = await this.#anchor.publishLibrarySelectionCurrentV1(previous.raw, replacement, key, commit, () => { ready.assertCurrent(); this.#check(signal); }); }
		catch (error) { failed = true; primary = error; }
		if (!acknowledged) {
			try { const entry = await this.#anchor.readLibraryAnchorEntryCurrentV1(key);
				if (!entry.present || JSON.stringify(readCommit(entry.value)) !== JSON.stringify(commit)) throw new Error('Native selection publication has no matching permanent acknowledgment.');
				status = 'reconciled';
			} catch (failure) { if (failed) throw new AggregateError([primary, failure], 'Native selection publication could not be reconciled; generation retained.', { cause: failure }); throw failure; }
		}
		// A real pair ACK (or matching permanent history) wins later abort and
		// movement. Journal cleanup cannot retract that installation receipt.
		try { await this.clear(ready.allocation, previous); } catch { /* Protected journal retained for bounded reconciliation on the next transition. */ }
		return Object.freeze({ selectionToken: replacement.selectionToken, receipt: ready.receipt, status });
	}
	async clear(allocation: Readonly<Allocation>, previous: Readonly<LightscaperNativePhotoLibrarySelectionSnapshotCurrentV1>): Promise<void> {
		const entry = await this.#anchor.readLibraryAnchorEntryCurrentV1(ACTIVE); if (!entry.present) return;
		readActive(entry.value); const identity = this.#registry.readRestoreIdentityCurrentV1(allocation);
		const expected = { schemaVersion: 1, kind: 'native-photo-library-restore-active', allocation, previous: previous.pointer, registryOwner: identity.registryOwner, manifestSha256: identity.manifestSha256 };
		if (canonical(entry.value) !== canonical(expected)) return;
		await this.#anchor.settingsRepository.deleteIfCurrent(ACTIVE, entry.value);
	}
	async #authenticateActive(value: unknown, signal: AbortSignal): Promise<void> {
		const active = readActive(value); await this.#registry.resume(active.allocation.namespaceToken, signal);
		const actual = this.#registry.readRestoreIdentityCurrentV1(active.allocation);
		if (actual.registryOwner !== active.registryOwner || actual.manifestSha256 !== active.manifestSha256) throw new Error('Native active journal belongs to a foreign generation.');
		this.#check(signal);
	}
	async #assertPointer(previous: Readonly<LightscaperNativePhotoLibrarySelectionSnapshotCurrentV1>, signal: AbortSignal): Promise<void> {
		const actual = await this.#anchor.readLibraryAnchorEntryCurrentV1(POINTER); this.#check(signal);
		if (!actual.present || canonical(actual.value) !== canonical(previous.raw)) throw new Error('Native selected library changed during restore.');
	}
	async #catalog<Result>(appDataPath: string, run: (catalog: Catalog) => Promise<Result>): Promise<Result> {
		const owner = await openOwner(() => Catalog.open({ appDataPath }), this.#quarantine); this.#unretired.add(owner); const close = owner.close;
		let failed = false, primary: unknown, result!: Result;
		try { result = await run(owner); } catch (error) { failed = true; primary = error; }
		try { await Reflect.apply(close, owner, []); this.#unretired.delete(owner); }
		catch (cleanup) { this.#quarantine(); if (failed) throw new AggregateError([primary, cleanup], 'Native selection Catalog work and close failed.', { cause: cleanup }); throw cleanup; }
		if (failed) throw primary; return result;
	}
	#check(signal: AbortSignal): void { check(signal); this.#assert(); }
}
function readActive(value: unknown) {
	const input = record(value, 'native restore active journal', ['schemaVersion', 'kind', 'allocation', 'previous', 'registryOwner', 'manifestSha256']);
	if (field(input, 'schemaVersion', 'native restore active journal') !== 1 || field(input, 'kind', 'native restore active journal') !== 'native-photo-library-restore-active') throw new TypeError('Native restore active journal is foreign.');
	const allocation = normalizePhotoLibraryRestoreAllocationV1(field(input, 'allocation', 'native restore active journal')), previous = readSelection(field(input, 'previous', 'native restore active journal'));
	const owner = field(input, 'registryOwner', 'native restore active journal'), digest = field(input, 'manifestSha256', 'native restore active journal');
	if (typeof owner !== 'string' || !/^[a-f0-9]{32}$/u.test(owner) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/u.test(digest)) throw new TypeError('Native restore journal identity is invalid.');
	return Object.freeze({ allocation, previous, registryOwner: owner, manifestSha256: digest });
}
