/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { captureLightscaperNativePhotoMediaWriteCurrentV1 as capture,
	digestLightscaperNativePhotoMediaWriteCurrentV1 as digest,
	lightscaperNativePhotoMediaWriteChunksCurrentV1 as chunks } from '../desktop/lightscaper-native-photo-media-blob-current-v1.ts';
import { installLightscaperNativePhotoMediaAssetCurrentV1 as install,
	getLightscaperNativePhotoMediaAssetCurrentV1 as get,
	deleteLightscaperNativePhotoMediaAssetCurrentV1 as remove } from '../desktop/lightscaper-native-photo-media-assets-current-v1.ts';
import { captureLightscaperNativePhotoCustodyRequestCurrentV1 as custody,
	executeLightscaperNativePhotoCustodyRequestCurrentV1 as executeCustody } from '../desktop/lightscaper-native-photo-media-custody-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as paths,
	lightscaperNativePhotoOriginalBodyPathCurrentV1 as bodyPath } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import { nativeMediaAssetFixtureCurrentV1 as fixture, nativeMediaAssetPublicationCurrentV1 as publish } from './helpers/lightscaper-native-photo-media-assets-fixture-current.ts';

const OPTIONS = { concurrency: false };

test('Lightscaper native asset publication binds real files, physical SQL authority and detached lossless metadata', async () => {
	await fixture(async f => {
		const custom: { nested: number; self?: unknown } = { nested: 1 }; custom.self = custom;
		const name = '\ud800'.repeat(512), input = { name, mimeType: 'image/x-lightscaper-hdr', lastModified: 123, custom, binary: new Uint16Array([2, 9]) };
		const capPromise = capture('asset', new Blob(['body']), input); input.name = 'changed'; custom.nested = 2; input.binary.fill(0);
		const captured = await capPromise, binding = await digest(captured), proof = await f.originals.storeBinding(binding, chunks(captured));
		const result = install(f.db, captured, proof); assert.equal(result.name, name); assert.equal(result.mimeType, 'image/x-lightscaper-hdr');
		assert.equal(result.sourceId, 'asset'); assert.equal(result.sha256, binding.contentSha256); assert.equal(result.size, 4);
		assert.equal(result.storage, 'native-photo-original'); assert.equal(result.lastModified, 123);
		assert.equal(Date.parse(String(result.pendingProjectUntil)) - Date.parse(String(result.committedAt)), 24 * 60 * 60 * 1000);
		assert.equal((result.custom as typeof custom).nested, 1); assert.equal((result.custom as typeof custom).self, result.custom);
		assert.deepEqual(result.binary, new Uint16Array([2, 9]));
		(result.binary as Uint16Array).fill(8); assert.deepEqual(get(f.db, 'asset')?.binary, new Uint16Array([2, 9]));
		await f.originals.verifyBinding(binding); assert.deepEqual(await readFile(bodyPath(paths(f.appDataPath), binding.contentSha256)), Buffer.from('body'));
	});
});

test('Lightscaper native assets strip caller provenance and paths while retaining genuine arbitrary metadata', async () => {
	await fixture(async f => {
		const customBlob = new Blob(['metadata']);
		const result = (await publish(f, 'asset', new Blob(['body']), { name: 'name', mimeType: 'application/test', extra: { value: 1n, body: customBlob },
			path: '/foreign/path', sourceId: 'foreign', sha256: 'f'.repeat(64), size: 999, mediaContentToken: 'forged',
			catalogRootCount: 99, mediaContentDigestVersion: 1, storage: 'foreign' })).metadata;
		for (const key of ['path', 'mediaContentToken', 'catalogRootCount', 'mediaContentDigestVersion', 'blob', 'mediaChunkToken']) assert.equal(Object.hasOwn(result, key), false);
		assert.equal(result.sourceId, 'asset'); assert.equal(result.size, 4); assert.equal(result.storage, 'native-photo-original');
		const extra = result.extra as { value: bigint; body: Blob }; assert.equal(extra.value, 1n); assert.equal(await extra.body.text(), 'metadata');
	});
});

