/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { assert, dirname, nativeOriginalInspectionFixtureCurrentV1 as fixture,
	INSPECTION_OPTIONS_CURRENT_V1 as options, type InspectionFixtureCurrentV1 as Fixture } from './helpers/lightscaper-native-original-inspection-fixture-current.ts';

function repair(f: Fixture, body = new Blob([Uint8Array.from(f.bytes)]), binding: unknown = f.binding, signal = f.signal): Promise<unknown> {
	const method: unknown = Reflect.get(f.media, 'restoreCatalogOriginalBody');
	assert.equal(typeof method, 'function', 'genuine native Media must implement exact Original repair');
	return f.track(Promise.resolve(Reflect.apply(method as (...args: unknown[]) => unknown, f.media, [binding, body, { signal }])));
}
function receipt(f: Fixture) { return { assetId: f.binding.assetId, sha256: f.binding.sha256, size: f.binding.size }; }
function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function generation(f: Fixture): string {
	const row = f.db.prepare('SELECT locator_id FROM native_photo_original_body_heads WHERE content_sha256=?').get(f.binding.sha256);
	assert.ok(row && typeof row.locator_id === 'string' && /^[a-f0-9]{64}$/u.test(row.locator_id));
	return join(dirname(f.path), `${f.binding.sha256}.${row.locator_id}.body`);
}

void test('Lightscaper native exact repair publishes a fresh inode and preserves logical custody and hostile metadata bytes', options, async t => {
	await fixture(t, async f => {
		const before = await stat(f.path, { bigint: true });
		f.db.exec('UPDATE native_photo_media_assets SET metadata=zeroblob(8192)');
		const original = f.db.prepare('SELECT media_content_token,hex(metadata) AS metadata,committed_at,pending_until FROM native_photo_media_assets').get();
		const roots = f.db.prepare('SELECT hex(root_key) AS key,root FROM native_photo_media_roots').all();
		const corrupt = Uint8Array.from(f.bytes); corrupt[0] = (corrupt[0] ?? 0) ^ 1; await writeFile(f.path, corrupt);
		assert.deepEqual(await repair(f), receipt(f));
		const path = generation(f), after = await stat(path, { bigint: true });
		assert.notEqual(after.ino, before.ino); assert.equal(digest(await readFile(path)), f.binding.sha256);
		assert.equal(digest(await readFile(f.path)), digest(corrupt));
		assert.deepEqual(f.db.prepare('SELECT media_content_token,hex(metadata) AS metadata,committed_at,pending_until FROM native_photo_media_assets').get(), original);
		assert.deepEqual(f.db.prepare('SELECT hex(root_key) AS key,root FROM native_photo_media_roots').all(), roots);
		assert.deepEqual(await f.inspect(), { status: 'present' });
	});
});

void test('Lightscaper native exact repair restores an absent physical body without overwriting its legacy path', options, async t => {
	await fixture(t, async f => {
		await rm(f.path); assert.deepEqual(await repair(f), receipt(f));
		await assert.rejects(stat(f.path), { code: 'ENOENT' });
		assert.equal(digest(await readFile(generation(f))), f.binding.sha256);
		assert.deepEqual(await f.inspect(), { status: 'present' });
	});
});

void test('Lightscaper native exact repair recreates its positively absent managed body directory', options, async t => {
	await fixture(t, async f => {
		await rm(f.paths.bodiesRoot, { recursive: true }); assert.deepEqual(await f.inspect(), { status: 'missing', reason: 'directory' });
		assert.deepEqual(await repair(f), receipt(f)); assert.equal(digest(await readFile(generation(f))), f.binding.sha256);
		assert.deepEqual(await f.inspect(), { status: 'present' });
	});
});

void test('Lightscaper native exact repair refuses a missing staging directory without recreating it', options, async t => {
	await fixture(t, async f => {
		await rm(f.paths.stagingRoot, { recursive: true }); await assert.rejects(repair(f));
		await assert.rejects(stat(f.paths.stagingRoot), { code: 'ENOENT' });
		assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM native_photo_original_body_heads').get()?.n, 0);
	});
});

