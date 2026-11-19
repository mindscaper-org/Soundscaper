/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { constants, type DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { captureLightscaperNativePhotoCustodyRequestCurrentV1 as capture,
	executeLightscaperNativePhotoCustodyRequestCurrentV1 as execute } from '../desktop/lightscaper-native-photo-media-custody-current-v1.ts';
import { deleteLightscaperNativePhotoMediaAssetCurrentV1 as removeAsset } from '../desktop/lightscaper-native-photo-media-assets-current-v1.ts';
import { catalogOriginalKey, type CatalogOriginalReferenceV1 } from '../src/common/editor/storage/media-catalog-original-schema.ts';
import { nativeMediaAssetFixtureCurrentV1 as fixture, nativeMediaAssetPublicationCurrentV1 as publish } from './helpers/lightscaper-native-photo-media-assets-fixture-current.ts';

const count = (db: DatabaseSync, id = 'asset') => db.prepare('SELECT root_count FROM native_photo_media_assets WHERE source_id=?').get(id)?.root_count;
const reference = (photoId: string, binding: Readonly<{ storageKey: string; contentSha256: string; byteLength: number }>): CatalogOriginalReferenceV1 =>
	({ photoId, assetId: binding.storageKey, sourceId: `source-${photoId}`, sha256: binding.contentSha256, size: binding.byteLength });
function page(db: DatabaseSync, importId: string | null = null, afterKey: string | null = null) {
	const value = execute(db, capture('readPage', [{ catalogId: 'catalog', importId, afterKey }]));
	assert.ok(value && 'roots' in value); return value;
}
function digest(db: DatabaseSync, sha256: string, afterAssetId: string | null = null) {
	const value = execute(db, capture('findDigestPage', [sha256, afterAssetId]));
	assert.ok(value && 'matches' in value); return value;
}

test('Lightscaper native custody uses genuine staged/permanent roots and exactly-once counts through all lifecycle methods', async () => {
	await fixture(async f => {
		const { binding } = await publish(f), ref = reference('photo', binding);
		execute(f.db, capture('stage', ['catalog', 'import', [ref]])); execute(f.db, capture('stage', ['catalog', 'import', [ref]]));
		assert.equal(count(f.db), 1); assert.equal(page(f.db, 'import').roots.length, 1); assert.equal(page(f.db).roots.length, 0);
		execute(f.db, capture('retain', ['catalog', [ref]])); assert.equal(count(f.db), 2);
		execute(f.db, capture('promote', ['catalog', 'import', ['photo']])); assert.equal(count(f.db), 1);
		assert.equal(page(f.db, 'import').roots.length, 0); assert.equal(page(f.db).roots[0]?.sourceId, ref.sourceId);
		assert.throws(() => execute(f.db, capture('promote', ['catalog', 'import', ['photo']]))); assert.equal(count(f.db), 1);
		execute(f.db, capture('releaseStaged', ['catalog', 'import', ['photo']])); assert.equal(count(f.db), 1);
		execute(f.db, capture('release', ['catalog', ['photo']])); execute(f.db, capture('release', ['catalog', ['photo']]));
		assert.equal(count(f.db), 0); await f.originals.verifyBinding(binding); assert.equal(digest(f.db, binding.contentSha256).matches.length, 1);
	});
});

test('Lightscaper native custody promotes a real staged-only root atomically without a count gap', async () => {
	await fixture(async f => {
		const { binding } = await publish(f); execute(f.db, capture('stage', ['catalog', 'import', [reference('photo', binding)]]));
		execute(f.db, capture('promote', ['catalog', 'import', ['photo']]));
		assert.equal(count(f.db), 1); assert.equal(page(f.db, 'import').roots.length, 0);
		const root = page(f.db).roots[0]; assert.ok(root); assert.equal(root.importId, null); assert.equal(root.assetId, binding.storageKey);
	});
});

test('Lightscaper native custody captures immutable references before waits and refuses duplicate, sparse, oversized and accessor batches', async () => {
	await fixture(async f => {
		const { binding } = await publish(f), ref = { ...reference('photo', binding) }, refs = [ref];
		const packet = capture('retain', ['catalog', refs]); ref.photoId = 'changed'; refs.length = 0;
		execute(f.db, packet); assert.equal(page(f.db).roots[0]?.photoId, 'photo');
		let getterCalls = 0; const access = { ...reference('other', binding), get sha256() { getterCalls += 1; return binding.contentSha256; } };
		assert.throws(() => capture('retain', ['catalog', [access]])); assert.equal(getterCalls, 0);
		assert.throws(() => capture('retain', ['catalog', [reference('same', binding), reference('same', binding)]]));
		assert.throws(() => capture('release', ['catalog', ['same', 'same']]));
		assert.throws(() => capture('retain', ['catalog', Array.from({ length: 17 }, (_, i) => reference(String(i), binding))]));
		assert.throws(() => capture('release', ['catalog', new Array(1)]));
		assert.throws(() => execute(f.db, { ...packet })); assert.equal(count(f.db), 1);
	});
});

test('Lightscaper native custody refuses immutable-root changes and rolls back earlier roots when a later reference has no verified asset', async () => {
	await fixture(async f => {
		const { binding } = await publish(f), ref = reference('photo', binding); execute(f.db, capture('retain', ['catalog', [ref]]));
		assert.throws(() => execute(f.db, capture('retain', ['catalog', [{ ...ref, sourceId: 'other-logical-source' }]])));
		assert.throws(() => execute(f.db, capture('stage', ['catalog', 'import', [reference('one', binding), { ...reference('two', binding), assetId: 'missing' }]])));
		assert.equal(count(f.db), 1); assert.equal(page(f.db, 'import').roots.length, 0); assert.equal(page(f.db).roots[0]?.sourceId, ref.sourceId);
	});
});

test('Lightscaper native custody SQL count failure rolls back the complete batch and preserves genuine file bindings', async () => {
	await fixture(async f => {
		const { binding } = await publish(f);
		f.db.exec("CREATE TRIGGER custody_count_failure BEFORE UPDATE OF root_count ON native_photo_media_assets WHEN NEW.root_count=2 BEGIN SELECT RAISE(ABORT,'second root refusal'); END");
		try { assert.throws(() => execute(f.db, capture('retain', ['catalog', [reference('one', binding), reference('two', binding)]])), /second root refusal/u); }
		finally { f.db.exec('DROP TRIGGER custody_count_failure'); }
		assert.equal(count(f.db), 0); assert.equal(page(f.db).roots.length, 0); await f.originals.verifyBinding(binding);
	});
});

test('Lightscaper native custody genuine deferred-FK COMMIT refusal rolls back roots and counts', async () => {
	await fixture(async f => {
		const { binding } = await publish(f);
		f.db.exec('CREATE TABLE custody_parent(id INTEGER PRIMARY KEY); CREATE TABLE custody_child(id INTEGER REFERENCES custody_parent(id) DEFERRABLE INITIALLY DEFERRED)');
		f.db.exec('CREATE TRIGGER custody_commit_failure AFTER INSERT ON native_photo_media_roots BEGIN INSERT INTO custody_child VALUES(1); END');
		try { assert.throws(() => execute(f.db, capture('retain', ['catalog', [reference('photo', binding)]])), /FOREIGN KEY/u); }
		finally { f.db.exec('DROP TRIGGER custody_commit_failure; DROP TABLE custody_child; DROP TABLE custody_parent'); }
		assert.equal(f.db.isTransaction, false); assert.equal(count(f.db), 0); assert.equal(page(f.db).roots.length, 0);
	});
});

test('Lightscaper native custody root pages seek by UTF16 units and resume after their cursor roots were deleted', async () => {
	await fixture(async f => {
		const { binding } = await publish(f), ids = [...Array.from({ length: 128 }, (_, i) => `photo-${String(i).padStart(3, '0')}`), '\ue000', '😀'];
		for (let start = 0; start < ids.length; start += 16) execute(f.db, capture('stage', ['catalog', 'import', ids.slice(start, start + 16).map(id => reference(id, binding))]));
		const expected = ids.map(id => catalogOriginalKey('catalog', 'import', id)).sort(), first = page(f.db, 'import');
		assert.equal(first.roots.length, 64); assert.deepEqual(first.roots.map(root => root.key), expected.slice(0, 64)); assert.ok(first.afterKey);
		for (let start = 0; start < first.roots.length; start += 16) execute(f.db, capture('releaseStaged', ['catalog', 'import', first.roots.slice(start, start + 16).map(root => root.photoId)]));
		const second = page(f.db, 'import', first.afterKey), last = page(f.db, 'import', second.afterKey);
		assert.equal(second.roots.length, 64); assert.equal(last.roots.length, 2); assert.equal(last.afterKey, null);
		assert.deepEqual([...second.roots, ...last.roots].map(root => root.key), expected.slice(64)); assert.equal(count(f.db), 66);
	});
});

test('Lightscaper native digest inventory returns genuine published assets in bounded pages with deleted-cursor resume', async () => {
	await fixture(async f => {
		let sha256 = '';
		for (let index = 0; index < 65; index += 1) sha256 = (await publish(f, `asset-${String(index).padStart(3, '0')}`, new Blob(['same body']))).binding.contentSha256;
		const first = digest(f.db, sha256); assert.equal(first.matches.length, 64); assert.equal(first.afterAssetId, 'asset-063');
		assert.ok(first.matches.every(item => item.sha256 === sha256 && item.size === 9));
		// Retiring the cursor row is legal; continuation authority is its scalar
		// ordered position, not the continued existence of that asset.
		removeAsset(f.db, 'asset-063');
		const last = digest(f.db, sha256, first.afterAssetId); assert.deepEqual(last.matches.map(item => item.assetId), ['asset-064']); assert.equal(last.afterAssetId, null);
	});
});

test('Lightscaper native custody authenticates current generation and physical key/scalar identity before returning or deleting retained roots', async () => {
	for (const corruption of ['token', 'native-key', 'binding'] as const) await fixture(async f => {
		const { binding } = await publish(f); execute(f.db, capture('retain', ['catalog', [reference('photo', binding)]]));
		if (corruption === 'token') f.db.exec("UPDATE native_photo_media_assets SET media_content_token='media-content-0000000000000000'");
		else if (corruption === 'native-key') f.db.prepare('UPDATE native_photo_media_roots SET root_key=?').run(Uint8Array.of(0, 1));
		else {
			const corrupt = () => f.db.prepare('UPDATE native_photo_original_bindings SET content_sha256=?').run('f'.repeat(64));
			assert.throws(corrupt, /FOREIGN KEY/u);
			// Bypass only this forensic writer to exercise detection of disk corruption.
			f.db.exec('PRAGMA foreign_keys=OFF');
			try { corrupt(); } finally { f.db.exec('PRAGMA foreign_keys=ON'); }
			assert.equal(f.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1);
		}
		assert.throws(() => page(f.db));
		if (corruption === 'native-key') execute(f.db, capture('release', ['catalog', ['photo']]));
		else assert.throws(() => execute(f.db, capture('release', ['catalog', ['photo']])));
		assert.equal(count(f.db), 1);
	});
});

test('Lightscaper native custody captures real signal first and preserves opaque cancellation without evaluating borrowed getters', () => {
	const controller = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke(); controller.abort(reason.proxy);
	let touches = 0; const refs = new Proxy([], { getOwnPropertyDescriptor() { touches += 1; throw new Error('borrowed array touched'); } });
	try { capture('retain', ['catalog', refs, { signal: controller.signal }]); assert.fail('Expected cancellation'); }
	catch (error) { assert.equal(error, reason.proxy); } assert.equal(touches, 0);
	const active = new AbortController(), late = new Error('late native cancellation');
	const trapped = new Proxy([], { getOwnPropertyDescriptor() { active.abort(late); throw new Error('losing normalization error'); } });
	assert.throws(() => capture('retain', ['catalog', trapped, { signal: active.signal }]), error => error === late);
});

test('Lightscaper native custody successful COMMIT keeps its write ACK while later reads observe cancellation', async () => {
	await fixture(async f => {
		const { binding } = await publish(f), stop = new AbortController(), reason = new Error('after ACK'), original = f.db.exec;
		f.db.exec = function (sql: string): void { original.call(f.db, sql); if (sql === 'COMMIT') stop.abort(reason); };
		try { assert.equal(execute(f.db, capture('retain', ['catalog', [reference('photo', binding)]]), stop.signal), undefined); }
		finally { f.db.exec = original; }
		assert.equal(count(f.db), 1); assert.throws(() => execute(f.db, capture('readPage', [{ catalogId: 'catalog' }]), stop.signal), error => error === reason);
	});
});

test('Lightscaper native custody preserves rollback failure and refuses dirty reads until the real transaction retires', async () => {
	await fixture(async f => {
		const { binding } = await publish(f);
		f.db.exec("CREATE TRIGGER custody_late_failure BEFORE UPDATE OF root_count ON native_photo_media_assets WHEN NEW.root_count=2 BEGIN SELECT RAISE(ABORT,'late root SQL failure'); END");
		f.db.setAuthorizer((action, transaction) => action === constants.SQLITE_TRANSACTION && transaction === 'ROLLBACK' ? constants.SQLITE_DENY : constants.SQLITE_OK);
		try {
			assert.throws(() => execute(f.db, capture('retain', ['catalog', [reference('one', binding), reference('two', binding)]])), error =>
				error instanceof AggregateError && error.errors.length === 2 && String(error.errors[0]).includes('late root SQL failure'));
			assert.equal(f.db.isTransaction, true); assert.throws(() => page(f.db), /transaction/iu); assert.throws(() => digest(f.db, binding.contentSha256), /transaction/iu);
		} finally { f.db.setAuthorizer(null); if (f.db.isTransaction) f.db.exec('ROLLBACK'); f.db.exec('DROP TRIGGER custody_late_failure'); }
		assert.equal(count(f.db), 0); assert.equal(page(f.db).roots.length, 0);
	});
});