test('Lightscaper native assets require genuine matching one-use physical proof and reject duplicate published IDs', async () => {
	await fixture(async f => {
		const { captured, proof } = await publish(f);
		assert.throws(() => install(f.db, captured, proof)); assert.throws(() => install(f.db, captured, {}));
		const copy = await capture('asset', new Blob(['actual immutable managed bytes']), {}), binding = await digest(copy);
		const second = await f.originals.storeBinding(binding, chunks(copy)); assert.throws(() => install(f.db, copy, second));
		assert.equal(get(f.db, 'asset')?.size, binding.byteLength);
	});
});

test('Lightscaper native asset proof cannot publish another capture or another physical namespace', async () => {
	await fixture(async f => {
		const one = await capture('one', new Blob(['same length']), {}), two = await capture('one', new Blob(['other bytes']), {});
		const binding = await digest(one); await digest(two); const proof = await f.originals.storeBinding(binding, chunks(one));
		assert.throws(() => install(f.db, two, proof)); assert.equal(get(f.db, 'one'), null);
		const fresh = await f.originals.storeBinding(binding, chunks(one));
		await fixture(async other => { assert.throws(() => install(other.db, one, fresh)); });
		assert.equal(install(f.db, one, fresh).sourceId, 'one');
	});
});

test('Lightscaper native asset INSERT refusal leaves a safe physical orphan and permits a fresh proof retry', async () => {
	await fixture(async f => {
		const captured = await capture('asset', new Blob(['body']), {}), binding = await digest(captured), proof = await f.originals.storeBinding(binding, chunks(captured));
		f.db.exec("CREATE TRIGGER media_insert_failure BEFORE INSERT ON native_photo_media_assets BEGIN SELECT RAISE(ABORT,'media insert refusal'); END");
		try { assert.throws(() => install(f.db, captured, proof), /media insert refusal/u); }
		finally { f.db.exec('DROP TRIGGER media_insert_failure'); }
		assert.equal(get(f.db, 'asset'), null); await f.originals.verifyBinding(binding);
		const retry = await f.originals.storeBinding(binding, chunks(captured)); assert.equal(install(f.db, captured, retry).sourceId, 'asset');
	});
});

test('Lightscaper native asset actual deferred-FK COMMIT refusal rolls back metadata while preserving body binding', async () => {
	await fixture(async f => {
		const captured = await capture('asset', new Blob(['body']), {}), binding = await digest(captured), proof = await f.originals.storeBinding(binding, chunks(captured));
		f.db.exec('CREATE TABLE asset_fault_parent(id INTEGER PRIMARY KEY); CREATE TABLE asset_fault_child(id INTEGER REFERENCES asset_fault_parent(id) DEFERRABLE INITIALLY DEFERRED)');
		f.db.exec('CREATE TRIGGER asset_commit_failure AFTER INSERT ON native_photo_media_assets BEGIN INSERT INTO asset_fault_child VALUES(1); END');
		try { assert.throws(() => install(f.db, captured, proof), /FOREIGN KEY/u); }
		finally { f.db.exec('DROP TRIGGER asset_commit_failure; DROP TABLE asset_fault_child; DROP TABLE asset_fault_parent'); }
		assert.equal(f.db.isTransaction, false); assert.equal(get(f.db, 'asset'), null); await f.originals.verifyBinding(binding);
	});
});

test('Lightscaper native asset deletion joins binding retirement atomically and permits different-byte recreation', async () => {
	await fixture(async f => {
		const first = await publish(f); remove(f.db, 'asset'); assert.equal(get(f.db, 'asset'), null);
		await assert.rejects(f.originals.verifyBinding(first.binding));
		assert.deepEqual(await readFile(bodyPath(paths(f.appDataPath), first.binding.contentSha256)), Buffer.from('actual immutable managed bytes'));
		const second = await publish(f, 'asset', new Blob(['different bytes'])); await f.originals.verifyBinding(second.binding);
		assert.notEqual(second.binding.contentSha256, first.binding.contentSha256);
	});
});

