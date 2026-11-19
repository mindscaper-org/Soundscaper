/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, realpath, readdir, rename, rm, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LightscaperNativePhotoLibraryScopeRegistryCurrentV1 as Registry } from '../desktop/lightscaper-native-photo-library-scope-registry-current-v1.ts';
import { initializeLightscaperNativePhotoLibraryScopeDatabaseCurrentV1 as initialize,
	inspectLightscaperNativePhotoLibraryScopeDatabaseCurrentV1 as inspect } from '../desktop/lightscaper-native-photo-library-scope-schema-current-v1.ts';
import { normalizePhotoLibraryRestoreAllocationV1 } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';

const APP = 0x4c534e53;
function allocation(index = 1) {
	const namespaceToken = index.toString(16).padStart(32, '0');
	return normalizePhotoLibraryRestoreAllocationV1({ schemaVersion: 1, kind: 'photo-library-restore-allocation', operationId: namespaceToken,
		namespaceToken, ownerToken: (index + 1000).toString(16).padStart(32, '0'), catalogId: `catalog-${index}` });
}
async function fixture(run: (f: { root: string; registry: Registry; db: DatabaseSync; library: string; generation(index?: number): string }) => Promise<void>): Promise<void> {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native library scope ü '))), library = join(root, 'Lightscaper', 'project-library', 'v1');
	const registry = await Registry.open(root), db = new DatabaseSync(join(library, 'native-photo-library-scopes.sqlite3'));
	let failed = false, primary: unknown;
	try { await run({ root, registry, db, library, generation: (index = 1) => join(library, 'native-photo-libraries', allocation(index).namespaceToken) }); }
	catch (error) { failed = true; primary = error; }
	const joined = await Promise.allSettled([registry.close(), Promise.resolve().then(() => { db.close(); })]);
	const failures = joined.flatMap(item => item.status === 'rejected' ? [item.reason as unknown] : []);
	if (failures.length) throw new AggregateError([...(failed ? [primary] : []), ...failures], 'Registry test retirement failed; fixture retained.');
	await rm(root, { recursive: true, force: false }); if (failed) throw primary;
}

test('Lightscaper native registry schema owns LSNS1 with a real root owner and exact two STRICT tables', () => {
	const db = new DatabaseSync(':memory:');
	try {
		assert.equal(inspect(db), 'empty'); initialize(db); assert.equal(inspect(db), 'owned');
		assert.equal(db.prepare('PRAGMA application_id').get()?.application_id, APP); assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 1);
		assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name").all().map(row => row.name), ['native_photo_library_scope_owner', 'native_photo_library_scopes']);
		const owner = db.prepare('SELECT singleton,owner_token FROM native_photo_library_scope_owner').get(); assert.equal(owner?.singleton, 1); assert.match(String(owner?.owner_token), /^[a-f0-9]{32}$/u);
		assert.deepEqual(db.prepare('PRAGMA table_info(native_photo_library_scopes)').all().map(row => row.name), ['namespace_token', 'allocation', 'manifest_sha256', 'state']);
		const before = db.prepare('SELECT * FROM native_photo_library_scope_owner').get(); initialize(db); assert.deepEqual(db.prepare('SELECT * FROM native_photo_library_scope_owner').get(), before);
		for (const name of ['native_photo_library_scope_owner', 'native_photo_library_scopes']) assert.equal(db.prepare('SELECT strict FROM pragma_table_list WHERE name=?').get(name)?.strict, 1);
	} finally { db.close(); }
});

