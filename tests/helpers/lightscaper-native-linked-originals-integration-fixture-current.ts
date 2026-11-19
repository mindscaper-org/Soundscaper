/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { TestContext } from 'node:test';
import { LightscaperNativePhotoLinkedOriginalsCurrentV1 as Linked } from '../../desktop/lightscaper-native-photo-linked-originals-current-v1.ts';
import { withLightscaperNativePhotoLinkedInputCurrentV1 as withInput,
	type LightscaperNativePhotoLinkedInputCurrentV1 as Input } from '../../desktop/lightscaper-native-photo-linked-input-current-v1.ts';
import { LightscaperNativePhotoMediaCurrentV1 as Media } from '../../desktop/lightscaper-native-photo-media-current-v1.ts';
import { LightscaperNativeCatalogStoreCurrentV1 as Catalog } from '../../desktop/lightscaper-native-catalog-store-current-v1.ts';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from '../../desktop/lightscaper-native-photo-settings-current-v1.ts';
import { LightscaperNativePhotoResourcesCurrentV1 as Resources } from '../../desktop/lightscaper-native-photo-resources-current-v1.ts';
import { LightscaperNativePhotoOriginalsCurrentV1 as Originals } from '../../desktop/lightscaper-native-photo-originals-current-v1.ts';
import { LightscaperNativePhotoOriginalTicketsCurrentV1 as Tickets } from '../../desktop/lightscaper-native-photo-original-tickets-current-v1.ts';
import { readDesktopPhotoOriginalTicketCurrentV1 as ticket } from '../../src/lightscaper/desktop-photo-original-contract-current-v1.ts';
import { readDesktopPhotoOriginalGroupTicketCurrentV1 as group } from '../../src/lightscaper/desktop-photo-original-group-contract-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { verifyPhotoResourcesCurrentV1 } from '../../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { photoImportIntentKeyV1, normalizePhotoImportIntentV1 } from '../../src/lightscaper/import/import-intent-v1.ts';
import { linkedGrantsFixtureCurrentV1, grantAuthorizeCurrentV1, grantedFsPathCurrentV1 as path,
	grantedFsHashCurrentV1 as hash, LINKED_GRANT_TEST_OPTIONS_CURRENT_V1 as options, GRANTED_FS_OP, remainsPending } from './lightscaper-native-linked-grants-integration-fixture-current.ts';
import { scopePhotoCurrentV1, scopeCatalogRootCurrentV1, scopeOriginalReferenceCurrentV1 as reference,
	scopeResourceBundleCurrentV1, installScopeResourceBundleCurrentV1, scopeResourcePhotoCurrentV1 } from './lightscaper-native-library-scope-integration-fixture-current.ts';
export { Linked, withInput, Media, Catalog, path, hash, options, GRANTED_FS_OP, remainsPending, ticket, group, normalizePhotoDocumentCurrentV1, reference };
export const CATALOG = 'catalog-1', IMPORT = 'linked-import';
type GrantFixture = Parameters<Parameters<typeof linkedGrantsFixtureCurrentV1>[1]>[0];
type Photo = ReturnType<typeof normalizePhotoDocumentCurrentV1>;
export type Entry = Readonly<{ input: Input; photo: Photo; bytes: Uint8Array<ArrayBuffer>; file: string }>;

/** Actual native role, grants, Catalog, resources, metadata/custody and Tickets.
 * No positive body/resource verifier, decoder receipt or File is fabricated. */
