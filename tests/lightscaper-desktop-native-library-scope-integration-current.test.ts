/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import test from 'node:test';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from '../desktop/lightscaper-native-photo-settings-current-v1.ts';
import { deriveLightscaperNativeCatalogPathsCurrentV1 as catalogPaths } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as mediaPaths } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import { deriveLightscaperNativePhotoResourcePathsCurrentV1 as resourcePaths } from '../desktop/lightscaper-native-photo-resources-database-current-v1.ts';
import { deriveLightscaperNativePhotoSettingsPathsCurrentV1 as settingPaths } from '../desktop/lightscaper-native-photo-settings-database-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { nativeScopeIntegrationFixtureCurrentV1 as fixture, scopePhotoCurrentV1 as input, scopeCatalogRootCurrentV1 as root,
	scopeAppDataCurrentV1 as appData, scopeOriginalReferenceCurrentV1 as reference, readScopeOriginalCurrentV1 as read,
	scopeResourceBundleCurrentV1 as bundle, installScopeResourceBundleCurrentV1 as install, scopeResourcePhotoCurrentV1 as fullPhoto,
	SCOPE_CATALOG_CURRENT_V1 as CATALOG, type ComponentsCurrentV1 as Components } from './helpers/lightscaper-native-library-scope-integration-fixture-current.ts';

async function publish(components: Components, orientation: 1 | 3 | 6, label: string) {
	const value = input(orientation); await components.catalog.createCatalog(root());
	await components.media.writeAsset(value.photo.original.storageKey, value.blob, { name: value.photo.original.name, mimeType: value.photo.original.mimeType });
	await components.catalog.publishPhotos(CATALOG, 0, [value.photo]); await components.media.catalogOriginals.retain(CATALOG, [reference(value.photo.original, value.photo.id)]);
	await components.settings.settingsRepository.put('same-settings-key', { label }); return value;
}

test('Lightscaper two native generations and default physically isolate same catalog Photo asset and settings keys with real different bytes', async () => {
	await fixture(async f => {
		const defaultScope = await f.scopes.openDefault(), a = await f.scopes.allocate(CATALOG), b = await f.scopes.allocate(CATALOG);
		assert.equal(f.scopes.describe(defaultScope), null); const allocationA = f.scopes.describe(a), allocationB = f.scopes.describe(b); assert.ok(allocationA && allocationB);
		assert.notEqual(allocationA.namespaceToken, allocationB.namespaceToken);
		const defaults = await f.scopes.openComponents(defaultScope), first = await f.scopes.openComponents(a), second = await f.scopes.openComponents(b);
		const values = [await publish(defaults, 6, 'default'), await publish(first, 1, 'first'), await publish(second, 3, 'second')];
		assert.equal(new Set(values.map(value => value.photo.original.contentSha256)).size, 3);
		for (const [index, components] of [defaults, first, second].entries()) {
			assert.deepEqual(await components.catalog.loadPhoto(CATALOG, 'photo-1'), values[index]!.photo);
			assert.deepEqual(await read(components.media, values[index]!.photo.original), values[index]!.bytes);
			assert.deepEqual(await components.settings.settingsRepository.get('same-settings-key'), { label: ['default', 'first', 'second'][index] });
			assert.equal((await components.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: null })).roots.length, 1);
		}
		const roots = [f.directory, appData(f.directory, allocationA.namespaceToken), appData(f.directory, allocationB.namespaceToken)];
		for (const derive of [catalogPaths, mediaPaths, resourcePaths, settingPaths]) {
			const actual = await Promise.all(roots.map(async directory => realpath(derive(directory).databasePath))); assert.equal(new Set(actual).size, 3);
		}
		await f.scopes.close(); const reopened = await f.reopen(), resumedA = await reopened.resume(allocationA.namespaceToken), resumedB = await reopened.resume(allocationB.namespaceToken);
		const restoredA = await reopened.openComponents(resumedA), restoredB = await reopened.openComponents(resumedB);
		assert.deepEqual(await read(restoredA.media, values[1]!.photo.original), values[1]!.bytes); assert.deepEqual(await read(restoredB.media, values[2]!.photo.original), values[2]!.bytes);
		assert.deepEqual(await restoredA.settings.settingsRepository.get('same-settings-key'), { label: 'first' });
		assert.deepEqual(await restoredB.settings.settingsRepository.get('same-settings-key'), { label: 'second' });
	});
});

