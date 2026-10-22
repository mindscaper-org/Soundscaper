/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { LightscaperNativeCatalogStoreCurrentV1 as Catalog } from '../desktop/lightscaper-native-catalog-store-current-v1.ts';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from '../desktop/lightscaper-native-photo-settings-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { fixture, test } from './helpers/lightscaper-native-restore-claim-fixture-current.ts';
void test('Native missing selection pointer protects an already occupied default Catalog instead of minting a replacement root', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'preselection-existing', name: 'Retained existing Catalog', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
		const catalog = await Catalog.open({ appDataPath: f.directory }); try { await catalog.createCatalog(root); } finally { await catalog.close(); }
		const method: unknown = Reflect.get(f.scopes, 'openSelected'); assert.equal(typeof method, 'function');
		await assert.rejects(Reflect.apply(method as (options: Readonly<{ name: string }>) => Promise<unknown>, f.scopes, [{ name: 'Must not replace' }]));
		const anchor = await Settings.open({ appDataPath: f.directory, scope: 'anchor' });
		try { assert.deepEqual(await anchor.settingsRepository.readEntry('photo-library:native-selected-v1'), { present: false }); } finally { await anchor.close(); }
		const db = new DatabaseSync(join(f.directory, 'Lightscaper', 'project-library', 'v1', 'native-photo-catalogs.sqlite3'), { readOnly: true });
		try { assert.equal(db.prepare('SELECT COUNT(*) AS count FROM native_photo_catalogs').get()?.count, 1); assert.equal(db.prepare('SELECT id FROM native_photo_catalogs').get()?.id, root.id); } finally { db.close(); }
	});
});
