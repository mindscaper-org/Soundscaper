/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { captureLightscaperNativePhotoMediaMetadataCurrentV1 as capture,
	LIGHTSCAPER_NATIVE_PHOTO_MEDIA_RESERVED_METADATA_CURRENT_V1 as RESERVED } from '../desktop/lightscaper-native-photo-media-metadata-current-v1.ts';
import { installLightscaperNativePhotoMediaStreamAssetCurrentV1 as install,
	getLightscaperNativePhotoMediaAssetCurrentV1 as get } from '../desktop/lightscaper-native-photo-media-assets-current-v1.ts';
import { LIGHTSCAPER_NATIVE_PHOTO_MEDIA_RESERVED_METADATA_CURRENT_V1 as BLOB_RESERVED } from '../desktop/lightscaper-native-photo-media-blob-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as paths,
	lightscaperNativePhotoOriginalBodyPathCurrentV1 as bodyPath } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import type { LightscaperNativeOriginalBindingCurrentV1 as Binding } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import { nativeMediaAssetFixtureCurrentV1 as fixture, type NativeMediaAssetFixtureCurrentV1 as Fixture } from './helpers/lightscaper-native-photo-media-assets-fixture-current.ts';

const BODY = new TextEncoder().encode('genuine streamed file bytes');
function binding(key = 'streamed', bytes = BODY): Readonly<Binding> {
	return Object.freeze({ storageKey: key, byteLength: bytes.byteLength, contentSha256: createHash('sha256').update(bytes).digest('hex') });
}
async function proof(f: Fixture, expected = binding(), bytes = BODY) {
	return f.originals.storeBinding(expected, (async function* () { yield Uint8Array.from(bytes); })());
}

test('Lightscaper native streaming publication detaches metadata before await without constructing a Blob or Photo Original', async () => {
	await fixture(async f => {
		const custom: { number: number; self?: unknown } = { number: 1 }; custom.self = custom;
		const input = { name: '\ud800'.repeat(512), mimeType: 'application/custom', lastModified: 17,
			custom, binary: new Uint16Array([2, 9]), nested: new Blob(['actual metadata body']) };
		const name = input.name, pending = capture('streamed', input); input.name = 'changed'; custom.number = 99; input.binary.fill(0);
		const captured = await pending, expected = binding(), receipt = install(f.db, captured, expected, await proof(f, expected));
		assert.equal(receipt.name, name); assert.equal(receipt.mimeType, 'application/custom'); assert.equal(receipt.lastModified, 17);
		assert.equal((receipt.custom as typeof custom).number, 1); assert.equal((receipt.custom as typeof custom).self, receipt.custom);
		assert.deepEqual(receipt.binary, new Uint16Array([2, 9])); assert.equal(await (receipt.nested as Blob).text(), 'actual metadata body');
		assert.equal(receipt.sourceId, expected.storageKey); assert.equal(receipt.sha256, expected.contentSha256); assert.equal(receipt.size, BODY.byteLength);
		assert.equal(receipt.storage, 'native-photo-original'); assert.equal(Date.parse(String(receipt.pendingProjectUntil)) - Date.parse(String(receipt.committedAt)), 86400000);
		await f.originals.verifyBinding(expected); assert.deepEqual(await readFile(bodyPath(paths(f.appDataPath), expected.contentSha256)), Buffer.from(BODY));
		(receipt.binary as Uint16Array).fill(7); assert.deepEqual(get(f.db, 'streamed')?.binary, new Uint16Array([2, 9]));
	});
});

