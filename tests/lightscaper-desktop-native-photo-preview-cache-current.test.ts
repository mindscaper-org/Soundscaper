/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { nativePreviewCacheFixtureCurrentV1 as fixture, nativePreviewProfileCurrentV1 as profile, nativePreviewDigestCurrentV1 as digest } from './helpers/lightscaper-native-photo-preview-cache-fixture-current.ts';

for (const size of [0, 37, 1048593]) void test(`Lightscaper native preview cache persists genuine ${size}-byte bodies and reopens`, { timeout: 15000 }, async context => fixture(context, async f => {
	const bytes = new Uint8Array(size); bytes.fill(73); const identity = f.identity('canonical', size), core = f.owner.createBinaryDerivativeCache(profile());
	assert.deepEqual(await core.store(identity, new Blob([bytes]), digest(bytes)), { outcome: 'stored' });
	const rows = f.db.prepare('SELECT length(body) AS size FROM native_photo_preview_chunks').all();
	assert.equal(rows.length, Math.ceil(size / 1048576)); assert.equal(rows.every(row => typeof row.size === 'number' && row.size <= 1048576), true);
	await f.owner.close(); const reopened = await f.open(), loaded = await reopened.createBinaryDerivativeCache(profile()).load(identity);
	assert.ok(loaded); assert.equal(loaded.body instanceof Blob, true); assert.equal(loaded.body.size, size);
	assert.equal(digest(new Uint8Array(await loaded.body.arrayBuffer())), digest(bytes)); assert.equal(loaded.outputSha256, digest(bytes));
}));

void test('Lightscaper native preview cache captures profile and identity before queue wait and ignores borrowed Blob shadows', { timeout: 15000 }, async context => fixture(context, async f => {
	const selected = profile(), core = f.owner.createBinaryDerivativeCache(selected); Reflect.set(selected, 'maximumBytes', 0);
	class Actual extends Blob { override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('Borrowed body override.'); } override slice(): Blob { throw new Error('Borrowed slice override.'); } }
	const identity = f.identity('captured', 5), work = core.store(identity, new Actual(['bytes']), digest('bytes')); identity.recipeId = 'changed';
	assert.equal((await work).outcome, 'stored'); assert.ok(await core.load(f.identity('captured', 5)));
}));

void test('Lightscaper native preview cache rejects forged body, wrong length/output hash and identity grammar before publication', { timeout: 15000 }, async context => fixture(context, async f => {
	const core = f.owner.createBinaryDerivativeCache(profile()), identity = f.identity('invalid', 5);
	await assert.rejects(core.store(identity, { size: 5, slice() { throw new Error('No fake Blob.'); } }, digest('bytes')));
	await assert.rejects(core.store(identity, new Blob(['size']), digest('size')));
	await assert.rejects(core.store(identity, new Blob(['bytes']), digest('other')));
	await assert.rejects(core.load({ ...identity, extra: true }));
	assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_preview_entries').get()?.n, 0);
	assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_preview_staging').get()?.n, 0);
}));

void test('Lightscaper native preview cache treats absent or recreated native source tokens as misses', { timeout: 15000 }, async context => fixture(context, async f => {
	const core = f.owner.createBinaryDerivativeCache(profile()), identity = f.identity('token', 1);
	await core.store(identity, new Blob(['x']), digest('x')); assert.ok(await core.load(identity));
	await f.media.deleteAsset('asset'); assert.equal(await core.load(identity), null);
	await f.media.writeAsset('asset', new Blob(['actual retained native Original'])); assert.equal(await core.load(identity), null);
	await core.store(identity, new Blob(['x']), digest('x')); assert.ok(await core.load(identity));
}));

for (const corruption of ['missing', 'hash', 'oversize'] as const) void test(`Lightscaper native preview cache refuses actual ${corruption} payload corruption`, { timeout: 15000 }, async context => fixture(context, async f => {
	const core = f.owner.createBinaryDerivativeCache(profile()), identity = f.identity('corrupt', 5); await core.store(identity, new Blob(['bytes']), digest('bytes'));
	if (corruption === 'missing') f.db.exec('DELETE FROM native_photo_preview_chunks');
	if (corruption === 'hash') f.db.prepare('UPDATE native_photo_preview_chunks SET body=?').run(new Uint8Array([1, 2, 3, 4, 5]));
	if (corruption === 'oversize') { f.db.exec('PRAGMA ignore_check_constraints=ON'); f.db.prepare('UPDATE native_photo_preview_chunks SET body=?').run(new Uint8Array(1048577)); f.db.exec('PRAGMA ignore_check_constraints=OFF'); }
	await assert.rejects(core.load(identity));
}));

void test('Lightscaper native preview cache shares capacity across canonical/culling/HDR facades and bounds trim to sixteen', { timeout: 15000 }, async context => fixture(context, async f => {
	const broad = f.owner.createBinaryDerivativeCache(profile({ maximumBytes: 64, maximumEntries: 32 }));
	for (let index = 0; index < 20; index++) { context.signal.throwIfAborted(); await broad.store(f.identity(`variant${index}`, 1), new Blob(['x']), digest('x')); }
	const strict = f.owner.createBinaryDerivativeCache(profile({ maximumBytes: 1, maximumEntries: 1 }));
	assert.equal((await strict.store(f.identity('hdr', 1), new Blob(['x']), digest('x'))).outcome, 'pressure');
	assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_preview_entries').get()?.n, 20);
	const first = await strict.trim(); assert.equal(first.removedEntries, 16); assert.equal(first.removedBytes, 16); assert.equal(first.more, true);
	const second = await strict.trim(); assert.equal(second.removedEntries, 3); assert.equal(second.more, false);
	assert.equal((await strict.store(f.identity('hdr', 1), new Blob(['x']), digest('x'))).outcome, 'stored');
	assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_preview_entries').get()?.n, 1);
}));

void test('Lightscaper native preview cache refuses source binding corruption without decoding generic metadata', { timeout: 15000 }, async context => fixture(context, async f => {
	const core = f.owner.createBinaryDerivativeCache(profile()), identity = f.identity('scalar', 1);
	f.source.prepare('UPDATE native_photo_media_assets SET metadata=?').run(new Uint8Array(131072));
	assert.equal((await core.store(identity, new Blob(['x']), digest('x'))).outcome, 'stored'); assert.ok(await core.load(identity));
	f.source.prepare('UPDATE native_photo_media_assets SET size=size+1').run(); await assert.rejects(core.store(identity, new Blob(['x']), digest('x'))); assert.equal(await core.load(identity), null);
}));


void test('Lightscaper native preview cache preserves foreign ownership on read-only preflight', { timeout: 15000 }, async context => fixture(context, async f => {
	await f.owner.close(); f.db.exec('PRAGMA application_id=12345');
	await assert.rejects(f.open()); assert.equal(f.db.prepare('PRAGMA application_id').get()?.application_id, 12345);
	assert.equal(f.db.prepare('PRAGMA user_version').get()?.user_version, 1);
}));
