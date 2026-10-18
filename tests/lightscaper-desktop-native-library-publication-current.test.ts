/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import test from 'node:test';
import { encodeLightscaperNativePhotoSettingKeyCurrentV1 as key } from '../desktop/lightscaper-native-photo-settings-request-current-v1.ts';
import { LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_SELECTION_KEY_CURRENT_V1 as POINTER,
	LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_ACTIVE_RESTORE_KEY_CURRENT_V1 as ACTIVE } from '../desktop/lightscaper-native-photo-library-selection-contract-current-v1.ts';
import { observeNativePhotoSettingsSqlCurrentV1 as observe } from './helpers/lightscaper-native-photo-settings-integration-fixture-current.ts';
import { nativeRestoreArchiveCurrentV1 as archive, nativeArchiveRestoreTargetCurrentV1 as target } from './helpers/lightscaper-native-library-archive-restore-fixture-current.ts';

const anchorPath = (directory: string): string => join(directory, 'Lightscaper', 'project-library', 'v1', 'native-photo-settings.sqlite3');
function committedHistory(database: DatabaseSync): boolean {
	return database.prepare("SELECT COUNT(*) AS n FROM native_photo_settings WHERE scope='anchor' AND key!=? AND key!=?").get(key(POINTER), key(ACTIVE))?.n === 1;
}

void test('Native genuine Ready publication ACK survives Scopes close reentry from actual completed pointer/history COMMIT', { timeout: 15_000 }, async context => {
	const source = await archive(context);
	await target(context, async f => {
		await f.scopes.openSelected({ name: 'Native default' }); let closing: Promise<void> | undefined, observed = false;
		const result = await observe(anchorPath(f.directory), (database, sql) => {
			if (!observed && sql === 'COMMIT' && committedHistory(database)) { observed = true; closing = f.track(f.scopes.close()); }
		}, () => f.track(f.scopes.restoreArchive(source.blob, { name: 'Native default', signal: f.signal })));
		assert.equal(observed, true); assert.equal(result.photoCount, 6); assert.deepEqual(result.notices, []); assert.ok(closing); await closing;
		await f.reopen(); const selected = await f.scopes.openSelected({ name: 'Reopened' }); assert.equal(selected.catalogId, source.root.id);
		const components = await f.scopes.openComponents(selected.scope); assert.equal((await components.catalog.loadCatalog(source.root.id))?.photoCount, 6); await components.close();
	});
});

void test('Native genuine Ready publication reconciles lost actual COMMIT ACK from matching permanent native history', { timeout: 15_000 }, async context => {
	const source = await archive(context);
	await target(context, async f => {
		await f.scopes.openSelected({ name: 'Native default' }); let observed = false; const lost = Symbol('lost native COMMIT receipt');
		const result = await observe(anchorPath(f.directory), (database, sql) => {
			if (!observed && sql === 'COMMIT' && committedHistory(database)) { observed = true; throw lost; }
		}, () => f.track(f.scopes.restoreArchive(source.blob, { name: 'Native default', signal: f.signal })));
		assert.equal(observed, true); assert.equal(result.photoCount, 6); assert.deepEqual(result.notices, ['publication-reconciled']);
		await f.reopen(); assert.equal((await f.scopes.openSelected({ name: 'Reopened' })).catalogId, source.root.id);
	});
});

void test('Native genuine Ready publication refuses ignored history, preserves selection, and permits an authenticated later restore', { timeout: 15_000 }, async context => {
	const source = await archive(context);
	await target(context, async f => {
		const previous = await f.scopes.openSelected({ name: 'Native default' });
		const control = new DatabaseSync(anchorPath(f.directory)), pointer = Buffer.from(key(POINTER)).toString('hex'), active = Buffer.from(key(ACTIVE)).toString('hex');
		try {
			control.exec(`CREATE TRIGGER ignore_native_history BEFORE INSERT ON native_photo_settings WHEN NEW.scope='anchor' AND NEW.key!=X'${pointer}' AND NEW.key!=X'${active}' BEGIN SELECT RAISE(IGNORE); END`);
			await assert.rejects(f.track(f.scopes.restoreArchive(source.blob, { name: 'Native default', signal: f.signal })));
			assert.equal((await f.scopes.openSelected({ name: 'Unchanged' })).selectionToken, previous.selectionToken);
			assert.equal(control.prepare("SELECT COUNT(*) AS n FROM native_photo_settings WHERE scope='anchor' AND key!=? AND key!=?").get(key(POINTER), key(ACTIVE))?.n, 0);
			control.exec('DROP TRIGGER ignore_native_history');
		} finally { control.close(); }
		assert.equal((await f.track(f.scopes.restoreArchive(source.blob, { name: 'Later', signal: f.signal }))).photoCount, 6);
	});
});