test('Lightscaper native metadata capture defaults and explicit descriptive overrides preserve Blob capture fallback rules', async () => {
	await fixture(async f => {
		const expected = binding(), captured = await capture('streamed', {}, { name: 'actual fallback', mimeType: 'actual/type', lastModified: 19 });
		const receipt = install(f.db, captured, expected, await proof(f, expected));
		assert.equal(receipt.name, 'actual fallback'); assert.equal(receipt.mimeType, 'actual/type'); assert.equal(receipt.lastModified, 19);
	});
	await fixture(async f => {
		const expected = binding(), captured = await capture('streamed', { name: 'explicit', mimeType: 'custom/type', lastModified: 2.9 },
			{ name: 'fallback', mimeType: 'fallback/type', lastModified: 99 });
		const receipt = install(f.db, captured, expected, await proof(f, expected));
		assert.equal(receipt.name, 'explicit'); assert.equal(receipt.mimeType, 'custom/type'); assert.equal(receipt.lastModified, 2);
	});
	await fixture(async f => {
		const expected = binding(), captured = await capture('streamed', null), receipt = install(f.db, captured, expected, await proof(f, expected));
		assert.equal(receipt.name, ''); assert.equal(receipt.mimeType, ''); assert.equal(receipt.lastModified, 0);
	});
});

test('Lightscaper native stream metadata retains the exact reserved inventory and cannot supply digest/provenance authority', async () => {
	assert.deepEqual(RESERVED, BLOB_RESERVED);
	await fixture(async f => {
		const input = Object.fromEntries(RESERVED.map(key => [key, 'caller-forged']));
		const expected = binding(), captured = await capture('streamed', { ...input, name: 'name', mimeType: 'application/test', custom: 1n });
		const receipt = install(f.db, captured, expected, await proof(f, expected));
		for (const key of RESERVED) if (!['sourceId', 'size', 'sha256', 'storage', 'mimeType', 'committedAt', 'pendingProjectUntil'].includes(key)) assert.equal(Object.hasOwn(receipt, key), false);
		assert.equal(receipt.sourceId, 'streamed'); assert.equal(receipt.sha256, expected.contentSha256); assert.equal(receipt.size, BODY.byteLength);
		assert.equal(receipt.custom, 1n); assert.equal(receipt.mimeType, 'application/test');
	});
});

test('Lightscaper native stream publisher refuses forged opaque captures without reflecting them or consuming a real proof', async () => {
	await fixture(async f => {
		const expected = binding(), physical = await proof(f, expected); let traps = 0;
		const forged = new Proxy({}, { get() { traps++; throw new Error('Forged get'); }, getPrototypeOf() { traps++; throw new Error('Forged prototype'); } });
		assert.throws(() => install(f.db, forged, expected, physical)); assert.equal(traps, 0); assert.equal(get(f.db, 'streamed'), null);
		const captured = await capture('streamed'); assert.throws(() => install(f.db, captured, expected, {}));
		assert.equal(install(f.db, captured, expected, physical).sourceId, 'streamed');
		assert.throws(() => install(f.db, captured, expected, physical));
	});
});

test('Lightscaper native stream publisher requires the captured asset key and all three physical proof fields', async () => {
	await fixture(async f => {
		const expected = binding(), physical = await proof(f, expected), wrongKey = await capture('different-key');
		assert.throws(() => install(f.db, wrongKey, expected, physical)); assert.equal(get(f.db, 'streamed'), null);
		assert.equal(install(f.db, await capture('streamed'), expected, physical).sourceId, 'streamed');
	});
	for (const changed of [{ byteLength: BODY.byteLength + 1 }, { contentSha256: 'f'.repeat(64) }]) await fixture(async f => {
		const expected = binding(), captured = await capture('streamed'), physical = await proof(f, expected);
		assert.throws(() => install(f.db, captured, { ...expected, ...changed }, physical)); assert.equal(get(f.db, 'streamed'), null);
		const fresh = await proof(f, expected); assert.equal(install(f.db, captured, expected, fresh).sha256, expected.contentSha256);
	});
});

test('Lightscaper native stream publisher refuses a real proof from another physical namespace without laundering it', async () => {
	await fixture(async f => {
		const expected = binding(), captured = await capture('streamed'), physical = await proof(f, expected);
		await fixture(async other => { assert.throws(() => install(other.db, captured, expected, physical)); assert.equal(get(other.db, 'streamed'), null); });
		assert.equal(install(f.db, captured, expected, physical).sourceId, 'streamed');
	});
});

