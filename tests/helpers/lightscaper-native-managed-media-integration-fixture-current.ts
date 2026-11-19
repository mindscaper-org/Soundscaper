/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { locks } from 'node:worker_threads';
import { LightscaperNativePhotoMediaCurrentV1 as Media } from '../../desktop/lightscaper-native-photo-media-current-v1.ts';
import { LightscaperNativeCatalogStoreCurrentV1 as Catalog } from '../../desktop/lightscaper-native-catalog-store-current-v1.ts';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from '../../desktop/lightscaper-native-photo-settings-current-v1.ts';
import { LightscaperNativePhotoResourcesCurrentV1 as Resources } from '../../desktop/lightscaper-native-photo-resources-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 } from '../../desktop/lightscaper-native-original-index-current-v1.ts';
import { deriveLightscaperNativePhotoResourcePathsCurrentV1 } from '../../desktop/lightscaper-native-photo-resources-database-current-v1.ts';
import { verifyPhotoResourcesCurrentV1 } from '../../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import type { PhotoManagedImportPortsCurrentV1 } from '../../src/lightscaper/import/managed-import-ports-current-v1.ts';
import type { PhotoOriginalV1 } from '../../src/lightscaper/catalog/types.ts';
import { normalizePhotoImportIntentV1, photoImportIntentKeyV1 } from '../../src/lightscaper/import/import-intent-v1.ts';
import { nativeResourceRootCurrentV1 } from './lightscaper-native-photo-resources-integration-fixture-current.ts';

export const MANAGED_MEDIA_CATALOG_CURRENT_V1 = 'catalog-1';
export interface ManagedMediaIntegrationOwnersCurrentV1 {
	readonly media: Media; readonly catalog: Catalog; readonly settings: Settings; readonly resources: Resources;
	readonly ports: Readonly<PhotoManagedImportPortsCurrentV1>;
	close(): Promise<void>;
}

export interface ManagedMediaIntegrationFixtureCurrentV1 extends ManagedMediaIntegrationOwnersCurrentV1 {
	readonly appDataPath: string; readonly originalDatabasePath: string; readonly resourceDatabasePath: string;
	reopen(): Promise<ManagedMediaIntegrationOwnersCurrentV1>;
}

/** This is a genuine Node LockManager lease held until the real importer
 * settles. It qualifies process-local ownership, not a cross-process native
 * selected-library lease or complete Session activation. */
const exclusive: NonNullable<PhotoManagedImportPortsCurrentV1['exclusive']> = async (catalogId, run, signal) => {
	signal?.throwIfAborted();
	// Node converts rejections escaping a native lock callback. Keep opaque
	// task errors inside an inert outcome until the real lease has released.
	const outcome = await locks.request(`lightscaper-photo-catalog:${catalogId}`, { mode: 'exclusive', ...(signal ? { signal } : {}) }, async lock => {
		try { assert.ok(lock); signal?.throwIfAborted(); return { okay: true as const, value: await run(signal) }; }
		catch (error) { return { okay: false as const, error }; }
	});
	if (!outcome.okay) throw outcome.error;
	return outcome.value;
};