export async function linkedOriginalsFixtureCurrentV1(context: TestContext,
	run: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>): Promise<void> {
	await linkedGrantsFixtureCurrentV1(context, async grants => {
		const f = await createFixture(grants); let failed = false, primary: unknown;
		try { await run(f); } catch (error) { failed = true; primary = error; }
		try { await f.close(); } catch (cleanup) { throw new AggregateError([...(failed ? [primary] : []), cleanup], 'Linked integration did not retire actual native owners.', { cause: cleanup }); }
		if (failed) throw primary;
	});
}
async function createFixture(base: GrantFixture) {
	const grants = await base.open(), grant = await grantAuthorizeCurrentV1(grants), inputs = new Set<Input>();
	const children: Array<Readonly<{ close(): Promise<void> }>> = []; let graph: Awaited<ReturnType<typeof openGraph>>;
	let count = 0, closing: Promise<void> | undefined;
	const own = <Value extends Readonly<{ close(): Promise<void> }>>(owner: Value): Value => { children.push(owner); return owner; };
	async function retire(): Promise<void> {
		base.release(); const failures: unknown[] = [];
		for (const input of inputs) { try { await input.close(); } catch (error) { failures.push(error); } }
		for (const child of children.slice().reverse()) { try { await child.close(); } catch (error) { failures.push(error); } }
		if (failures.length) throw new AggregateError(failures, 'Actual linked children did not retire; fixture retained.', { cause: failures[0] });
		children.length = 0; inputs.clear();
	}
	async function openGraph() {
		const media = own(await Media.open({ appDataPath: base.appDataPath }));
		const linked = own(await Linked.open({ appDataPath: base.appDataPath, grants, scope: base.scope, unretired: () => { throw new Error('Unexpected linked retirement quarantine.'); } }));
		media.bindLinkedOriginalsCurrentV1(linked);
		const resources = own(await Resources.open({ appDataPath: base.appDataPath }));
		const settings = own(await Settings.open({ appDataPath: base.appDataPath, scope: 'selected:library' }));
		await resources.cubeLutResources(); await resources.maskRasterResources();
		const catalog = own(await Catalog.open({ appDataPath: base.appDataPath, linkedOriginals: linked,
			verifyResources: (photo, signal) => verifyPhotoResourcesCurrentV1(photo, resources, signal) }));
		if (await catalog.loadCatalog(CATALOG) === null) await catalog.createCatalog(scopeCatalogRootCurrentV1());
		const originals = own(Originals.create({ catalog, media, settings, scope: base.scope }));
		const tickets = own(Tickets.create({ originals, scope: base.scope, unretired: () => { throw new Error('Unexpected linked ticket quarantine.'); } }));
		return { media, linked, resources, settings, catalog, originals, tickets };
	}
	try { graph = await openGraph(); }
	catch (primary) { try { await retire(); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Linked fixture opening and cleanup failed.', { cause: cleanup }); } throw primary; }
	return {
		...base, grants, grant, inputs,
		get linked() { return graph.linked; }, get media() { return graph.media; }, get catalog() { return graph.catalog; },
		get originals() { return graph.originals; }, get tickets() { return graph.tickets; }, get settings() { return graph.settings; }, get resources() { return graph.resources; },
		peer(): DatabaseSync { return new DatabaseSync(base.mediaDatabasePath, { allowExtension: false, enableDoubleQuotedStringLiterals: false, timeout: 50 }); },
		async reopen(): Promise<void> { await retire(); graph = await openGraph(); },
		async prepare(name = `linked-${++count}.dng`, bytes = scopePhotoCurrentV1().bytes): Promise<Entry> {
			const file = join(base.rootPath, name); await writeFile(file, bytes);
			const input = await graph.linked.prepareInput(grant.grantId, [path(name)]); inputs.add(input);
			const seed = scopePhotoCurrentV1().photo;
			const photo = normalizePhotoDocumentCurrentV1({ ...seed, id: `linked-photo-${++count}`, original: { ...seed.original,
				id: `linked-source-${count}`, name, storageKey: input.facts.sourceId, retention: 'linked', contentSha256: hash(bytes), byteLength: bytes.byteLength },
				metadata: { ...seed.metadata, fileName: name, modifiedTime: null } });
			return { input, photo, bytes, file };
		},
		async rich(entry: Entry): Promise<Entry> {
			const bundles = await Promise.all(Array.from({ length: 6 }, (_, index) => scopeResourceBundleCurrentV1(index)));
			for (const bundle of bundles) await installScopeResourceBundleCurrentV1(graph.resources, bundle);
			const rich = scopeResourcePhotoCurrentV1(bundles);
			return { ...entry, photo: normalizePhotoDocumentCurrentV1({ ...rich, id: entry.photo.id, original: entry.photo.original, metadata: entry.photo.metadata }) };
		},
		async publish(entry: Entry, promote = true): Promise<Record<string, unknown>> {
			const photo = entry.photo, intent = normalizePhotoImportIntentV1({ schemaVersion: 1, kind: 'photo-import', catalogId: CATALOG, importId: IMPORT }, CATALOG);
			await graph.settings.settingsRepository.put(photoImportIntentKeyV1(CATALOG), intent);
			const result = await graph.linked.publishInput(entry.input, { catalogId: CATALOG, importId: IMPORT, photoId: photo.id,
				original: photo.original, metadata: { name: photo.original.name, mimeType: photo.original.mimeType, privateNote: 'detached descriptive field' } });
			const root = await graph.catalog.loadCatalog(CATALOG); assert.ok(root);
			await graph.catalog.publishPhotos(CATALOG, root.revision, [photo]);
			if (promote) await graph.media.catalogOriginals.promote(CATALOG, IMPORT, [photo.id]);
			await entry.input.close(); return result;
		},
		request(entry: Entry) { return Object.freeze({ catalogId: CATALOG, photoId: entry.photo.id, original: entry.photo.original }); },
		binding(entry: Entry) { const o = entry.photo.original; return { catalogId: CATALOG, importId: null, photoId: entry.photo.id,
			assetId: o.storageKey, sourceId: o.id, sha256: o.contentSha256!, size: o.byteLength, name: o.name, mimeType: o.mimeType }; },
		close(): Promise<void> { closing ??= retire(); return closing; },
	};
}
export function linkedCountsCurrentV1(db: DatabaseSync): readonly number[] {
	return ['native_photo_linked_original_bindings','native_photo_media_identities','native_photo_media_assets','native_photo_media_roots','native_photo_original_bindings']
		.map(table => { const row = db.prepare(`SELECT count(*) AS n FROM ${table}`).get(); assert.ok(row && typeof row.n === 'number'); return row.n; });
}
export function linkedBytesCurrentV1(value: unknown): Uint8Array {
	assert.ok(value instanceof Uint8Array, 'Actual native transport must deliver bounded Uint8Array bytes.'); return value;
}
export async function linkedExactFailureCurrentV1(work: Promise<unknown>, reason: unknown): Promise<void> {
	let failed = false; await work.then(() => undefined, error => { failed = true; assert.equal(Object.is(error, reason), true); }); assert.equal(failed, true);
}