test('Lightscaper native stream publisher rejects duplicate immutable IDs and authenticates actual binding at final publication', async () => {
	await fixture(async f => {
		const expected = binding(), captured = await capture('streamed', { name: 'first' }); install(f.db, captured, expected, await proof(f, expected));
		const second = await capture('streamed', { name: 'second' });
		const another = await proof(f, expected); assert.throws(() => install(f.db, second, expected, another)); assert.equal(get(f.db, 'streamed')?.name, 'first');
	});
	await fixture(async f => {
		const expected = binding(), captured = await capture('streamed'), physical = await proof(f, expected);
		f.db.prepare('UPDATE native_photo_original_bindings SET content_sha256=? WHERE storage_key=?').run('f'.repeat(64), expected.storageKey);
		assert.throws(() => install(f.db, captured, expected, physical)); assert.equal(get(f.db, 'streamed'), null);
		assert.deepEqual(await readFile(bodyPath(paths(f.appDataPath), expected.contentSha256)), Buffer.from(BODY));
	});
});

test('Lightscaper native stream SQL INSERT refusal leaves actual bytes safe and requires a fresh physical proof for retry', async () => {
	await fixture(async f => {
		const expected = binding(), captured = await capture('streamed'), physical = await proof(f, expected);
		f.db.exec("CREATE TRIGGER stream_insert_failure BEFORE INSERT ON native_photo_media_assets BEGIN SELECT RAISE(ABORT,'stream insert refusal'); END");
		try { assert.throws(() => install(f.db, captured, expected, physical), /stream insert refusal/u); }
		finally { f.db.exec('DROP TRIGGER stream_insert_failure'); }
		assert.equal(get(f.db, 'streamed'), null); await f.originals.verifyBinding(expected);
		assert.throws(() => install(f.db, captured, expected, physical)); const fresh = await proof(f, expected);
		assert.equal(install(f.db, captured, expected, fresh).sourceId, 'streamed');
	});
});

test('Lightscaper native stream genuine deferred-FK COMMIT refusal rolls back asset metadata and preserves body binding', async () => {
	await fixture(async f => {
		const expected = binding(), captured = await capture('streamed'), physical = await proof(f, expected);
		f.db.exec('CREATE TABLE stream_parent(id INTEGER PRIMARY KEY); CREATE TABLE stream_child(id INTEGER REFERENCES stream_parent(id) DEFERRABLE INITIALLY DEFERRED)');
		f.db.exec('CREATE TRIGGER stream_commit_failure AFTER INSERT ON native_photo_media_assets BEGIN INSERT INTO stream_child VALUES(1); END');
		try { assert.throws(() => install(f.db, captured, expected, physical), /FOREIGN KEY/u); }
		finally { f.db.exec('DROP TRIGGER stream_commit_failure; DROP TABLE stream_child; DROP TABLE stream_parent'); }
		assert.equal(f.db.isTransaction, false); assert.equal(get(f.db, 'streamed'), null); await f.originals.verifyBinding(expected);
	});
});

test('Lightscaper native stream publisher preserves opaque pre-abort and the actual COMMIT ACK without a postcheck', async () => {
	await fixture(async f => {
		const expected = binding(), captured = await capture('streamed'), physical = await proof(f, expected), stop = new AbortController();
		const reason = Proxy.revocable({}, {}); reason.revoke(); stop.abort(reason.proxy);
		try { install(f.db, captured, expected, physical, stop.signal); assert.fail('Expected native cancellation'); } catch (error) { assert.equal(error, reason.proxy); }
		assert.equal(get(f.db, 'streamed'), null);
		const late = new AbortController(), exec = f.db.exec;
		f.db.exec = function (sql: string): void { exec.call(f.db, sql); if (sql === 'COMMIT') late.abort(reason.proxy); };
		try { assert.equal(install(f.db, captured, expected, physical, late.signal).sourceId, 'streamed'); }
		finally { f.db.exec = exec; }
		assert.equal(get(f.db, 'streamed')?.size, BODY.byteLength);
	});
});
