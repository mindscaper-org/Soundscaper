/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LightscaperNativeOriginalStoreCurrentV1 as Originals } from '../desktop/lightscaper-native-original-store-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as paths } from '../desktop/lightscaper-native-original-index-current-v1.ts';

for (const boundary of ['primary-and-rollback', 'dirty-publication'] as const) {
	test(`Lightscaper Original binding refuses actual COMMIT plus denied ROLLBACK at ${boundary}`, async () => {
		const appDataPath = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper-original-rollback-')));
		let owner: Originals | undefined, control: DatabaseSync | undefined, reopened: Originals | undefined;
		const exec = DatabaseSync.prototype.exec, prepare = DatabaseSync.prototype.prepare;
		const observed: { database?: DatabaseSync; denials: number } = { denials: 0 };
		const bytes = Uint8Array.of(17, 31, 43), binding = { storageKey: 'uncommitted-original', byteLength: bytes.length,
			contentSha256: createHash('sha256').update(bytes).digest('hex') };
		let failed = false, primary: unknown;
		try {
			owner = await Originals.open({ appDataPath });
			const databasePath = paths(appDataPath).databasePath; control = new DatabaseSync(databasePath);
			control.exec(`CREATE TABLE original_test_parent(id INTEGER PRIMARY KEY);
				CREATE TABLE original_test_child(id INTEGER REFERENCES original_test_parent(id) DEFERRABLE INITIALLY DEFERRED);
				CREATE TRIGGER original_test_commit AFTER INSERT ON native_photo_original_bindings BEGIN INSERT INTO original_test_child VALUES(1); END`);
			DatabaseSync.prototype.exec = function (sql: string): void {
				Reflect.apply(exec, this, [sql]);
				if (sql.trim().toUpperCase() !== 'BEGIN IMMEDIATE' || prepare.call(this, 'PRAGMA database_list').get()?.file !== databasePath) return;
				observed.database = this;
				this.setAuthorizer((action, operation) => {
					if (action === constants.SQLITE_TRANSACTION && operation === 'ROLLBACK') { observed.denials++; return constants.SQLITE_DENY; }
					return constants.SQLITE_OK;
				});
			};
			let publicationFailure: unknown;
			try { await owner.storeBinding(binding, (async function* () { yield bytes; })()); } catch (error) { publicationFailure = error; }
			assert.ok(observed.database); assert.equal(observed.database.isTransaction, true); assert.equal(observed.denials, 1);
			assert.ok(observed.database.prepare('SELECT 1 FROM native_photo_original_bindings WHERE storage_key=?').get(binding.storageKey));
			const probes = await Promise.allSettled([owner.verifyBinding(binding), owner.readBinding(binding, 0, bytes.length)]);
			assert.equal(observed.database.isTransaction, true);
			await owner.close(); assert.equal(observed.database.isOpen, false); DatabaseSync.prototype.exec = exec;
			control.exec('DROP TRIGGER original_test_commit; DROP TABLE original_test_child; DROP TABLE original_test_parent'); control.close(); control = undefined;
			reopened = await Originals.open({ appDataPath }); await assert.rejects(reopened.verifyBinding(binding), /binding/iu); await reopened.close();
			if (boundary === 'primary-and-rollback') {
				assert.ok(publicationFailure instanceof AggregateError); const errors = publicationFailure.errors as unknown[];
				assert.equal(errors.length, 2); assert.ok(errors[0] instanceof Error); assert.ok(errors[1] instanceof Error);
				assert.match(errors[0].message, /FOREIGN KEY/u); assert.match(errors[1].message, /authoriz|denied/iu);
			} else assert.deepEqual(probes.map(result => result.status), ['rejected', 'rejected']);
		} catch (error) { failed = true; primary = error; }
		DatabaseSync.prototype.exec = exec;
		const cleanup: unknown[] = [];
		try { await owner?.close(); } catch (error) { cleanup.push(error); }
		try { control?.close(); } catch (error) { cleanup.push(error); }
		try { await reopened?.close(); } catch (error) { cleanup.push(error); }
		if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Original rollback fixture retirement failed; files retained.');
		if (failed) throw primary;
		await rm(appDataPath, { recursive: true, force: false });
	});
}