export async function managedMediaIntegrationFixtureCurrentV1(run: (fixture: ManagedMediaIntegrationFixtureCurrentV1) => Promise<void>): Promise<void> {
	const appDataPath = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper-managed-media-integration-')));
	const owners: Array<{ close(): Promise<void> }> = [];
	let failed = false, primary: unknown;
	async function reopen(): Promise<ManagedMediaIntegrationOwnersCurrentV1> {
		const resources = await Resources.open({ appDataPath }); owners.push(resources);
		const media = await Media.open({ appDataPath }); owners.push(media);
		const settings = await Settings.open({ appDataPath, scope: 'selected:managed-media-integration' }); owners.push(settings);
		const catalog = await Catalog.open({ appDataPath, verifyResources: (photo, signal) => verifyPhotoResourcesCurrentV1(photo, resources, signal) }); owners.push(catalog);
		if (!await catalog.loadCatalog(MANAGED_MEDIA_CATALOG_CURRENT_V1)) await catalog.createCatalog(nativeResourceRootCurrentV1());
		const ports: Readonly<PhotoManagedImportPortsCurrentV1> = Object.freeze<PhotoManagedImportPortsCurrentV1>({ catalog,
			media: Object.freeze({ writeAsset: media.writeAsset, custody: media.catalogOriginals }), journal: settings.settingsRepository,
			verifyResources: (photo, signal) => verifyPhotoResourcesCurrentV1(photo, resources, signal), exclusive });
		let closing: Promise<void> | undefined;
		return { resources, media, settings, catalog, ports, close() {
			closing ??= (async () => {
				const errors: unknown[] = [];
				for (const owner of [media, catalog, settings, resources]) { try { await owner.close(); } catch (error) { errors.push(error); } }
				if (errors.length) throw new AggregateError(errors, 'Managed media integration owners did not retire.');
			})(); return closing;
		} };
	}
	try {
		const active = await reopen();
		await run({ ...active, appDataPath, reopen,
			originalDatabasePath: deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataPath).databasePath,
			resourceDatabasePath: deriveLightscaperNativePhotoResourcePathsCurrentV1(appDataPath).databasePath });
	} catch (error) { failed = true; primary = error; }
	const errors: unknown[] = [];
	// Catalog verification may borrow resources; close all catalog/media work
	// before resources, and independently attempt every actual retirement.
	for (const owner of [...owners].reverse()) { try { await owner.close(); } catch (error) { errors.push(error); } }
	if (errors.length) throw new AggregateError([...(failed ? [primary] : []), ...errors], 'Managed media integration cleanup failed; files retained.');
	await rm(appDataPath, { recursive: true, force: false });
	if (failed) throw primary;
}

export async function managedMediaIntegrationIntentCurrentV1(owner: ManagedMediaIntegrationOwnersCurrentV1, importId: string): Promise<void> {
	const value = normalizePhotoImportIntentV1({ schemaVersion: 1, kind: 'photo-import', catalogId: MANAGED_MEDIA_CATALOG_CURRENT_V1, importId }, MANAGED_MEDIA_CATALOG_CURRENT_V1);
	assert.equal(await owner.settings.settingsRepository.putIfAbsent(photoImportIntentKeyV1(MANAGED_MEDIA_CATALOG_CURRENT_V1), value), true);
}

export function managedMediaIntegrationReferenceCurrentV1(original: Readonly<PhotoOriginalV1>, photoId: string) {
	return { photoId, sourceId: original.id, assetId: original.storageKey, sha256: original.contentSha256!, size: original.byteLength };
}

export async function managedMediaIntegrationReadCurrentV1(media: Media, original: Readonly<PhotoOriginalV1>): Promise<Uint8Array> {
	const bytes = new Uint8Array(original.byteLength);
	for (let offset = 0; offset < bytes.length;) {
		const length = Math.min(1024 * 1024, bytes.length - offset), part = await media.readOriginal(original, offset, length);
		assert.equal(part.byteLength, length); bytes.set(part, offset); offset += length;
	}
	return bytes;
}

export async function observeManagedMediaIntegrationCommitCurrentV1<Result>(databasePath: string,
	after: (database: DatabaseSync) => void, run: () => Promise<Result>): Promise<Result> {
	const exec = DatabaseSync.prototype.exec, prepare = DatabaseSync.prototype.prepare;
	DatabaseSync.prototype.exec = function (sql: string): void {
		exec.call(this, sql);
		if (!/^COMMIT;?$/iu.test(sql.trim())) return;
		const row = prepare.call(this, 'PRAGMA database_list').get();
		if (typeof row?.file === 'string' && resolve(row.file) === resolve(databasePath)) after(this);
	};
	try { return await run(); } finally { DatabaseSync.prototype.exec = exec; }
}

export async function managedMediaIntegrationExactFailureCurrentV1(work: Promise<unknown>, expected: unknown): Promise<void> {
	let rejected = false;
	await work.then(() => undefined, (reason: unknown) => { rejected = true; assert.equal(reason, expected); }); assert.equal(rejected, true);
}
