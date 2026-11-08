/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from '../../desktop/lightscaper-native-photo-settings-current-v1.ts';

export interface NativePhotoSettingsFixtureCurrentV1 {
	readonly appDataPath: string;
	readonly databasePath: string;
	readonly owner: Settings;
	readonly values: Settings['settingsRepository'];
	readonly control: DatabaseSync;
}

/** Real on-disk ownership. Remove the private directory only after both SQLite
 * connections have actually closed; preserve primary and retirement failures. */
export async function nativePhotoSettingsFixtureCurrentV1(run: (fixture: NativePhotoSettingsFixtureCurrentV1) => Promise<void>): Promise<void> {
	const appDataPath = await mkdtemp(join(tmpdir(), 'lightscaper-native-settings-'));
	let owner: Settings | undefined, control: DatabaseSync | undefined, failed = false, failure: unknown;
	try {
		owner = await Settings.open({ appDataPath });
		const databasePath = join(appDataPath, 'Lightscaper', 'project-library', 'v1', 'native-photo-settings.sqlite3');
		control = new DatabaseSync(databasePath);
		await run({ appDataPath, databasePath, owner, values: owner.settingsRepository, control });
	} catch (error) { failed = true; failure = error; }
	const closed = await Promise.allSettled([owner?.close(), Promise.resolve().then(() => { control?.close(); })]);
	const cleanup = closed.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
	if (cleanup.length) throw new AggregateError([...(failed ? [failure] : []), ...cleanup], 'Native settings fixture retained its directory after retirement failure.');
	await rm(appDataPath, { recursive: true, force: true });
	if (failed) throw failure;
}

/** Observe only genuine native SQL completion for this private database. There
 * is no replacement database, modified SQL, synthetic row or renderer hook. */
export async function observeNativePhotoSettingsSqlCurrentV1<Result>(databasePath: string,
	after: (database: DatabaseSync, sql: string) => void, run: () => Promise<Result>): Promise<Result> {
	const exec = DatabaseSync.prototype.exec, prepare = DatabaseSync.prototype.prepare;
	DatabaseSync.prototype.exec = function (sql: string): void {
		exec.call(this, sql);
		const row = prepare.call(this, 'PRAGMA database_list').get();
		if (typeof row?.file === 'string' && resolve(row.file) === resolve(databasePath)) after(this, sql.trim().replace(/;$/u, '').toUpperCase());
	};
	try { return await run(); } finally { DatabaseSync.prototype.exec = exec; }
}

/** assert.rejects can assimilate a hostile rejection as a thenable. Compare the
 * rejection in the handler and never return it to Promise resolution. */
export async function exactNativePhotoSettingsFailureCurrentV1(work: Promise<unknown>, expected: unknown): Promise<void> {
	let rejected = false;
	await work.then(() => undefined, (failure: unknown) => { rejected = true; assert.equal(failure, expected); });
	assert.equal(rejected, true);
}