test('Lightscaper native asset absent-metadata deletion preserves a legacy physical binding', async () => {
	await fixture(async f => {
		const captured = await capture('legacy', new Blob(['legacy body']), {}), binding = await digest(captured);
		await f.originals.storeBinding(binding, chunks(captured)); remove(f.db, 'legacy'); await f.originals.verifyBinding(binding);
	});
});

test('Lightscaper native asset deletion refuses real permanent and staged roots even with a corrupt zero count', async () => {
	for (const staged of [false, true]) await fixture(async f => {
		const { binding } = await publish(f);
		const reference = { photoId: 'photo', sourceId: 'source', assetId: binding.storageKey, sha256: binding.contentSha256, size: binding.byteLength };
		executeCustody(f.db, custody(staged ? 'stage' : 'retain', staged ? ['catalog', 'import', [reference]] : ['catalog', [reference]]));
		assert.throws(() => remove(f.db, 'asset')); f.db.prepare('UPDATE native_photo_media_assets SET root_count=0 WHERE source_id=?').run('asset');
		assert.throws(() => remove(f.db, 'asset')); assert.ok(get(f.db, 'asset')); await f.originals.verifyBinding(binding);
	});
});

test('Lightscaper native asset deletion SQL failure rolls back both metadata and Original binding', async () => {
	await fixture(async f => {
		const { binding } = await publish(f);
		f.db.exec("CREATE TRIGGER binding_delete_failure BEFORE DELETE ON native_photo_original_bindings BEGIN SELECT RAISE(ABORT,'binding delete refusal'); END");
		try { assert.throws(() => remove(f.db, 'asset'), /binding delete refusal/u); }
		finally { f.db.exec('DROP TRIGGER binding_delete_failure'); }
		assert.ok(get(f.db, 'asset')); await f.originals.verifyBinding(binding);
	});
});

test('Lightscaper native asset reads refuse metadata corruption and scalar disagreement with real binding', async () => {
	for (const mode of ['metadata', 'sha', 'size', 'token', 'stamp'] as const) await fixture(async f => {
		await publish(f);
		const changes = { metadata: "metadata=x'00'", sha: `sha256='${'a'.repeat(64)}'`, size: 'size=size+1',
			token: "media_content_token='media-content-0000000000000000'", stamp: "pending_until=strftime('%Y-%m-%dT%H:%M:%fZ',committed_at,'+1 hour')" };
		// A canonical but different token remains a valid generation. Other
		// corruptions must never escape as authenticated asset metadata.
		if (mode === 'sha' || mode === 'size') {
			assert.throws(() => f.db.exec(`UPDATE native_photo_media_assets SET ${changes[mode]} WHERE source_id='asset'`), /FOREIGN KEY/iu);
			assert.ok(get(f.db, 'asset')); return;
		}
		f.db.exec(`UPDATE native_photo_media_assets SET ${changes[mode]} WHERE source_id='asset'`);
		if (mode === 'token') assert.ok(get(f.db, 'asset')); else assert.throws(() => get(f.db, 'asset'));
	});
});

test('Lightscaper native asset pre-abort preserves opaque reason and post-COMMIT cancellation preserves its ACK', OPTIONS, async () => {
	await fixture(async f => {
		const captured = await capture('asset', new Blob(['body']), {}), binding = await digest(captured), proof = await f.originals.storeBinding(binding, chunks(captured));
		const stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke(); stop.abort(reason.proxy);
		try { install(f.db, captured, proof, stop.signal); assert.fail('Expected refusal.'); } catch (error) { assert.equal(error, reason.proxy); }
		assert.equal(get(f.db, 'asset'), null);
		const late = new AbortController(), exec = f.db.exec;
		f.db.exec = function (sql: string): void { exec.call(this, sql); if (sql.trim() === 'COMMIT') late.abort(reason.proxy); };
		try { assert.equal(install(f.db, captured, proof, late.signal).sourceId, 'asset'); }
		finally { f.db.exec = exec; }
		assert.ok(get(f.db, 'asset'));
	});
});
