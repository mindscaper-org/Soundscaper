/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { resolve } from 'node:path';
import test from 'node:test';
import { captureLightscaperNativePhotoSettingCurrentV1 as encode } from '../desktop/lightscaper-native-photo-settings-codec-current-v1.ts';
import { nativeMediaRestoreFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-media-restore-integration-fixture-current.ts';

/** Delegate genuine SQLite reads, then mutate through a separate real WAL
 * connection. Observe native payload delivery without replacing any row,
 * decoder, verifier or positive acknowledgement. */
async function observe(path: string, column: 'metadata' | 'payload', maximum: number, mutate: () => void,
	run: () => Promise<void>): Promise<Readonly<{ injected: boolean; maximumDelivered: number }>> {
	const prepare = DatabaseSync.prototype.prepare, owners = new WeakMap<object, DatabaseSync>(); let injected = false, maximumDelivered = 0;
	DatabaseSync.prototype.prepare = function (sql: string): StatementSync {
		const statement = Reflect.apply(prepare, this, [sql]) as StatementSync; owners.set(statement, this);
		const get = statement.get;
		statement.get = function (...args: unknown[]): ReturnType<StatementSync['get']> {
			const row = Reflect.apply(get, statement, args) as ReturnType<StatementSync['get']>, database = owners.get(statement)!;
			const file = (Reflect.apply(prepare, database, ['PRAGMA database_list']) as StatementSync).get()?.file;
			if (typeof file === 'string' && resolve(file) === resolve(path)) {
				const value = row?.[column]; if (value instanceof Uint8Array) maximumDelivered = Math.max(maximumDelivered, value.byteLength);
				if (!injected && sql.includes(`length(${column})`) && row) { injected = true; mutate(); }
			}
			return row;
		};
		return statement;
	};
	try { await run(); } finally { DatabaseSync.prototype.prepare = prepare; }
	assert.equal(injected, true, 'The actual bounded audit read must be reached.');
	assert.ok(maximumDelivered <= maximum, `A native read delivered ${maximumDelivered} bytes above its ${maximum}-byte admission.`);
	return Object.freeze({ injected, maximumDelivered });
}

for (const column of ['metadata', 'payload'] as const) void test(`Native restore atomically bounds ${column} bytes against a second-connection replacement before codec decode`, { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		await f.writePhotos(); await f.writeResources(); await f.catalog.finish();
		let presetBytes = 0;
		f.sql('settings', database => { const value = database.prepare('SELECT length(payload) AS bytes FROM native_photo_settings').get()?.bytes;
			assert.equal(typeof value, 'number'); presetBytes = Number(value); });
		const maximum = column === 'metadata' ? 65_536 : presetBytes;
		assert.ok(maximum > 0 && maximum < 2 * 1024 * 1024);
		const replacement = await encode({ name: f.photos[0]!.original.name, mimeType: f.photos[0]!.original.mimeType,
			lastModified: 0, replaced: 'x'.repeat(Math.max(128 * 1024, maximum + 4096)) });
		assert.ok(replacement.byteLength > maximum); assert.ok(replacement.byteLength < 4 * 1024 * 1024);
		await observe(column === 'metadata' ? f.paths.originals.databasePath : f.paths.settings.databasePath, column, maximum, () => {
			if (column === 'metadata') f.sql('originals', database => { database.prepare('UPDATE native_photo_media_assets SET metadata=? WHERE source_id=?').run(replacement, f.photos[0]!.original.storageKey); });
			else f.sql('settings', database => { database.prepare('UPDATE native_photo_settings SET payload=?').run(replacement); });
		}, async () => { await assert.rejects(f.finish()); });
	});
});
