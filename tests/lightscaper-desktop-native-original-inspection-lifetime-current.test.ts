/* SPDX-License-Identifier: AGPL-3.0-only */

import test from 'node:test';
import { assert, remainsPending, nativeOriginalInspectionFixtureCurrentV1 as fixture,
	INSPECTION_OPTIONS_CURRENT_V1 as options } from './helpers/lightscaper-native-original-inspection-fixture-current.ts';

void test('Lightscaper native inspection hashes actual bytes again after prior successful inspection', options, async t => {
	await fixture(t, async f => {
		assert.deepEqual(await f.inspect(), { status: 'present' });
		await f.hold(async gate => {
			const work = f.inspect(); void work.catch(() => undefined);
			try { await gate.entered; assert.equal(await remainsPending(work), true); } finally { gate.release(); }
			assert.deepEqual(await work, { status: 'present' });
		});
	});
});

void test('Lightscaper native inspection rechecks generation after actual filesystem IO', options, async t => {
	await fixture(t, async f => { await f.hold(async gate => {
		const work = f.inspect(); void work.catch(() => undefined);
		try { await gate.entered; f.db.exec("UPDATE native_photo_media_assets SET media_content_token='media-content-0000000000000000'"); }
		finally { gate.release(); }
		await assert.rejects(work);
	}); });
});

void test('Lightscaper native inspection rechecks exact custody after actual filesystem IO', options, async t => {
	await fixture(t, async f => { await f.hold(async gate => {
		const work = f.inspect(); void work.catch(() => undefined);
		try { await gate.entered; f.db.exec('DELETE FROM native_photo_media_roots; UPDATE native_photo_media_assets SET root_count=0'); }
		finally { gate.release(); }
		await assert.rejects(work);
	}); });
});

void test('Lightscaper native inspection joins an accepted FileHandle read before opaque cancellation settles', options, async t => {
	await fixture(t, async f => { await f.hold(async gate => {
		const controller = new AbortController(), reason = Symbol('exact inspection cancellation');
		const work = f.inspect(f.binding, { signal: controller.signal }); void work.catch(() => undefined);
		try { await gate.entered; controller.abort(reason); assert.equal(await remainsPending(work), true); }
		finally { gate.release(); }
		await work.then(() => { assert.fail('Expected cancellation'); }, (error: unknown) => { assert.equal(error, reason); });
	}); });
});

void test('Lightscaper native media close joins the accepted inspection read and refuses later admission', options, async t => {
	await fixture(t, async f => { await f.hold(async gate => {
		const work = f.inspect(); void work.catch(() => undefined); let close: Promise<void> | undefined;
		try { await gate.entered; close = f.track(f.media.close()); assert.equal(await remainsPending(close), true); assert.equal(await remainsPending(work), true); }
		finally { gate.release(); }
		await assert.rejects(work); await close; await assert.rejects(f.inspect());
	}); });
});

void test('Lightscaper native inspection registers before borrowed binding reflection can close the owner', options, async t => {
	await fixture(t, async f => {
		let close: Promise<void> | undefined;
		const borrowed = new Proxy(f.binding, { ownKeys(target) { close = f.track(f.media.close()); return Reflect.ownKeys(target); } });
		await assert.rejects(f.inspect(borrowed)); assert.ok(close); await close;
	});
});
