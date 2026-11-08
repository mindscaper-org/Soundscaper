/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { nativePreviewCacheFixtureCurrentV1 as fixture, nativePreviewProfileCurrentV1 as profile, nativePreviewDigestCurrentV1 as digest } from './helpers/lightscaper-native-photo-preview-cache-fixture-current.ts';
import { remainsPending } from './helpers/async-test-control.ts';

void test('Lightscaper native preview cache rejects a real WAL token replacement after its held Blob read', { timeout: 15000 }, async context => fixture(context, async f => {
	const entered = f.gate(), leave = f.gate(); f.onBlobRead(async () => { entered.resolve(); await leave.promise; });
	const work = f.track(f.owner.createBinaryDerivativeCache(profile()).store(f.identity('race', 5), new Blob(['bytes']), digest('bytes'))), observed = work.then(() => false, () => true);
	try { await f.reached(entered.promise, work); f.source.prepare('UPDATE native_photo_media_assets SET media_content_token=?').run('media-content-0123456789abcdef0123456789abcdef'); }
	finally { leave.resolve(); }
	assert.equal(await observed, true); f.onBlobRead(null);
	assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_preview_entries').get()?.n, 0);
	assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_preview_staging').get()?.n, 0);
}));

void test('Lightscaper native preview cache close joins the actual accepted Blob read and fences new work', { timeout: 15000 }, async context => fixture(context, async f => {
	const entered = f.gate(), leave = f.gate(); f.onBlobRead(async () => { entered.resolve(); await leave.promise; });
	const core = f.owner.createBinaryDerivativeCache(profile()), work = f.track(core.store(f.identity('close', 5), new Blob(['bytes']), digest('bytes'))), observed = work.then(() => false, () => true);
	let closing: Promise<void> | undefined;
	try { await f.reached(entered.promise, work); closing = f.track(f.owner.close()); assert.equal(await remainsPending(closing), true); await assert.rejects(core.load(f.identity('close', 5))); }
	finally { leave.resolve(); }
	assert.equal(await observed, true); await closing;
}));

void test('Lightscaper native preview cache preserves opaque cancellation and joins its held real Blob receipt', { timeout: 15000 }, async context => fixture(context, async f => {
	const entered = f.gate(), leave = f.gate(), controller = new AbortController(), opaque = Object.create(null) as object;
	Object.defineProperty(opaque, 'then', { get() { throw new Error('Opaque reason inspected.'); } });
	f.onBlobRead(async () => { entered.resolve(); await leave.promise; });
	const work = f.track(f.owner.createBinaryDerivativeCache(profile()).store(f.identity('cancel', 5), new Blob(['bytes']), digest('bytes'), controller.signal));
	const observed = work.then(() => { throw new Error('Expected cancellation.'); }, (error: unknown) => { assert.equal(error, opaque); });
	try { await f.reached(entered.promise, work); controller.abort(opaque); assert.equal(await remainsPending(observed), true); }
	finally { leave.resolve(); }
	await observed;
}));

void test('Lightscaper native preview cache publishes a true COMMIT ACK despite synchronous opaque abort and close', { timeout: 15000 }, async context => fixture(context, async f => {
	const original = DatabaseSync.prototype.exec, controller = new AbortController(), reason = Symbol('late-cache-abort'); let fired = false, closing: Promise<void> | undefined;
	DatabaseSync.prototype.exec = function (sql: string): void {
		Reflect.apply(original, this, [sql]);
		if (sql === 'COMMIT' && !fired && this.prepare('PRAGMA database_list').get()?.file === f.cachePath && this.prepare('SELECT count(*) AS n FROM native_photo_preview_entries').get()?.n === 1) {
			fired = true; controller.abort(reason); closing = f.track(f.owner.close());
		}
	};
	try { assert.equal((await f.track(f.owner.createBinaryDerivativeCache(profile()).store(f.identity('ack', 5), new Blob(['bytes']), digest('bytes'), controller.signal))).outcome, 'stored'); }
	finally { DatabaseSync.prototype.exec = original; await closing; }
	assert.equal(fired, true); assert.ok(await (await f.open()).createBinaryDerivativeCache(profile()).load(f.identity('ack', 5)));
}));

void test('Lightscaper native preview cache rolls back actual entry INSERT refusal and permits a genuine retry', { timeout: 15000 }, async context => fixture(context, async f => {
	const core = f.owner.createBinaryDerivativeCache(profile()), identity = f.identity('rollback', 5);
	f.db.exec("CREATE TRIGGER reject_preview BEFORE INSERT ON native_photo_preview_entries BEGIN SELECT RAISE(ABORT,'refuse actual preview insert'); END");
	await assert.rejects(core.store(identity, new Blob(['bytes']), digest('bytes')));
	assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_preview_entries').get()?.n, 0);
	f.db.exec('DROP TRIGGER reject_preview'); assert.equal((await core.store(identity, new Blob(['bytes']), digest('bytes'))).outcome, 'stored');
}));


void test('Lightscaper native preview cache rolls back a real deferred-FK publication COMMIT failure', { timeout: 15000 }, async context => fixture(context, async f => {
	const core = f.owner.createBinaryDerivativeCache(profile()), identity = f.identity('commitrollback', 5);
	f.db.exec(`CREATE TABLE preview_parent(id INTEGER PRIMARY KEY); CREATE TABLE preview_child(id INTEGER REFERENCES preview_parent(id) DEFERRABLE INITIALLY DEFERRED);
		CREATE TRIGGER fail_preview_commit AFTER INSERT ON native_photo_preview_entries BEGIN INSERT INTO preview_child VALUES(9); END`);
	await assert.rejects(core.store(identity, new Blob(['bytes']), digest('bytes')));
	assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_preview_entries').get()?.n, 0);
	assert.equal(f.db.prepare('SELECT count(*) AS n FROM preview_child').get()?.n, 0);
	f.db.exec('DROP TRIGGER fail_preview_commit; DROP TABLE preview_child; DROP TABLE preview_parent');
	assert.equal((await core.store(identity, new Blob(['bytes']), digest('bytes'))).outcome, 'stored');
}));

void test('Lightscaper native preview cache keeps its committed ACK when the source-guard COMMIT refuses', { timeout: 15000 }, async context => fixture(context, async f => {
	const exec = DatabaseSync.prototype.exec, sourcePath = f.source.prepare('PRAGMA database_list').get()?.file;
	const failure = new Error('Actual source guard COMMIT failure.'); let armed = true;
	DatabaseSync.prototype.exec = function (sql: string): void {
		if (armed && sql === 'COMMIT' && this.prepare('PRAGMA database_list').get()?.file === sourcePath
			&& f.db.prepare('SELECT count(*) AS n FROM native_photo_preview_entries').get()?.n === 1) { armed = false; throw failure; }
		Reflect.apply(exec, this, [sql]);
	};
	try { const receipt = await f.owner.createBinaryDerivativeCache(profile()).store(f.identity('sourceack', 5), new Blob(['bytes']), digest('bytes'));
		assert.equal(receipt.outcome, 'stored'); assert.equal(receipt.cleanupErrors?.includes(failure), true); }
	finally { DatabaseSync.prototype.exec = exec; }
	assert.equal(armed, false); assert.ok(await f.owner.createBinaryDerivativeCache(profile()).load(f.identity('sourceack', 5)));
}));
