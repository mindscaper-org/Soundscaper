/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Blob } from 'node:buffer';
import type { KeyValueEntry } from '../src/common/editor/storage/key-value-repository.ts';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from '../desktop/lightscaper-native-photo-settings-current-v1.ts';
import { encodeLightscaperNativePhotoSettingKeyCurrentV1 as encodeKey } from '../desktop/lightscaper-native-photo-settings-request-current-v1.ts';
import { nativePhotoSettingsFixtureCurrentV1 as fixture, observeNativePhotoSettingsSqlCurrentV1 as observe } from './helpers/lightscaper-native-photo-settings-integration-fixture-current.ts';

const POINTER = 'photo-library:native-selected-v1', ACTIVE = 'photo-library:native-restore-active-v1';
const NAMESPACE = 'a'.repeat(32), HISTORY = `photo-library:native-restore-commit-v1:${NAMESPACE}`;
const prior = () => ({ schemaVersion: 1, kind: 'native-photo-library-selection', selectionToken: '1'.repeat(32), catalogId: 'catalog', namespaceToken: null });
const next = () => ({ ...prior(), selectionToken: '2'.repeat(32), namespaceToken: NAMESPACE });
const history = () => ({ schemaVersion: 1, kind: 'native-photo-library-restore-commit', previous: prior(), replacement: next() });
type Pair = (expected: unknown, replacement: unknown, key: string, value: unknown, admission?: (allowed: true) => void) => Promise<boolean>;
function entry(owner: Settings, key: string): Promise<KeyValueEntry> {
	const read: unknown = Reflect.get(owner, 'readLibraryAnchorEntryCurrentV1'); assert.equal(typeof read, 'function');
	return Reflect.apply(read as (key: string) => Promise<KeyValueEntry>, owner, [key]);
}
function pair(owner: Settings, expected = prior(), replacement = next(), key = HISTORY, value: unknown = history(), admission?: (allowed: true) => void): Promise<boolean> {
	const publish: unknown = Reflect.get(owner, 'publishLibrarySelectionCurrentV1'); assert.equal(typeof publish, 'function');
	return Reflect.apply(publish as Pair, owner, [expected, replacement, key, value, admission]);
}
void test('Native library anchor reads preserve physical occupancy and guard encoded bytes before decode', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		assert.deepEqual(await entry(f.owner, POINTER), { present: false });
		await f.values.put(POINTER, undefined); assert.deepEqual(await entry(f.owner, POINTER), { present: true, value: undefined });
		await f.values.put(ACTIVE, new Blob([new Uint8Array(8192)])); await assert.rejects(entry(f.owner, ACTIVE), RangeError);
		await assert.rejects(entry(f.owner, 'photo-library:native-restore-commit-v1:foreign'));
		const selected = await Settings.open({ appDataPath: f.appDataPath, scope: 'selected:library' });
		try { await assert.rejects(entry(selected, POINTER)); } finally { await selected.close(); }
	});
});
void test('Native library pair commits both exact values and preserves canonical expected property order', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		await f.values.put(POINTER, prior()); const calls: boolean[] = [], receivers: unknown[] = [];
		assert.equal(await pair(f.owner, prior(), next(), HISTORY, history(), function (this: unknown, allowed) { calls.push(allowed); receivers.push(this); }), true);
		assert.deepEqual(calls, [true, true]); assert.deepEqual(receivers, [undefined, undefined]);
		assert.deepEqual(await entry(f.owner, POINTER), { present: true, value: next() });
		assert.deepEqual(await entry(f.owner, HISTORY), { present: true, value: history() });
		await f.values.put(POINTER, { namespaceToken: null, catalogId: 'catalog', selectionToken: '1'.repeat(32), kind: 'native-photo-library-selection', schemaVersion: 1 });
		await f.values.delete(HISTORY); assert.equal(await pair(f.owner), false); assert.deepEqual(await entry(f.owner, HISTORY), { present: false });
	});
});
void test('Native library pair checks a genuine second-connection pointer race and occupied undefined history', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		await f.values.put(POINTER, prior()); const encoded = f.control.prepare('SELECT payload FROM native_photo_settings WHERE scope=? AND key=?');
		await f.values.put(ACTIVE, next()); const payload = encoded.get('anchor', encodeKey(ACTIVE))?.payload;
		assert.ok(payload instanceof Uint8Array); let calls = 0;
		assert.equal(await pair(f.owner, prior(), next(), HISTORY, history(), () => {
			calls++; f.control.prepare('UPDATE native_photo_settings SET payload=? WHERE scope=? AND key=?').run(payload, 'anchor', encodeKey(POINTER));
		}), false); assert.equal(calls, 1); assert.deepEqual(await entry(f.owner, HISTORY), { present: false });
		await f.values.put(POINTER, prior()); await f.values.put(HISTORY, undefined); assert.equal(await pair(f.owner), false);
		assert.deepEqual(await entry(f.owner, POINTER), { present: true, value: prior() }); assert.deepEqual(await entry(f.owner, HISTORY), { present: true, value: undefined });
	});
});
void test('Native library pair refuses ignored history insertion before COMMIT and rolls pointer back', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		await f.values.put(POINTER, prior()); const keyHex = Buffer.from(encodeKey(HISTORY)).toString('hex');
		f.control.exec(`CREATE TRIGGER ignore_native_history BEFORE INSERT ON native_photo_settings WHEN NEW.key=X'${keyHex}' BEGIN SELECT RAISE(IGNORE); END`);
		await assert.rejects(pair(f.owner)); assert.deepEqual(await entry(f.owner, POINTER), { present: true, value: prior() }); assert.deepEqual(await entry(f.owner, HISTORY), { present: false });
	});
});
void test('Native library pair refuses an actual trigger rewriting the pointer while retaining prior history absence', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		await f.values.put(POINTER, prior()); await f.values.put(ACTIVE, prior()); const pointerHex = Buffer.from(encodeKey(POINTER)).toString('hex'), activeHex = Buffer.from(encodeKey(ACTIVE)).toString('hex');
		f.control.exec(`CREATE TRIGGER rewrite_native_pointer AFTER UPDATE ON native_photo_settings WHEN NEW.key=X'${pointerHex}' BEGIN UPDATE native_photo_settings SET payload=(SELECT payload FROM native_photo_settings WHERE scope='anchor' AND key=X'${activeHex}') WHERE scope='anchor' AND key=X'${pointerHex}'; END`);
		await assert.rejects(pair(f.owner)); assert.deepEqual(await entry(f.owner, POINTER), { present: true, value: prior() }); assert.deepEqual(await entry(f.owner, HISTORY), { present: false });
	});
});
void test('Native library pair rolls both writes back on a genuine deferred-FK COMMIT refusal', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		await f.values.put(POINTER, prior()); const keyHex = Buffer.from(encodeKey(HISTORY)).toString('hex');
		f.control.exec(`CREATE TABLE library_parent(id INTEGER PRIMARY KEY); CREATE TABLE library_child(parent INTEGER REFERENCES library_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER library_commit_failure AFTER INSERT ON native_photo_settings WHEN NEW.key=X'${keyHex}' BEGIN INSERT INTO library_child VALUES(77); END`);
		await assert.rejects(pair(f.owner)); assert.deepEqual(await entry(f.owner, POINTER), { present: true, value: prior() }); assert.deepEqual(await entry(f.owner, HISTORY), { present: false });
		assert.equal(f.control.prepare('SELECT COUNT(*) AS count FROM library_child').get()?.count, 0);
	});
});
void test('Native library pair durable ACK survives actual close reentry from completed COMMIT', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		await f.values.put(POINTER, prior()); let closing: Promise<void> | undefined;
		await observe(f.databasePath, (_db, sql) => { if (sql === 'COMMIT') closing = f.owner.close(); }, async () => { assert.equal(await pair(f.owner), true); });
		assert.ok(closing); await closing; await assert.rejects(entry(f.owner, POINTER));
		const reopened = await Settings.open({ appDataPath: f.appDataPath });
		try { assert.deepEqual(await entry(reopened, POINTER), { present: true, value: next() }); assert.deepEqual(await entry(reopened, HISTORY), { present: true, value: history() }); }
		finally { await reopened.close(); }
	});
});
