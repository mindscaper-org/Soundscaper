/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { copyFile, lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { linkedGrantsFixtureCurrentV1 as fixture, LINKED_GRANT_TEST_OPTIONS_CURRENT_V1 as options,
	grantAuthorizeCurrentV1 as authorize, Grants, GRANTED_FS_OP, grantedFsHashCurrentV1 as hash } from './helpers/lightscaper-native-linked-grants-integration-fixture-current.ts';
import { nativeGrantedFilesystemFixtureCurrentV1 as nativeFixture } from './helpers/lightscaper-native-granted-filesystem-fixture-current.ts';

void test('Lightscaper copied closed grants DB cannot authorize roots in another genuine media namespace', options, async context => {
	await fixture(context, async f => {
		const owner = await f.open(); await authorize(owner); await owner.close();
		await nativeFixture(context, async other => {
			const appDataPath = join(other.directory, 'app-data'), copied = join(appDataPath, 'Lightscaper', 'project-library', 'v1', 'native-photo-linked-grants.sqlite3');
			await copyFile(f.databasePath, copied); const before = hash(await readFile(copied)), roots = other.count(GRANTED_FS_OP.rootOpen); let chosen = 0;
			const results = await Promise.allSettled([Grants.open({ appDataPath, filesystem: other.role, scope: f.scope,
				chooser: { async chooseRoot() { chosen++; return f.selected; } }, unretired: () => undefined })]);
			const result = results[0]; assert.ok(result);
			if (result.status === 'fulfilled') await result.value.close();
			assert.equal(result.status, 'rejected');
			if (result.status === 'rejected') { const error: unknown = result.reason; assert.ok(error instanceof Error); assert.match(error.message, /namespace|binding|identity/iu); }
			assert.equal(chosen, 0); assert.equal(other.count(GRANTED_FS_OP.rootOpen), roots); assert.equal(hash(await readFile(copied)), before);
		});
	});
});

void test('Lightscaper genuine grants DB persists exact selected media path and bigint file identity without Number loss', options, async context => {
	await fixture(context, async f => {
		const owner = await f.open(), grant = await authorize(owner), stats = await lstat(f.mediaDatabasePath, { bigint: true }), peer = f.peer();
		try {
			const row = peer.prepare('SELECT singleton,media_path,media_device,media_inode FROM native_photo_linked_grant_owner').get(); assert.ok(row);
			assert.equal(row.singleton, 1); assert.equal(row.media_path, JSON.stringify(f.mediaDatabasePath));
			assert.equal(row.media_device, stats.dev.toString()); assert.equal(row.media_inode, stats.ino.toString());
		} finally { peer.close(); }
		await owner.close(); const reopened = await f.open(); assert.deepEqual(await reopened.revalidate(grant.grantId), grant);
	});
});