test('Lightscaper native registry refuses foreign identity, weakened schema and missing or extra owner evidence without repair', () => {
	for (const kind of ['foreign', 'future', 'extra', 'weakened', 'owner-missing'] as const) {
		const db = new DatabaseSync(':memory:');
		try {
			if (kind === 'foreign') db.exec('CREATE TABLE foreign_bytes(value BLOB); INSERT INTO foreign_bytes VALUES(zeroblob(17))');
			else if (kind === 'weakened') db.exec(`PRAGMA application_id=${APP}; PRAGMA user_version=1; CREATE TABLE native_photo_library_scope_owner(singleton INTEGER,owner_token TEXT); CREATE TABLE native_photo_library_scopes(namespace_token TEXT,allocation TEXT,manifest_sha256 TEXT,state TEXT)`);
			else { initialize(db); if (kind === 'future') db.exec('PRAGMA user_version=2'); else if (kind === 'extra') db.exec('CREATE TABLE sqliteXforeign(value TEXT)'); else db.exec('DELETE FROM native_photo_library_scope_owner'); }
			const before = db.prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY name").all(); assert.throws(() => inspect(db)); assert.throws(() => initialize(db));
			assert.equal(db.isTransaction, false); assert.deepEqual(db.prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY name").all(), before);
		} finally { db.close(); }
	}
});

test('Lightscaper native allocation durably reserves exact identity before creating its manifest and private appData', async () => {
	await fixture(async f => {
		const input = allocation(), scope = await f.registry.allocate(input);
		assert.deepEqual(scope.allocation, input); assert.equal(scope.appDataPath, join(f.generation(), 'app-data')); assert.ok(Object.isFrozen(scope));
		const row = f.db.prepare('SELECT * FROM native_photo_library_scopes WHERE namespace_token=?').get(input.namespaceToken); assert.equal(row?.state, 'created');
		assert.equal(row?.allocation, JSON.stringify(input)); assert.match(String(row?.manifest_sha256), /^[a-f0-9]{64}$/u);
		const manifest = JSON.parse(await readFile(join(f.generation(), 'owner.json'), 'utf8')) as Record<string, unknown>;
		assert.deepEqual(manifest.allocation, input); assert.equal(manifest.storageProfile, 'lightscaper-native-photo-v1');
		assert.equal(manifest.registryOwner, f.db.prepare('SELECT owner_token FROM native_photo_library_scope_owner').get()?.owner_token);
		assert.deepEqual((await readdir(f.generation())).sort(), ['app-data', 'owner.json']); assert.deepEqual(await readdir(scope.appDataPath), []);
		assert.deepEqual(await f.registry.resume(input.namespaceToken), scope);
		await assert.rejects(f.registry.allocate(input));
	});
});

test('Lightscaper native registry resumes exact created allocation after a genuine connection close and reopen', async () => {
	await fixture(async f => {
		const first = await f.registry.allocate(allocation()); await writeFile(join(first.appDataPath, 'component-bytes'), 'owned child'); await f.registry.close();
		const reopened = await Registry.open(f.root);
		try { const resumed = await reopened.resume(allocation().namespaceToken); assert.deepEqual(resumed, first); assert.equal(await readFile(join(resumed.appDataPath, 'component-bytes'), 'utf8'), 'owned child'); }
		finally { await reopened.close(); }
	});
});

test('Lightscaper native allocation created-state SQL failure retains a recoverable durable reservation and exact fresh tree', async () => {
	await fixture(async f => {
		f.db.exec("CREATE TRIGGER scope_created_failure BEFORE UPDATE OF state ON native_photo_library_scopes WHEN NEW.state='created' BEGIN SELECT RAISE(ABORT,'created SQL refusal'); END");
		try { await assert.rejects(f.registry.allocate(allocation()), /created SQL refusal/u); }
		finally { f.db.exec('DROP TRIGGER scope_created_failure'); }
		assert.equal(f.db.prepare('SELECT state FROM native_photo_library_scopes').get()?.state, 'reserved');
		assert.deepEqual(await readdir(join(f.generation(), 'app-data')), []);
		const resumed = await f.registry.resume(allocation().namespaceToken); assert.equal(resumed.appDataPath, join(f.generation(), 'app-data'));
		assert.equal(f.db.prepare('SELECT state FROM native_photo_library_scopes').get()?.state, 'created');
	});
});

for (const part of ['manifest', 'app-data', 'both'] as const) {
	test(`Lightscaper native reserved crash reconciliation creates only missing ${part} from an exact fresh inventory`, async () => {
		await fixture(async f => {
			f.db.exec("CREATE TRIGGER scope_created_failure BEFORE UPDATE OF state ON native_photo_library_scopes BEGIN SELECT RAISE(ABORT,'reserve fixture'); END");
			try { await assert.rejects(f.registry.allocate(allocation()), /reserve fixture/u); } finally { f.db.exec('DROP TRIGGER scope_created_failure'); }
			if (part === 'manifest' || part === 'both') await unlink(join(f.generation(), 'owner.json'));
			if (part === 'app-data' || part === 'both') await rmdir(join(f.generation(), 'app-data'));
			const resumed = await f.registry.resume(allocation().namespaceToken); assert.equal(resumed.appDataPath, join(f.generation(), 'app-data'));
			assert.equal(f.db.prepare('SELECT state FROM native_photo_library_scopes').get()?.state, 'created');
		});
	});
}

test('Lightscaper native reserved reconciliation protects nonempty or unknown fresh inventory without granting deletion', async () => {
	for (const kind of ['populated-app-data', 'extra-file'] as const) await fixture(async f => {
		f.db.exec("CREATE TRIGGER scope_created_failure BEFORE UPDATE OF state ON native_photo_library_scopes BEGIN SELECT RAISE(ABORT,'reserve fixture'); END");
		try { await assert.rejects(f.registry.allocate(allocation()), /reserve fixture/u); } finally { f.db.exec('DROP TRIGGER scope_created_failure'); }
		const protectedPath = kind === 'populated-app-data' ? join(f.generation(), 'app-data', 'foreign-child') : join(f.generation(), 'foreign-file');
		await writeFile(protectedPath, 'keep'); await assert.rejects(f.registry.resume(allocation().namespaceToken));
		assert.equal(await readFile(protectedPath, 'utf8'), 'keep'); assert.equal(f.db.prepare('SELECT state FROM native_photo_library_scopes').get()?.state, 'reserved');
	});
});

test('Lightscaper native generation refuses missing, tampered and copied manifests across actual registry roots', async () => {
	for (const kind of ['missing', 'tampered', 'copied'] as const) await fixture(async f => {
		await f.registry.allocate(allocation()); const manifestPath = join(f.generation(), 'owner.json');
		if (kind === 'missing') await unlink(manifestPath);
		else if (kind === 'tampered') await writeFile(manifestPath, '{"foreign":true}');
		else await fixture(async other => { await other.registry.allocate(allocation()); await writeFile(manifestPath, await readFile(join(other.generation(), 'owner.json'))); });
		const before = kind === 'missing' ? null : await readFile(manifestPath); await assert.rejects(f.registry.resume(allocation().namespaceToken));
		if (before) assert.deepEqual(await readFile(manifestPath), before); assert.equal(f.db.prepare('SELECT state FROM native_photo_library_scopes').get()?.state, 'created');
	});
});

test('Lightscaper native reservation pages remain bounded and resume from a deleted cursor row without filesystem or readiness claims', async () => {
	await fixture(async f => {
		for (let index = 1; index <= 65; index += 1) await f.registry.allocate(allocation(index));
		const first = await f.registry.readPage(null); assert.equal(first.allocations.length, 64); assert.equal(first.afterToken, allocation(64).namespaceToken);
		assert.ok(first.allocations.every(item => item.state === 'created')); assert.ok(Object.isFrozen(first.allocations));
		f.db.prepare('DELETE FROM native_photo_library_scopes WHERE namespace_token=?').run(first.afterToken);
		const last = await f.registry.readPage(first.afterToken); assert.deepEqual(last.allocations.map(item => item.allocation.namespaceToken), [allocation(65).namespaceToken]); assert.equal(last.afterToken, null);
	});
});

for (const kind of ['hardlinked-manifest', 'linked-app-data', 'linked-generation'] as const) {
	test(`Lightscaper native generation refuses ${kind} while preserving actual foreign bytes`, async () => {
		await fixture(async f => {
			await f.registry.allocate(allocation()); const foreign = join(f.root, 'foreign'); await mkdir(foreign);
			const witness = join(foreign, 'keep'); await writeFile(witness, 'foreign bytes');
			if (kind === 'hardlinked-manifest') await link(join(f.generation(), 'owner.json'), join(foreign, 'manifest-link'));
			else if (kind === 'linked-app-data') { await rmdir(join(f.generation(), 'app-data')); await symlink(foreign, join(f.generation(), 'app-data'), process.platform === 'win32' ? 'junction' : 'dir'); }
			else { const moved = join(foreign, 'generation'); await rename(f.generation(), moved); await symlink(moved, f.generation(), process.platform === 'win32' ? 'junction' : 'dir'); }
			await assert.rejects(f.registry.resume(allocation().namespaceToken)); assert.equal(await readFile(witness, 'utf8'), 'foreign bytes');
		});
	});
}

test('Lightscaper native registry preserves a created COMMIT ACK through cancellation and fences closed admissions before reflection', async () => {
	await fixture(async f => {
		const exec = DatabaseSync.prototype.exec, stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke();
		DatabaseSync.prototype.exec = function (sql: string): void {
			exec.call(this, sql);
			if (sql === 'COMMIT' && this.prepare("SELECT 1 FROM sqlite_schema WHERE name='native_photo_library_scopes'").get()
				&& this.prepare("SELECT 1 FROM native_photo_library_scopes WHERE state='created'").get()) stop.abort(reason.proxy);
		};
		try { assert.equal((await f.registry.allocate(allocation(), stop.signal)).allocation.namespaceToken, allocation().namespaceToken); }
		finally { DatabaseSync.prototype.exec = exec; }
		await f.registry.close(); let traps = 0; const value = new Proxy({}, { ownKeys() { traps++; throw new Error('Closed reflection'); } });
		await assert.rejects(f.registry.allocate(value)); assert.equal(traps, 0);
	});
});
