/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { constants, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from '../desktop/lightscaper-native-photo-settings-current-v1.ts';
import { deriveLightscaperNativePhotoSettingsPathsCurrentV1 } from '../desktop/lightscaper-native-photo-settings-database-current-v1.ts';

test('Lightscaper native settings refuses dirty public reads after a genuine second-write refusal and denied SQLite rollback until joined Close', async () => {
	const appDataPath = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native settings denied rollback ü ')));
	const databasePath = deriveLightscaperNativePhotoSettingsPathsCurrentV1(appDataPath).databasePath;
	const pointer = 'photo-library:default', intent = 'photo-library:restore-commit-v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
	const expected = { schemaVersion: 1, kind: 'photo-library', catalogId: 'original' };
	const replacement = { schemaVersion: 1, kind: 'photo-library', catalogId: 'candidate' };
	const pointerKey = Buffer.from(pointer, 'utf16le').swap16(), intentKey = Buffer.from(intent, 'utf16le').swap16();
	const nativeExec = DatabaseSync.prototype.exec, nativePrepare = DatabaseSync.prototype.prepare;
	const observed: { database?: DatabaseSync; rollbackDenials: number } = { rollbackDenials: 0 };
	let owner: Settings | undefined, control: DatabaseSync | undefined, reopened: Settings | undefined;
	let failed = false, primary: unknown;
	try {
		owner = await Settings.open({ appDataPath }); const values = owner.settingsRepository;
		await values.put(pointer, expected); control = new DatabaseSync(databasePath);
		const committed = control.prepare('SELECT payload FROM native_photo_settings WHERE scope=? AND key=?').get('anchor', pointerKey)?.payload;
		assert.ok(committed instanceof Uint8Array);
		// Existing pointer UPSERT must proceed; only its genuinely absent second
		// intent row is refused. ABORT leaves the first update in the transaction.
		control.exec(`CREATE TRIGGER native_settings_denied_rollback_intent BEFORE INSERT ON native_photo_settings
			WHEN NOT EXISTS (SELECT 1 FROM native_photo_settings WHERE scope=NEW.scope AND key=NEW.key)
			BEGIN SELECT RAISE(ABORT, 'Native second intent insertion refused.'); END`);
		DatabaseSync.prototype.exec = function (sql: string): void {
			Reflect.apply(nativeExec, this, [sql]);
			if (sql.trim().toUpperCase() !== 'BEGIN IMMEDIATE') return;
			const location = Reflect.apply(nativePrepare, this, ['PRAGMA database_list']).get();
			if (typeof location?.file !== 'string' || resolve(location.file) !== resolve(databasePath)) return;
			observed.database = this;
			this.setAuthorizer((action, operation) => {
				if (action === constants.SQLITE_TRANSACTION && operation?.toUpperCase() === 'ROLLBACK') {
					observed.rollbackDenials++; return constants.SQLITE_DENY;
				}
				return constants.SQLITE_OK;
			});
		};
		let failure: unknown;
		try { await values.replaceIfCurrentAndPutIfAbsent(pointer, expected, replacement, intent, { permanent: true }); }
		catch (error) { failure = error; }
		assert.ok(failure instanceof AggregateError); const errors = failure.errors as unknown[];
		assert.equal(errors.length, 2); assert.ok(errors[0] instanceof Error); assert.ok(errors[1] instanceof Error);
		assert.match(errors[0].message, /second intent insertion refused/iu); assert.match(errors[1].message, /authoriz|denied/iu);
		assert.notEqual(errors[0], errors[1]); assert.equal(observed.rollbackDenials, 1);
		assert.ok(observed.database); assert.equal(observed.database.isOpen, true); assert.equal(observed.database.isTransaction, true);
		const dirty = observed.database.prepare('SELECT payload FROM native_photo_settings WHERE scope=? AND key=?').get('anchor', pointerKey)?.payload;
		assert.ok(dirty instanceof Uint8Array); assert.notDeepEqual(dirty, committed, 'Actual first pointer update must precede the refused second write.');
		assert.equal(observed.database.prepare('SELECT 1 FROM native_photo_settings WHERE scope=? AND key=?').get('anchor', intentKey), undefined);
		// The real ROLLBACK authorizer remains installed. Do not compensate or
		// close the owner before probing both public read methods independently.
		const probes = await Promise.allSettled([values.get(pointer), values.readEntry(pointer)]);
		assert.equal(observed.database.isTransaction, true); assert.equal(observed.database.isOpen, true);
		const closing = owner.close(); assert.equal(owner.close(), closing); await closing;
		assert.equal(observed.database.isOpen, false);
		DatabaseSync.prototype.exec = nativeExec;
		control.exec('DROP TRIGGER native_settings_denied_rollback_intent'); control.close(); control = undefined;
		reopened = await Settings.open({ appDataPath });
		assert.deepEqual(await reopened.settingsRepository.get(pointer), expected);
		assert.deepEqual(await reopened.settingsRepository.readEntry(intent), { present: false });
		await reopened.close();
		assert.deepEqual(probes.map(probe => probe.status), ['rejected', 'rejected'], 'Both public reads must refuse the still-active failed transaction.');
	} catch (error) { failed = true; primary = error; }
	DatabaseSync.prototype.exec = nativeExec;
	const cleanup: unknown[] = [];
	try { await owner?.close(); } catch (error) { cleanup.push(error); }
	try { control?.close(); } catch (error) { cleanup.push(error); }
	try { await reopened?.close(); } catch (error) { cleanup.push(error); }
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Native settings rollback fixture retirement failed; files retained.');
	if (failed) throw primary;
	await rm(appDataPath, { recursive: true, force: false });
});
