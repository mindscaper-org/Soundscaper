/* SPDX-License-Identifier: AGPL-3.0-only */

import { open, type FileHandle } from 'node:fs/promises';
import { constants, DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { LightscaperNativePhotoMediaCurrentV1 as Media } from '../desktop/lightscaper-native-photo-media-current-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { assert, nativeOriginalInspectionFixtureCurrentV1 as fixture,
	INSPECTION_OPTIONS_CURRENT_V1 as options, type InspectionFixtureCurrentV1 as Fixture } from './helpers/lightscaper-native-original-inspection-fixture-current.ts';

function repair(f: Fixture): Promise<unknown> {
	const method: unknown = Reflect.get(f.media, 'restoreCatalogOriginalBody');
	assert.equal(typeof method, 'function');
	return f.track(Promise.resolve(Reflect.apply(method as (...args: unknown[]) => unknown, f.media, [f.binding, new Blob([Uint8Array.from(f.bytes)]), { signal: f.signal }])));
}
const receipt = (f: Fixture) => ({ assetId: f.binding.assetId, sha256: f.binding.sha256, size: f.binding.size });

/** Hold the receipt of an actual staging-file fsync. The test deadline actively
 * releases the receipt and fixture.track joins repair before restoring hooks. */
async function holdSync(t: TestContext, f: Fixture, consume: (gate: Readonly<{ entered: Promise<void>; release(): void }>) => Promise<void>): Promise<PromiseSettledResult<unknown>> {
	const witness = await open(f.path, 'r'), prototype = Object.getPrototypeOf(witness) as object;
	const descriptor = Object.getOwnPropertyDescriptor(prototype, 'sync'); await witness.close();
	assert.ok(descriptor && typeof descriptor.value === 'function'); const native = descriptor.value as FileHandle['sync'];
	const entered = deferred<void>(), released = deferred<void>(); let held = false;
	const release = (): void => { entered.resolve(); released.resolve(); };
	t.signal.addEventListener('abort', release, { once: true });
	Object.defineProperty(prototype, 'sync', { ...descriptor, value: function (this: FileHandle) {
		const work = Reflect.apply(native, this, []) as Promise<void>;
		return work.then(async () => { if (!held && (await this.stat()).isFile()) { held = true; entered.resolve(); await released.promise; } });
	} });
	if (t.signal.aborted) release();
	let accepted: Promise<unknown> | undefined;
	try {
		accepted = repair(f); void accepted.catch(() => undefined);
		await Promise.race([entered.promise, accepted.then(() => { throw new Error('Repair ended before its real fsync barrier.'); })]);
		t.signal.throwIfAborted(); await consume({ entered: entered.promise, release });
	}
	finally { release(); if (accepted) await Promise.allSettled([accepted]); t.signal.removeEventListener('abort', release); Object.defineProperty(prototype, 'sync', descriptor); }
	return (await Promise.allSettled([accepted]))[0]!;
}

void test('Lightscaper native repair preserves fresh descriptive edits and added legitimate retained owners during file work', options, async t => {
	await fixture(t, async f => {
		const second = await Media.open({ appDataPath: f.appDataPath });
		try {
			const result = await holdSync(t, f, async gate => {
				await second.catalogOriginals.retain('catalog', [{ photoId: 'added', assetId: f.binding.assetId, sourceId: 'added-source', sha256: f.binding.sha256, size: f.binding.size }]);
				f.db.exec('UPDATE native_photo_media_assets SET metadata=zeroblob(12345)'); gate.release();
			});
			assert.equal(result.status, 'fulfilled'); if (result.status === 'fulfilled') assert.deepEqual(result.value, receipt(f));
			assert.equal(f.db.prepare('SELECT root_count FROM native_photo_media_assets').get()?.root_count, 2);
			assert.equal(f.db.prepare('SELECT length(metadata) AS n FROM native_photo_media_assets').get()?.n, 12345);
			assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM native_photo_original_body_heads').get()?.n, 1);
			assert.deepEqual(await f.inspect(), { status: 'present' });
		} finally { await second.close(); }
	});
});

