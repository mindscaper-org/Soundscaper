/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { link, lstat, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LightscaperNativeCatalogStoreCurrentV1 as Store } from '../desktop/lightscaper-native-catalog-store-current-v1.ts';
import { deriveLightscaperNativeCatalogPathsCurrentV1 } from '../desktop/lightscaper-native-catalog-database-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1, lightscaperNativePhotoOriginalBodyPathCurrentV1 } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import { prepareLightscaperNativeOriginalStorageCurrentV1 } from '../desktop/lightscaper-native-original-files-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const root = () => normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
	id: 'catalog-1', name: 'Native library', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
const photo = (index = 1) => normalizePhotoDocumentCurrentV1({ ...photoArchiveFixture(index).photo, schemaVersion: 3 });
async function* bytes() { yield Uint8Array.of(1, 2, 3); }
async function fixture(run: (directory: string) => Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native owner ü ')));
	// A failed retirement retains diagnostics until the outer process has joined.
	await run(directory); await rm(directory, { recursive: true, force: false });
}

test('Lightscaper native catalog owner persists selected photos and immutable bytes through actual close/reopen', async () => {
	await fixture(async directory => {
		let store = await Store.open({ appDataPath: directory });
		try {
			assert.equal(await store.loadCatalog(root().id), null); await store.createCatalog(root());
			const value = photo(); await store.storeOriginal(value.original, bytes());
			const published = await store.publishPhotos(root().id, 0, [value]); assert.equal(published.photoCount, 1);
			const saved = await store.savePhoto({ ...value, rating: 5 }, 0); assert.equal(saved.revision, 1);
			assert.equal((await store.readSnapshot(root().id))?.indexRevision, 2);
			assert.deepEqual((await store.readSummaryPage(root().id)).items.map(item => item.photoId), [value.id]);
			assert.deepEqual(await store.readOriginal(root().id, value.id, 0, 3), Uint8Array.of(1, 2, 3));
			await assert.rejects(store.readOriginal(root().id, 'missing', 0, 3), ReferenceError);
			await assert.rejects(store.readOriginal('foreign', value.id, 0, 3), ReferenceError);
			await store.close(); store = await Store.open({ appDataPath: directory });
			assert.deepEqual(await store.loadCatalog(root().id), published); assert.deepEqual(await store.loadPhoto(root().id, value.id), saved);
			assert.deepEqual(await store.readOriginal(root().id, value.id, 1, 2), Uint8Array.of(2, 3));
			if (process.platform !== 'win32') assert.equal((await lstat(deriveLightscaperNativeCatalogPathsCurrentV1(directory).databasePath)).mode & 0o777, 0o600);
		} finally { await store.close(); }
	});
});

test('Lightscaper native owner refuses unretained imports while metadata edits tolerate an unavailable Original', async () => {
	await fixture(async directory => {
		const store = await Store.open({ appDataPath: directory });
		try {
			await store.createCatalog(root()); const value = photo();
			await assert.rejects(store.publishPhotos(root().id, 0, [value]));
			assert.equal((await store.loadCatalog(root().id))?.photoCount, 0);
			await store.storeOriginal(value.original, bytes()); await store.publishPhotos(root().id, 0, [value]);
			const paths = deriveLightscaperNativePhotoOriginalPathsCurrentV1(directory);
			await rm(lightscaperNativePhotoOriginalBodyPathCurrentV1(paths, value.original.contentSha256));
			assert.equal((await store.savePhoto({ ...value, rating: 4 }, 0)).rating, 4);
			await assert.rejects(store.readOriginal(root().id, value.id, 0, 1));
		} finally { await store.close(); }
	});
});

test('Lightscaper native owner preserves the captured verification callback and its options receiver', async () => {
	await fixture(async directory => {
		let calls = 0;
		const options = { appDataPath: directory, async verifyResources(this: unknown) { assert.equal(this, options); calls++; } };
		const store = await Store.open(options);
		try {
			options.verifyResources = async () => assert.fail('Borrowed callback changed after opening.');
			const value = photo(); await store.createCatalog(root()); await store.storeOriginal(value.original, bytes());
			await store.publishPhotos(root().id, 0, [value]); assert.equal(calls, 1);
		} finally { await store.close(); }
	});
});

test('Lightscaper native owner captures queued metadata and page filters before an upload can yield', async () => {
	await fixture(async directory => {
		const store = await Store.open({ appDataPath: directory }), entered = deferred<void>(), release = deferred<void>();
		try {
			const value = photo();
			const upload = store.storeOriginal(value.original, (async function* () { entered.resolve(); await release.promise; yield Uint8Array.of(1, 2, 3); })());
			await entered.promise;
			const borrowedRoot = { ...root() }, borrowedPhoto = structuredClone(value);
			const create = store.createCatalog(borrowedRoot), publish = store.publishPhotos(root().id, 0, [borrowedPhoto]);
			const filter = { kind: 'rating' as const, value: 0 }, page = store.readSummaryPage(root().id, { filter });
			borrowedRoot.name = 'Changed later'; Reflect.set(borrowedPhoto.metadata, 'title', 'Changed later'); filter.value = 5;
			release.resolve(); await upload; await create; await publish;
			assert.equal((await store.loadCatalog(root().id))?.name, root().name);
			assert.deepEqual(await store.loadPhoto(root().id, value.id), value); assert.equal((await page).items.length, 1);
		} finally { release.resolve(); await store.close(); }
	});
});

