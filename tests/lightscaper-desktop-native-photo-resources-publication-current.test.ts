/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { normalizeVideoCubeLutReferenceV1 } from '../src/common/imaging/cube-lut-reference-contract.ts';
import { normalizeBrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { LightscaperNativePhotoResourcesCurrentV1 as Resources } from '../desktop/lightscaper-native-photo-resources-current-v1.ts';
import { nativeResourceIntegrationFixtureCurrentV1 as fixture,
	type NativeResourceBodyCurrentV1 as Body, type NativeResourceFamilyCurrentV1 as Family } from './helpers/lightscaper-native-photo-resources-integration-fixture-current.ts';

async function put(resources: Resources, family: Family, body: Body, signal?: AbortSignal) {
	return family === 'lut' ? (await resources.cubeLutResources()).put(body.reference, body.bytes, { signal })
		: (await resources.maskRasterResources()).put(body.reference, body.bytes, { signal });
}
for (const family of ['lut', 'brush'] as const) {
	test(`Lightscaper actual native ${family} INSERT trigger refusal rolls back immutable resource publication and later real retry succeeds`, async () => {
		await fixture(async f => {
			const body = family === 'lut' ? f.bundles[0]!.lut : f.bundles[0]!.brushes[0]!;
			f.bodies.exec("CREATE TRIGGER native_resource_test_refusal BEFORE INSERT ON native_photo_resources BEGIN SELECT RAISE(ABORT, 'Native resource INSERT refused.'); END");
			try {
				await assert.rejects(put(f.resources, family, body), /Native resource INSERT refused/u);
				assert.equal(f.bodies.prepare('SELECT COUNT(*) AS count FROM native_photo_resources').get()?.count, 0);
			} finally { f.bodies.exec('DROP TRIGGER native_resource_test_refusal'); }
			assert.equal((await put(f.resources, family, body)).created, true); assert.equal((await put(f.resources, family, body)).created, false);
		});
	});
	test(`Lightscaper actual native ${family} deferred SQLite COMMIT refusal rolls back both authenticated body and genuine trigger write`, async () => {
		await fixture(async f => {
			const body = family === 'lut' ? f.bundles[0]!.lut : f.bundles[0]!.brushes[0]!;
			f.bodies.exec(`CREATE TABLE native_resource_test_parent(id INTEGER PRIMARY KEY);
				CREATE TABLE native_resource_test_child(id INTEGER REFERENCES native_resource_test_parent(id) DEFERRABLE INITIALLY DEFERRED);
				CREATE TRIGGER native_resource_test_commit AFTER INSERT ON native_photo_resources BEGIN INSERT INTO native_resource_test_child(id) VALUES(1); END`);
			try {
				await assert.rejects(put(f.resources, family, body), /FOREIGN KEY constraint failed/u);
				assert.equal(f.bodies.prepare('SELECT COUNT(*) AS count FROM native_photo_resources').get()?.count, 0);
				assert.equal(f.bodies.prepare('SELECT COUNT(*) AS count FROM native_resource_test_child').get()?.count, 0);
			} finally { f.bodies.exec('DROP TRIGGER native_resource_test_commit; DROP TABLE native_resource_test_child; DROP TABLE native_resource_test_parent'); }
			assert.equal((await put(f.resources, family, body)).created, true);
		});
	});
	test(`Lightscaper actual native ${family} COMMIT acknowledgement survives opaque cancellation and reentrant joined close`, async () => {
		await fixture(async f => {
			const body = family === 'lut' ? f.bundles[0]!.lut : f.bundles[0]!.brushes[0]!, cancel = new AbortController();
			let traps = 0, close: Promise<void> | undefined, committed = false;
			const opaque = new Proxy(Object.create(null) as object, { get() { traps++; throw Error('Opaque abort read.'); },
				getPrototypeOf() { traps++; throw Error('Opaque abort prototype.'); }, ownKeys() { traps++; throw Error('Opaque abort keys.'); } });
			const nativeExec = DatabaseSync.prototype.exec, nativePrepare = DatabaseSync.prototype.prepare, active = new WeakSet<DatabaseSync>();
			DatabaseSync.prototype.exec = function (sql: string): void {
				if (sql === 'BEGIN IMMEDIATE') {
					const row = nativePrepare.call(this, 'PRAGMA database_list').get();
					if (typeof row?.file === 'string' && resolve(row.file) === resolve(f.resourcePath)) active.add(this);
				}
				nativeExec.call(this, sql);
				if (sql === 'COMMIT' && active.has(this)) {
					active.delete(this); committed = true; cancel.abort(opaque); close = f.resources.close(); assert.equal(f.resources.close(), close);
				}
				if (sql === 'ROLLBACK') active.delete(this);
			};
			let receipt: Awaited<ReturnType<typeof put>> | undefined, failed = false, failure: unknown;
			try { receipt = await put(f.resources, family, body, cancel.signal); }
			catch (error) { failed = true; failure = error; }
			finally { DatabaseSync.prototype.exec = nativeExec; await close; }
			assert.equal(committed, true); assert.equal(traps, 0); assert.equal(failed, false, 'A known actual resource COMMIT must retain its install ACK.');
			if (failed) { assert.equal(failure, opaque); assert.fail('Durable installation was reported as cancelled.'); }
			assert.equal(receipt?.created, true); assert.deepEqual(receipt?.reference, body.reference);
			assert.equal(f.bodies.prepare('SELECT COUNT(*) AS count FROM native_photo_resources WHERE storage_key=?').get(body.reference.storageKey)?.count, 1);
			const resources = await Resources.open({ appDataPath: f.directory });
			try {
				if (family === 'lut') await (await resources.cubeLutResources()).source.withBytes(normalizeVideoCubeLutReferenceV1(body.reference), bytes => { assert.deepEqual(bytes, body.bytes); });
				else await (await resources.maskRasterResources()).source.withBytes(normalizeBrushMaskResourceReferenceV1(body.reference.storageKey), bytes => { assert.deepEqual(bytes, body.bytes); });
				assert.equal((await put(resources, family, body)).created, false);
			} finally { await resources.close(); }
		});
	});
}