test('Lightscaper scoped selected settings never inherit true fixed anchor values or its atomic publication capability', async () => {
	await fixture(async f => {
		const anchor = await Settings.open({ appDataPath: f.directory, scope: 'anchor' });
		try {
			await anchor.settingsRepository.put('anchor-only', 'actual fixed anchor');
			const defaults = await f.scopes.openComponents(await f.scopes.openDefault()), generation = await f.scopes.openComponents(await f.scopes.allocate(CATALOG));
			for (const components of [defaults, generation]) {
				assert.deepEqual(await components.settings.settingsRepository.readEntry('anchor-only'), { present: false });
				await components.settings.settingsRepository.put('anchor-only', 'selected only');
				await assert.rejects(components.settings.settingsRepository.replaceIfCurrentAndPutIfAbsent('anchor-only', 'selected only', 'changed', 'history', {}, () => undefined));
			}
			assert.equal(await anchor.settingsRepository.get('anchor-only'), 'actual fixed anchor');
			assert.deepEqual(await anchor.settingsRepository.readEntry('history'), { present: false });
		} finally { await anchor.close(); }
	});
});

test('Lightscaper same native LUT and brush keys require independent actual installation in each generation', async () => {
	await fixture(async f => {
		const a = await f.scopes.openComponents(await f.scopes.allocate(CATALOG)), b = await f.scopes.openComponents(await f.scopes.allocate(CATALOG)), resource = await bundle(31);
		await install(a.resources, resource); const lutA = await a.resources.cubeLutResources(), lutB = await b.resources.cubeLutResources();
		const brushA = await a.resources.maskRasterResources(), brushB = await b.resources.maskRasterResources();
		await lutA.source.withBytes(resource.lut.reference, bytes => { assert.deepEqual(bytes, resource.lut.bytes); });
		await assert.rejects(lutB.source.withBytes(resource.lut.reference, () => { assert.fail('Uninstalled generation must not read another scope LUT.'); }));
		await brushA.source.withBytes(resource.brushes[0]!.reference, bytes => { assert.deepEqual(bytes, resource.brushes[0]!.bytes); });
		await assert.rejects(brushB.source.withBytes(resource.brushes[0]!.reference, () => { assert.fail('Uninstalled generation must not read another scope brush.'); }));
		await install(b.resources, resource); await lutB.source.withBytes(resource.lut.reference, bytes => { assert.deepEqual(bytes, resource.lut.bytes); });
		await brushB.source.withBytes(resource.brushes[0]!.reference, bytes => { assert.deepEqual(bytes, resource.brushes[0]!.bytes); });
	});
});

test('Lightscaper native scope catalog verifier authenticates the complete Current retained closure through its own resource owner', async () => {
	await fixture(async f => {
		const a = await f.scopes.openComponents(await f.scopes.allocate(CATALOG)), b = await f.scopes.openComponents(await f.scopes.allocate(CATALOG));
		const resources = await Promise.all(Array.from({ length: 6 }, (_, index) => bundle(index + 40))), first = input(1), second = input(3);
		const make = (value: ReturnType<typeof input>) => normalizePhotoDocumentCurrentV1({ ...fullPhoto(resources), id: value.photo.id,
			original: value.photo.original, metadata: value.photo.metadata });
		for (const [components, value] of [[a, first], [b, second]] as const) {
			await components.catalog.createCatalog(root()); await components.media.writeAsset(value.photo.original.storageKey, value.blob,
				{ name: value.photo.original.name, mimeType: value.photo.original.mimeType });
		}
		for (const resource of resources) await install(a.resources, resource); await a.catalog.publishPhotos(CATALOG, 0, [make(first)]);
		await assert.rejects(b.catalog.publishPhotos(CATALOG, 0, [make(second)])); assert.equal(await b.catalog.loadPhoto(CATALOG, second.photo.id), null);
		for (const resource of resources) await install(b.resources, resource); await b.catalog.publishPhotos(CATALOG, 0, [make(second)]);
		assert.deepEqual(await a.catalog.loadPhoto(CATALOG, first.photo.id), make(first)); assert.deepEqual(await b.catalog.loadPhoto(CATALOG, second.photo.id), make(second));
	});
});
