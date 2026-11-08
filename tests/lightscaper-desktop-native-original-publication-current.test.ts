/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LightscaperNativeOriginalStoreCurrentV1 } from '../desktop/lightscaper-native-original-store-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1, lightscaperNativePhotoOriginalBodyPathCurrentV1 } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import { readLightscaperNativeOriginalCurrentV1 } from '../desktop/lightscaper-native-original-contract-current-v1.ts';

// Storage bytes only: the native owner does not authenticate an image codec.
const BYTES = Buffer.from('Lightscaper SQL failure after actual body publication Ω.');
const descriptor = (storageKey = 'original-retry') => readLightscaperNativeOriginalCurrentV1({ schemaVersion: 1, kind: 'still',
	id: `source-${storageKey}`, name: 'Original Ω.png', mimeType: 'image/png', storageKey,
	contentSha256: createHash('sha256').update(BYTES).digest('hex'), width: 1, height: 1, hasAlpha: false,
	byteLength: BYTES.length, retention: 'managed' });
async function* source(): AsyncGenerator<Uint8Array> { yield new Uint8Array(BYTES); }
async function privateRoot(): Promise<string> { return realpath(await mkdtemp(join(tmpdir(), 'lightscaper publication ü '))); }
async function retire(root: string, owners: readonly LightscaperNativeOriginalStoreCurrentV1[], database?: DatabaseSync): Promise<void> {
	const results = await Promise.allSettled(owners.map(owner => owner.close()));
	const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
	try { database?.close(); } catch (error) { failures.push(error); }
	if (failures.length) throw new AggregateError(failures, `Native reader retirement failed; retained test root ${root}`);
	await rm(root, { recursive: true, force: false });
}

for (const shared of [false, true]) {
	test(`Lightscaper native Original SQL failure preserves ${shared ? 'an already bound shared' : 'a newly materialized'} body for retry and reopen`, async () => {
		const root = await privateRoot(), owners: LightscaperNativeOriginalStoreCurrentV1[] = [];
		let database: DatabaseSync | undefined;
		try {
			const store = await LightscaperNativeOriginalStoreCurrentV1.open({ appDataPath: root }); owners.push(store);
			const original = descriptor(), first = descriptor('original-existing');
			if (shared) await store.store(first, source());
			const paths = deriveLightscaperNativePhotoOriginalPathsCurrentV1(root);
			const body = lightscaperNativePhotoOriginalBodyPathCurrentV1(paths, original.contentSha256);
			if (!shared) await assert.rejects(readFile(body), { code: 'ENOENT' });
			database = new DatabaseSync(paths.databasePath, { allowExtension: false, timeout: 50 });
			// This second real connection injects failure only at binding INSERT,
			// after the production filesystem owner has published/authenticated.
			database.exec(`CREATE TRIGGER refuse_owned_insert BEFORE INSERT ON native_photo_original_bindings
				WHEN NEW.storage_key = 'original-retry' BEGIN SELECT RAISE(ABORT, 'owned SQL publication failure'); END`);
			await assert.rejects(store.store(original, source()), /owned SQL publication failure/u);
			assert.equal(database.prepare('SELECT storage_key FROM native_photo_original_bindings WHERE storage_key = ?').get(original.storageKey), undefined);
			await assert.rejects(store.verify(original), ReferenceError);
			assert.deepEqual(await readFile(body), BYTES);
			assert.equal(createHash('sha256').update(await readFile(body)).digest('hex'), original.contentSha256);
			assert.deepEqual(await readdir(paths.stagingRoot), []);
			if (shared) {
				await store.verify(first); assert.deepEqual(await store.read(first, 0, BYTES.length), new Uint8Array(BYTES));
				assert.equal(database.prepare('SELECT COUNT(*) AS count FROM native_photo_original_bindings').get()?.count, 1);
			}
			database.exec('DROP TRIGGER refuse_owned_insert');
			assert.deepEqual(await store.store(original, source()), original);
			assert.equal(database.prepare('SELECT COUNT(*) AS count FROM native_photo_original_bindings').get()?.count, shared ? 2 : 1);
			database.close(); database = undefined; await store.close();
			const reopened = await LightscaperNativeOriginalStoreCurrentV1.open({ appDataPath: root }); owners.push(reopened);
			await reopened.verify(original); assert.deepEqual(await reopened.read(original, 0, BYTES.length), new Uint8Array(BYTES));
			if (shared) await reopened.verify(first);
		} finally { await retire(root, owners, database); }
	});
}

