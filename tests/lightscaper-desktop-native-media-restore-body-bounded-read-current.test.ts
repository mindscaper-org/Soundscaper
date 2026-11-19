/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { resolve } from 'node:path';
import test from 'node:test';
import { captureLightscaperNativePhotoSettingCurrentV1 as encode } from '../desktop/lightscaper-native-photo-settings-codec-current-v1.ts';
import { nativeMediaRestoreFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-media-restore-integration-fixture-current.ts';

void test('Native restore body authentication never falls back to unbounded metadata decoding after its current fence', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		await f.writePhotos(); await f.writeResources(); await f.catalog.finish();
		const replacement = await encode({ name: f.photos[0]!.original.name, mimeType: f.photos[0]!.original.mimeType, lastModified: 0, replaced: 'x'.repeat(128 * 1024) });
		assert.ok(replacement.byteLength > 65536 && replacement.byteLength < 512 * 1024);
		const prepare = DatabaseSync.prototype.prepare, owners = new WeakMap<object, DatabaseSync>();
		let metadataAdmitted = false, injected = false, maximumDelivered = 0;
		DatabaseSync.prototype.prepare = function (sql: string): StatementSync {
			const statement = Reflect.apply(prepare, this, [sql]) as StatementSync; owners.set(statement, this); const get = statement.get;
			statement.get = function (...args: unknown[]): ReturnType<StatementSync['get']> {
				const row = Reflect.apply(get, statement, args) as ReturnType<StatementSync['get']>, database = owners.get(statement)!;
				const file = (Reflect.apply(prepare, database, ['PRAGMA database_list']) as StatementSync).get()?.file;
				if (typeof file === 'string' && resolve(file) === resolve(f.paths.originals.databasePath)) {
					if (row?.metadata instanceof Uint8Array) maximumDelivered = Math.max(maximumDelivered, row.metadata.byteLength);
					if (sql.includes('length(metadata)') && sql.includes('WHERE source_id=?') && row) metadataAdmitted = true;
				}
				// current() samples media/resources/settings in that order. This
				// mutation follows its final native sample, before queued body work.
				if (!injected && metadataAdmitted && typeof file === 'string' && resolve(file) === resolve(f.paths.settings.databasePath) && sql === 'PRAGMA data_version') {
					injected = true; f.sql('originals', control => { control.prepare('UPDATE native_photo_media_assets SET metadata=? WHERE source_id=?').run(replacement, f.photos[0]!.original.storageKey); });
				}
				return row;
			}; return statement;
		};
		try { await assert.rejects(f.finish()); } finally { DatabaseSync.prototype.prepare = prepare; }
		assert.equal(injected, true); assert.ok(maximumDelivered <= 65536, `Body authentication delivered ${maximumDelivered} metadata bytes after its bound.`);
	});
});
