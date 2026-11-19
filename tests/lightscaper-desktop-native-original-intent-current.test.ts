/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { nativeSettingsFixtureCurrentV1 } from './helpers/lightscaper-native-photo-settings-fixture-current.ts';
import { nativeOriginalReaderFixtureCurrentV1, readerShaCurrentV1 } from './helpers/lightscaper-native-photo-original-reader-fixture-current.ts';
import { normalizePhotoImportIntentV1, photoImportIntentKeyV1 } from '../src/lightscaper/import/import-intent-v1.ts';

test('fixed native intent read distinguishes absent scope and roundtrips maximum legal ASCII identities', { timeout: 15_000 }, async context => {
	const f = await nativeSettingsFixtureCurrentV1(context, 'selected:intent'), catalogId = 'c'.repeat(128), importId = 'i'.repeat(128);
	assert.equal(await f.owner.readImportIntentCurrentV1(catalogId), null);
	const intent = normalizePhotoImportIntentV1({ schemaVersion: 1, kind: 'photo-import', catalogId, importId }, catalogId);
	await f.settings.put(photoImportIntentKeyV1(catalogId), intent);
	assert.deepEqual(await f.owner.readImportIntentCurrentV1(catalogId), intent);
	assert.ok(Object.isFrozen(await f.owner.readImportIntentCurrentV1(catalogId)));
	const other = await f.open('selected:other'); assert.equal(await other.readImportIntentCurrentV1(catalogId), null);
	await assert.rejects(f.owner.readImportIntentCurrentV1('bad id'));
	await f.owner.close(); await assert.rejects(f.owner.readImportIntentCurrentV1(catalogId));
});

test('fixed native intent read refuses occupied oversized Blob before payload escapes SQL while generic settings remain complete', { timeout: 15_000 }, async context => {
	const f = await nativeSettingsFixtureCurrentV1(context, 'selected:intent'), catalogId = 'catalog';
	await f.settings.put(photoImportIntentKeyV1(catalogId), new Blob([new Uint8Array(8192)]));
	const prepare = DatabaseSync.prototype.prepare; let reads = 0;
	DatabaseSync.prototype.prepare = function (sql: string) {
		const statement = Reflect.apply(prepare, this, [sql]) as ReturnType<DatabaseSync['prepare']>;
		if (/FROM native_photo_settings/iu.test(sql)) {
			const get = statement.get;
			Object.defineProperty(statement, 'get', { configurable: true, value: function (this: typeof statement, ...args: Parameters<typeof statement.get>) {
				const row = Reflect.apply(get, this, args) as ReturnType<typeof statement.get>; reads++;
				if (row?.payload instanceof Uint8Array) assert.ok(row.payload.byteLength <= 4096, 'Oversized intent bytes escaped the native SQL length guard.');
				return row;
			} });
		}
		return statement;
	};
	try { await assert.rejects(f.owner.readImportIntentCurrentV1(catalogId), RangeError); assert.equal(reads, 1); }
	finally { DatabaseSync.prototype.prepare = prepare; }
	const generic: unknown = await f.settings.get(photoImportIntentKeyV1(catalogId)); assert.ok(generic instanceof Blob); assert.equal(generic.size, 8192);
});

test('fixed native intent read rejects physically present invalid intent rather than treating it as missing', { timeout: 15_000 }, async context => {
	const f = await nativeSettingsFixtureCurrentV1(context, 'selected:intent'), catalogId = 'catalog';
	for (const value of [undefined, null, {}, { schemaVersion: 1, kind: 'photo-import', catalogId: 'foreign', importId: 'import' }]) {
		await f.settings.put(photoImportIntentKeyV1(catalogId), value);
		assert.equal((await f.settings.readEntry(photoImportIntentKeyV1(catalogId))).present, true);
		await assert.rejects(f.owner.readImportIntentCurrentV1(catalogId));
	}
});

test('native Original reader captures fixed intent method and never touches generic settings facet', { timeout: 15_000 }, async () => {
	await nativeOriginalReaderFixtureCurrentV1(async f => {
		const method = f.settings.readImportIntentCurrentV1, methodDescriptor = Object.getOwnPropertyDescriptor(f.settings, 'readImportIntentCurrentV1');
		const repositoryDescriptor = Object.getOwnPropertyDescriptor(f.settings, 'settingsRepository'); assert.ok(repositoryDescriptor);
		let reads = 0, generic = 0;
		Object.defineProperty(f.settings, 'readImportIntentCurrentV1', { configurable: true, value: function (this: typeof f.settings, catalogId: string) {
			assert.equal(this, f.settings); reads++; return Reflect.apply(method, this, [catalogId]) as ReturnType<typeof method>;
		} });
		Object.defineProperty(f.settings, 'settingsRepository', { configurable: true, get() { generic++; throw Error('Generic settings must not authorize Original reads.'); } });
		try {
			const reader = f.readerFor();
			Object.defineProperty(f.settings, 'readImportIntentCurrentV1', { configurable: true, value: () => { throw Error('Retargeted intent method'); } });
			await reader.withOriginal(f.request, async view => { assert.equal(readerShaCurrentV1(await view.read(0, 17)), readerShaCurrentV1(f.entry.bytes.subarray(0, 17))); });
			assert.ok(reads >= 3); assert.equal(generic, 0);
		} finally {
			Object.defineProperty(f.settings, 'settingsRepository', repositoryDescriptor);
			if (methodDescriptor) Object.defineProperty(f.settings, 'readImportIntentCurrentV1', methodDescriptor);
			else Reflect.deleteProperty(f.settings, 'readImportIntentCurrentV1');
		}
	}, { staged: 'active-import', length: 64 });
});

test('native Original reader refuses missing fixed intent capability before creating a consumer owner', { timeout: 15_000 }, async () => {
	await nativeOriginalReaderFixtureCurrentV1(async f => {
		const descriptor = Object.getOwnPropertyDescriptor(f.settings, 'readImportIntentCurrentV1');
		Object.defineProperty(f.settings, 'readImportIntentCurrentV1', { configurable: true, value: undefined });
		try { assert.throws(() => f.readerFor(), TypeError); }
		finally {
			if (descriptor) Object.defineProperty(f.settings, 'readImportIntentCurrentV1', descriptor);
			else Reflect.deleteProperty(f.settings, 'readImportIntentCurrentV1');
		}
	}, { length: 64 });
});