for (const directory of ['bodiesRoot', 'stagingRoot'] as const) {
	test(`Lightscaper native Original refuses an actual linked managed ${directory} without changing its foreign directory`, async () => {
		const root = await privateRoot(), owners: LightscaperNativeOriginalStoreCurrentV1[] = [];
		try {
			const appDataPath = join(root, 'profile'), foreign = join(root, 'foreign');
			await mkdir(appDataPath); await mkdir(foreign); await writeFile(join(foreign, 'untouched.txt'), BYTES);
			const paths = deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataPath); await mkdir(paths.libraryRoot, { recursive: true });
			await symlink(foreign, paths[directory], process.platform === 'win32' ? 'junction' : 'dir');
			assert.equal((await lstat(paths[directory])).isSymbolicLink(), true);
			await assert.rejects(async () => { owners.push(await LightscaperNativeOriginalStoreCurrentV1.open({ appDataPath })); });
			assert.deepEqual(await readFile(join(foreign, 'untouched.txt')), BYTES); assert.deepEqual(await readdir(foreign), ['untouched.txt']);
			await assert.rejects(readFile(paths.databasePath), { code: 'ENOENT' });
		} finally { await retire(root, owners); }
	});
}

test('Lightscaper native Original refuses a linked digest shard before acquiring a producer or changing foreign files', async () => {
	const root = await privateRoot(), owners: LightscaperNativeOriginalStoreCurrentV1[] = [];
	try {
		const store = await LightscaperNativeOriginalStoreCurrentV1.open({ appDataPath: root }); owners.push(store);
		const paths = deriveLightscaperNativePhotoOriginalPathsCurrentV1(root), original = descriptor(), foreign = join(root, 'foreign');
		await mkdir(foreign); await writeFile(join(foreign, 'untouched.txt'), BYTES);
		await symlink(foreign, dirname(lightscaperNativePhotoOriginalBodyPathCurrentV1(paths, original.contentSha256)), process.platform === 'win32' ? 'junction' : 'dir');
		let acquired = false;
		const producer: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { acquired = true; return source(); } };
		await assert.rejects(store.store(original, producer)); assert.equal(acquired, false);
		await assert.rejects(store.verify(original), ReferenceError);
		assert.deepEqual(await readFile(join(foreign, 'untouched.txt')), BYTES); assert.deepEqual(await readdir(foreign), ['untouched.txt']);
		assert.deepEqual(await readdir(paths.stagingRoot), []);
	} finally { await retire(root, owners); }
});

for (const kind of ['symlink', 'hardlink'] as const) {
	test(`Lightscaper native Original refuses an actual SQLite ${kind} before changing an otherwise adoptable foreign file`,
		{ skip: kind === 'symlink' && process.platform === 'win32' }, async () => {
			const root = await privateRoot(), owners: LightscaperNativeOriginalStoreCurrentV1[] = [];
			try {
				const appDataPath = join(root, 'profile'), foreign = join(root, 'foreign.sqlite3'); await mkdir(appDataPath);
				const paths = deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataPath); await mkdir(paths.libraryRoot, { recursive: true });
				// An empty but initialized SQLite file would be adopted if the native
				// owner followed this link and initialized before checking identity.
				const seed = new DatabaseSync(foreign); try { seed.exec('VACUUM'); } finally { seed.close(); }
				if (kind === 'symlink') await symlink(foreign, paths.databasePath, 'file'); else await link(foreign, paths.databasePath);
				const before = await readFile(foreign), metadata = await lstat(foreign);
				if (kind === 'hardlink') assert.equal(metadata.nlink, 2);
				await assert.rejects(async () => { owners.push(await LightscaperNativeOriginalStoreCurrentV1.open({ appDataPath })); });
				assert.deepEqual(await readFile(foreign), before);
				if (process.platform !== 'win32') assert.equal((await lstat(foreign)).mode, metadata.mode);
				const check = new DatabaseSync(foreign, { readOnly: true });
				try {
					assert.equal(check.prepare('PRAGMA application_id').get()?.application_id, 0);
					assert.equal(check.prepare('PRAGMA user_version').get()?.user_version, 0);
					assert.deepEqual(check.prepare("SELECT name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'").all(), []);
				} finally { check.close(); }
			} finally { await retire(root, owners); }
		});
}
