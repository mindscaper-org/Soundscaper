/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, realpath, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LightscaperNativePhotoLibraryScopeRegistryCurrentV1 as Registry } from '../desktop/lightscaper-native-photo-library-scope-registry-current-v1.ts';
import { normalizePhotoLibraryRestoreAllocationV1 } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';

test('Lightscaper native created ACK pins the original allocation and manifest digest across actual filesystem awaits', { concurrency: false }, async () => {
	const appDataPath = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper-reservation-replacement-')));
	const library = join(appDataPath, 'Lightscaper', 'project-library', 'v1'), registry = await Registry.open(appDataPath);
	const database = new DatabaseSync(join(library, 'native-photo-library-scopes.sqlite3'));
	const original = normalizePhotoLibraryRestoreAllocationV1({ schemaVersion: 1, kind: 'photo-library-restore-allocation',
		operationId: '1'.repeat(32), namespaceToken: '1'.repeat(32), ownerToken: '2'.repeat(32), catalogId: 'catalog-original' });
	const replacement = normalizePhotoLibraryRestoreAllocationV1({ ...original, catalogId: 'catalog-replacement' });
	const owner = database.prepare('SELECT owner_token FROM native_photo_library_scope_owner').get()?.owner_token;
	const changedManifest = JSON.stringify({ schemaVersion: 1, kind: 'native-photo-library-generation', storageProfile: 'lightscaper-native-photo-v1', registryOwner: owner, allocation: replacement });
	const changedSha = createHash('sha256').update(changedManifest).digest('hex');
	const witness = await open(join(appDataPath, 'handle-witness'), 'wx');
	const prototype = Object.getPrototypeOf(witness) as object, descriptor = Object.getOwnPropertyDescriptor(prototype, 'sync');
	assert.ok(descriptor && typeof descriptor.value === 'function'); const sync = descriptor.value as FileHandle['sync']; await witness.close();
	let replaced = false, failure: unknown, failed = false;
	Object.defineProperty(prototype, 'sync', { ...descriptor, value: async function (this: FileHandle): Promise<void> {
		await sync.call(this); const entry = await this.stat();
		if (!replaced && entry.isFile() && entry.size > 0 && entry.size <= 4096) {
			// The real manifest has been written/flushed while no registry data
			// transaction is held; its native close still joins after this callback.
			// This is an actual second-connection commit, not a fake database.
			const changed = database.prepare("UPDATE native_photo_library_scopes SET allocation=?,manifest_sha256=? WHERE namespace_token=? AND state='reserved'")
				.run(JSON.stringify(replacement), changedSha, original.namespaceToken);
			assert.equal(changed.changes, 1); replaced = true;
		}
	} });
	try {
		await assert.rejects(registry.allocate(original), /reservation|allocation|manifest/iu); assert.equal(replaced, true);
		const row = database.prepare('SELECT allocation,state FROM native_photo_library_scopes WHERE namespace_token=?').get(original.namespaceToken);
		assert.equal(row?.allocation, JSON.stringify(replacement)); assert.equal(row?.state, 'reserved');
		const document = JSON.parse(await readFile(join(library, 'native-photo-libraries', original.namespaceToken, 'owner.json'), 'utf8')) as Record<string, unknown>;
		assert.equal(JSON.stringify(document.allocation), JSON.stringify(original));
	} catch (error) { failed = true; failure = error; }
	finally { Object.defineProperty(prototype, 'sync', descriptor); }
	const joined = await Promise.allSettled([registry.close(), Promise.resolve().then(() => { database.close(); })]);
	const errors = joined.flatMap(item => item.status === 'rejected' ? [item.reason as unknown] : []);
	if (errors.length) throw new AggregateError([...(failed ? [failure] : []), ...errors], 'Reservation test retirement failed; tree retained.');
	await rm(appDataPath, { recursive: true, force: false }); if (failed) throw failure;
});