void test('Lightscaper native exact repair refuses a symlinked body root and preserves foreign bytes', options, async t => {
	await fixture(t, async f => {
		const moved = f.paths.bodiesRoot + '.foreign'; await rename(f.paths.bodiesRoot, moved); await symlink(moved, f.paths.bodiesRoot, 'dir');
		try { await assert.rejects(repair(f)); assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM native_photo_original_body_heads').get()?.n, 0); }
		finally { await rm(f.paths.bodiesRoot); await rename(moved, f.paths.bodiesRoot); }
		assert.equal(digest(await readFile(f.path)), f.binding.sha256);
	});
});

void test('Lightscaper native exact repair reconstructs missing media and physical binding only from retained exact custody', options, async t => {
	await fixture(t, async f => {
		const token = f.db.prepare('SELECT media_content_token FROM native_photo_media_assets').get()?.media_content_token;
		f.db.exec('PRAGMA foreign_keys=OFF; DELETE FROM native_photo_media_assets; DELETE FROM native_photo_original_bindings');
		await rm(f.path); assert.deepEqual(await repair(f), receipt(f));
		const stored = f.db.prepare('SELECT media_content_token,root_count FROM native_photo_media_assets').get();
		assert.equal(stored?.media_content_token, token); assert.equal(stored?.root_count, 1);
		const metadata = await f.media.getAssetMetadata(f.binding.assetId);
		assert.equal(metadata?.name, f.binding.name); assert.equal(metadata?.mimeType, f.binding.mimeType);
		assert.deepEqual(await f.inspect(), { status: 'present' });
	});
});

void test('Lightscaper native exact repair rejects wrong selected bytes before reserving a generation', options, async t => {
	await fixture(t, async f => {
		const changed = Uint8Array.from(f.bytes); changed[0] = (changed[0] ?? 0) ^ 1;
		await assert.rejects(repair(f, new Blob([changed])));
		assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM native_photo_original_body_locators').get()?.n, 0);
		assert.deepEqual(await f.inspect(), { status: 'present' });
	});
});

void test('Lightscaper native exact repair requires the exact selected import root', options, async t => {
	await fixture(t, async f => {
		await assert.rejects(repair(f, new Blob([Uint8Array.from(f.bytes)]), { ...f.binding, importId: 'wrong-import' }));
		assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM native_photo_original_body_heads').get()?.n, 0);
		assert.deepEqual(await f.inspect(), { status: 'present' });
	});
});

void test('Lightscaper native exact repair keeps a real head COMMIT acknowledgment through late cancellation', options, async t => {
	await fixture(t, async f => {
		const stop = new AbortController(), descriptor = Object.getOwnPropertyDescriptor(DatabaseSync.prototype, 'exec');
		assert.ok(descriptor && typeof descriptor.value === 'function'); const native = descriptor.value as DatabaseSync['exec']; let committed = false;
		Object.defineProperty(DatabaseSync.prototype, 'exec', { ...descriptor, value: function (this: DatabaseSync, sql: string) {
			const selected = sql === 'COMMIT' && this.isTransaction && this.prepare('SELECT 1 FROM native_photo_original_body_heads LIMIT 1').get();
			const result = Reflect.apply(native, this, [sql]);
			if (selected && !committed) { committed = true; stop.abort(new Error('Late abort after actual repair COMMIT')); }
			return result;
		} });
		try { assert.deepEqual(await repair(f, new Blob([Uint8Array.from(f.bytes)]), f.binding, stop.signal), receipt(f)); assert.equal(committed, true); }
		finally { Object.defineProperty(DatabaseSync.prototype, 'exec', descriptor); }
		assert.deepEqual(await f.inspect(), { status: 'present' });
	});
});
