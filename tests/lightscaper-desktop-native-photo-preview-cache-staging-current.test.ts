/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { nativePreviewCacheFixtureCurrentV1 as fixture, nativePreviewProfileCurrentV1 as profile, nativePreviewDigestCurrentV1 as digest } from './helpers/lightscaper-native-photo-preview-cache-fixture-current.ts';

void test('Lightscaper native preview cache refuses an actual staged chunk WAL replacement during a later Blob read', { timeout: 15000 }, async context => fixture(context, async f => {
	const entered = f.gate(), leave = f.gate(); let reads = 0;
	f.onBlobRead(async () => { if (++reads === 2) { entered.resolve(); await leave.promise; } });
	const bytes = new Uint8Array(1048581); bytes.fill(77);
	const work = f.track(f.owner.createBinaryDerivativeCache(profile()).store(f.identity('stagedrace', bytes.byteLength), new Blob([bytes]), digest(bytes)));
	const observed = work.then(() => false, () => true);
	try {
		await f.reached(entered.promise, work);
		assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_preview_chunks WHERE position=0').get()?.n, 1);
		f.db.prepare('UPDATE native_photo_preview_chunks SET body=? WHERE position=0').run(new Uint8Array(1048576));
	} finally { leave.resolve(); }
	assert.equal(await observed, true);
	assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_preview_entries').get()?.n, 0);
	assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_preview_staging').get()?.n, 0);
}));

void test('Lightscaper native preview sibling open cannot discard a genuinely accepted held stage', { timeout: 15000 }, async context => fixture(context, async f => {
	const entered = f.gate(), leave = f.gate(); f.onBlobRead(async () => { entered.resolve(); await leave.promise; });
	const identity = f.identity('sibling', 5), work = f.track(f.owner.createBinaryDerivativeCache(profile()).store(identity, new Blob(['bytes']), digest('bytes')));
	let sibling: Awaited<ReturnType<typeof f.open>> | undefined;
	try {
		await f.reached(entered.promise, work); const token = f.db.prepare('SELECT body_token FROM native_photo_preview_staging').get()?.body_token;
		sibling = await f.open(); assert.equal(f.db.prepare('SELECT body_token FROM native_photo_preview_staging').get()?.body_token, token);
	} finally { leave.resolve(); }
	assert.equal((await work).outcome, 'stored'); f.onBlobRead(null);
	assert.ok(await sibling!.createBinaryDerivativeCache(profile()).load(identity));
}));

void test('Lightscaper native preview stage INSERT ignore rolls back its unadvertised body', { timeout: 15000 }, async context => fixture(context, async f => {
	f.db.exec('CREATE TRIGGER ignore_preview_stage BEFORE INSERT ON native_photo_preview_staging BEGIN SELECT RAISE(IGNORE); END');
	await assert.rejects(f.owner.createBinaryDerivativeCache(profile()).store(f.identity('ignorestage', 5), new Blob(['bytes']), digest('bytes')));
	assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_preview_entries').get()?.n, 0);
	assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_preview_bodies').get()?.n, 0);
	assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_preview_chunks').get()?.n, 0);
	f.db.exec('DROP TRIGGER ignore_preview_stage');
}));

void test('Lightscaper native preview refuses undeclared negative chunks and oversized NUL-prefixed scalar payloads', { timeout: 15000 }, async context => fixture(context, async f => {
	const core = f.owner.createBinaryDerivativeCache(profile()), identity = f.identity('closedset', 5); await core.store(identity, new Blob(['bytes']), digest('bytes'));
	const token = f.db.prepare('SELECT body_token FROM native_photo_preview_entries').get()?.body_token;
	assert.equal(typeof token, 'string'); f.db.exec('PRAGMA ignore_check_constraints=ON');
	f.db.prepare('INSERT INTO native_photo_preview_chunks(body_token,position,body) VALUES(?,-1,?)').run(String(token), new Uint8Array([1]));
	f.db.exec('PRAGMA ignore_check_constraints=OFF'); await assert.rejects(core.load(identity));
	f.db.prepare('DELETE FROM native_photo_preview_chunks WHERE position=-1').run();
	f.db.exec('PRAGMA ignore_check_constraints=ON'); f.db.prepare('UPDATE native_photo_preview_entries SET mime_type=?').run('image/png\0' + 'x'.repeat(131072));
	f.db.exec('PRAGMA ignore_check_constraints=OFF'); await assert.rejects(core.load(identity));
}));