void test('Lightscaper native repair refuses removed exact custody after the actual fresh file fsync', options, async t => {
	await fixture(t, async f => {
		const result = await holdSync(t, f, async gate => {
			f.db.exec('DELETE FROM native_photo_media_roots; UPDATE native_photo_media_assets SET root_count=0'); gate.release();
		});
		assert.equal(result.status, 'rejected');
		assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM native_photo_original_body_heads').get()?.n, 0);
		assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM native_photo_original_body_locators WHERE layout='generation-v1'").get()?.n, 1);
	});
});

void test('Lightscaper native repair refuses contradictory same-digest lengths before any generation reservation', options, async t => {
	await fixture(t, async f => {
		f.db.prepare('INSERT INTO native_photo_original_bindings VALUES(?,?,?)').run('contradictory', f.binding.sha256, f.binding.size + 1);
		await assert.rejects(repair(f));
		assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM native_photo_original_body_locators').get()?.n, 0);
	});
});

void test('Lightscaper native repair reconciles a thrown receipt after an actual committed head', options, async t => {
	await fixture(t, async f => {
		const descriptor = Object.getOwnPropertyDescriptor(DatabaseSync.prototype, 'exec');
		assert.ok(descriptor && typeof descriptor.value === 'function'); const native = descriptor.value as DatabaseSync['exec']; let injected = false;
		Object.defineProperty(DatabaseSync.prototype, 'exec', { ...descriptor, value: function (this: DatabaseSync, sql: string) {
			const selected = !injected && sql === 'COMMIT' && this.isTransaction && this.prepare('SELECT 1 FROM native_photo_original_body_heads LIMIT 1').get();
			const result = Reflect.apply(native, this, [sql]);
			if (selected) { injected = true; throw new Error('Real repair COMMIT succeeded but its receipt was lost'); } return result;
		} });
		try { assert.deepEqual(await repair(f), receipt(f)); assert.equal(injected, true); }
		finally { Object.defineProperty(DatabaseSync.prototype, 'exec', descriptor); }
		assert.deepEqual(await f.inspect(), { status: 'present' });
	});
});

void test('Lightscaper native repair rolls an actually denied COMMIT back and releases admission for a retry', options, async t => {
	await fixture(t, async f => {
		const descriptor = Object.getOwnPropertyDescriptor(DatabaseSync.prototype, 'exec');
		assert.ok(descriptor && typeof descriptor.value === 'function'); const native = descriptor.value as DatabaseSync['exec']; let denied = false;
		Object.defineProperty(DatabaseSync.prototype, 'exec', { ...descriptor, value: function (this: DatabaseSync, sql: string) {
			const selected = !denied && sql === 'COMMIT' && this.isTransaction && this.prepare('SELECT 1 FROM native_photo_original_body_heads LIMIT 1').get();
			if (!selected) return Reflect.apply(native, this, [sql]);
			denied = true; this.setAuthorizer((action, name) => action === constants.SQLITE_TRANSACTION && name === 'COMMIT' ? constants.SQLITE_DENY : constants.SQLITE_OK);
			try { return Reflect.apply(native, this, [sql]); } finally { this.setAuthorizer(null); }
		} });
		try { await assert.rejects(repair(f)); assert.equal(denied, true); }
		finally { Object.defineProperty(DatabaseSync.prototype, 'exec', descriptor); }
		assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM native_photo_original_body_heads').get()?.n, 0);
		assert.deepEqual(await repair(f), receipt(f)); assert.deepEqual(await f.inspect(), { status: 'present' });
	});
});

void test('Lightscaper native media close cancels repair and joins the real held fsync before physical owner retirement', options, async t => {
	await fixture(t, async f => {
		const result = await holdSync(t, f, async gate => {
			const closing = f.track(f.media.close()); await remainsPending(closing); gate.release(); await closing;
		});
		assert.equal(result.status, 'rejected');
		assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM native_photo_original_body_heads').get()?.n, 0);
	});
});