test('Lightscaper native close joins held verification and cancellation before releasing either database', async () => {
	await fixture(async directory => {
		const entered = deferred<void>(), release = deferred<void>(), cancel = new AbortController(); let store: Store | undefined;
		try {
			store = await Store.open({ appDataPath: directory, verifyResources: async () => { entered.resolve(); await release.promise; } });
			const value = photo(); await store.storeOriginal(value.original, bytes()); await store.createCatalog(root());
			const publish = store.publishPhotos(root().id, 0, [value], { signal: cancel.signal });
			await Promise.race([entered.promise, publish.then(() => { throw new Error('Provided verifier was skipped.'); })]);
			cancel.abort(); const close = store.close(); assert.equal(store.close(), close);
			assert.equal(await remainsPending(publish), true); assert.equal(await remainsPending(close), true);
			await assert.rejects(store.loadCatalog(root().id), { code: 'CATALOG_CLOSED' });
			release.resolve(); await assert.rejects(publish, { name: 'AbortError' }); await close;
			store = await Store.open({ appDataPath: directory }); assert.equal((await store.loadCatalog(root().id))?.photoCount, 0);
		} finally { release.resolve(); await store?.close(); }
	});
});

test('Lightscaper native owner registers a request before borrowed validation can request close', async () => {
	await fixture(async directory => {
		const store = await Store.open({ appDataPath: directory }); let close: Promise<void> | undefined, trapped = false;
		const borrowed = new Proxy(root(), { ownKeys(target) { if (!trapped) { trapped = true; close = store.close(); } return Reflect.ownKeys(target); } });
		try {
			const creation = store.createCatalog(borrowed); assert.equal(trapped, true);
			await creation; await close; const reopened = await Store.open({ appDataPath: directory });
			try { assert.deepEqual(await reopened.loadCatalog(root().id), root()); } finally { await reopened.close(); }
		} finally { await store.close(); }
	});
});

test('Lightscaper native owners recheck derived sources and root revisions across actual independent WAL connections', async () => {
	await fixture(async directory => {
		const entered = deferred<void>(), release = deferred<void>();
		const first = await Store.open({ appDataPath: directory, verifyResources: async value => {
			if (value.id === 'photo-3') { entered.resolve(); await release.promise; }
		} });
		let second: Store | undefined;
		try {
			const sources = [photo(1), photo(2)], result = photo(3);
			await first.createCatalog(root()); for (const value of [...sources, result]) await first.storeOriginal(value.original, bytes());
			const published = await first.publishPhotos(root().id, 0, sources); second = await Store.open({ appDataPath: directory });
			const selections = sources.map(value => ({ photoId: value.id, revision: value.revision, original: value.original }));
			const work = first.publishDerivedPhotoCurrentV1(root().id, 1, selections, result);
			await Promise.race([entered.promise, work.then(() => { throw new Error('Derived verifier was skipped.'); })]);
			const changed = await second.savePhoto({ ...sources[0]!, rating: 4 }, 0); release.resolve();
			await assert.rejects(work, { code: 'PHOTO_REVISION_CONFLICT' }); assert.equal(await second.loadPhoto(root().id, result.id), null);
			const fresh = selections.map(value => ({ ...value, revision: value.photoId === changed.id ? changed.revision : value.revision }));
			const derived = await first.publishDerivedPhotoCurrentV1(root().id, 1, fresh, result); assert.equal(derived.photoCount, 3);
			await assert.rejects(second.saveCatalog({ ...published, name: 'Stale' }, 1), { code: 'CATALOG_REVISION_CONFLICT' });
			const renamed = await second.saveCatalog({ ...derived, name: 'Renamed' }, 2); assert.equal(renamed.revision, 3);
			assert.deepEqual(await first.loadCatalog(root().id), renamed);
		} finally { release.resolve(); await first.close(); await second?.close(); }
	});
});

test('Lightscaper native owner rejects borrowed accessors without invoking them and keeps failed admission joined', async () => {
	await fixture(async directory => {
		const store = await Store.open({ appDataPath: directory }); let invoked = 0;
		try {
			await assert.rejects(store.createCatalog({ ...root(), get name() { invoked++; return 'Getter'; } }));
			await assert.rejects(store.readSnapshot(root().id, { get signal() { invoked++; return new AbortController().signal; } }));
			assert.equal(invoked, 0); await store.createCatalog(root()); assert.deepEqual(await store.loadCatalog(root().id), root());
		} finally { await store.close(); }
	});
});

test('Lightscaper native owner refuses foreign catalog bytes and aliased database sidecars before SQLite can modify them', async () => {
	await fixture(async directory => {
		await prepareLightscaperNativeOriginalStorageCurrentV1(directory);
		const path = deriveLightscaperNativeCatalogPathsCurrentV1(directory).databasePath;
		const foreign = new DatabaseSync(path); foreign.exec('PRAGMA application_id=123; CREATE TABLE foreign_owner (id TEXT)'); foreign.close();
		const before = await readFile(path); await assert.rejects(Store.open({ appDataPath: directory })); assert.deepEqual(await readFile(path), before);
		await rm(path);
		const seed = new DatabaseSync(path); seed.close(); const alias = join(directory, 'alias.sqlite3'); await link(path, alias);
		await assert.rejects(Store.open({ appDataPath: directory })); await rm(alias); await rm(path);
		if (process.platform !== 'win32') {
			await symlink(join(directory, 'outside-wal'), `${path}-wal`);
			await assert.rejects(Store.open({ appDataPath: directory })); assert.equal((await lstat(`${path}-wal`)).isSymbolicLink(), true);
		}
	});
});
