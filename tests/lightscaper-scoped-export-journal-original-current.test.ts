/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createPhotoLibrarySessionExportJournalPortV1 } from '../src/lightscaper/controller/photo-library-session-export-sidecar.ts';
import { photoRasterExportJournalKeyV1 } from '../src/lightscaper/storage/photo-raster-export-journal-v1.ts';
import { scopedExportOriginalFixtureCurrentV1 as fixture, exportOriginalTestCurrentV1 as test, deferred, remainsPending,
	exportReachedCurrentV1 as reached, exportExactFailureCurrentV1 as exactFailure } from './helpers/lightscaper-scoped-export-original-fixture-current.ts';

void test('Current export journal source-only verification retains genuine native ticket through resource and final Photo fences', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		Reflect.deleteProperty(f.host, 'loadOriginal');
		const verified = deferred<void>(), release = deferred<void>(), finalRead = deferred<void>(), finalRelease = deferred<void>();
		f.hooks.verified = async () => { verified.resolve(); await release.promise; };
		f.hooks.loaded = async count => { if (count === 2) { finalRead.resolve(); await finalRelease.promise; } };
		const access = await f.openJournal(), work = access.verifyResources(f.request); void work.catch(() => undefined);
		try {
			await reached(verified.promise, work); assert.equal(f.calls().releases, 0); await f.provePinned();
			release.resolve(); await reached(finalRead.promise, work); assert.equal(f.calls().releases, 0);
			assert.equal(await remainsPending(work), true); finalRelease.resolve(); await work;
			assert.equal(f.calls().acquisitions, 1); assert.equal(f.calls().releases, 1); assert.equal(f.calls().fallbacks, 0);
		} finally { release.resolve(); finalRelease.resolve(); await Promise.allSettled([work]); }
	});
});

void test('Current journal factory captures source receiver before open and prefers it over Web fallback', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const port = createPhotoLibrarySessionExportJournalPortV1('current3', f.host);
		f.originalSource.acquire = async () => { assert.fail('Replaced source acquire was read after factory capture.'); };
		f.host.loadOriginal = async () => { assert.fail('Scoped source must take precedence.'); };
		await (await port.open()).verifyResources(f.request);
		assert.equal(f.calls().acquisitions, 1); assert.equal(f.calls().releases, 1); assert.equal(f.calls().fallbacks, 0);
	});
});

void test('Current journal source cancellation joins held acquisition and exact opaque reason before lease retirement', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		Reflect.deleteProperty(f.host, 'loadOriginal'); const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
		const reason = new Proxy({}, { get() { assert.fail('Opaque cancellation reason inspected.'); }, getPrototypeOf() { assert.fail('Opaque reason reflected.'); } });
		f.hooks.acquired = async () => { entered.resolve(); await release.promise; };
		const work = (await f.openJournal()).verifyResources(f.request, { signal: stop.signal });
		const outcome = exactFailure(work, reason);
		try { await reached(entered.promise, work); stop.abort(reason); assert.equal(await remainsPending(work), true);
			assert.equal(f.calls().releases, 0); release.resolve(); await outcome; assert.equal(f.calls().releases, 1);
		} finally { release.resolve(); await Promise.allSettled([work, outcome]); }
	});
});

void test('Current journal authenticates real File bytes and closes source after digest refusal', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		Reflect.deleteProperty(f.host, 'loadOriginal');
		f.hooks.body = body => new File([new Uint8Array(body.size)], body.name, { type: body.type });
		await assert.rejects((await f.openJournal()).verifyResources(f.request), /hash|SHA/iu);
		assert.equal(f.calls().acquisitions, 1); assert.equal(f.calls().releases, 1);
	});
});

void test('Current journal final whole Photo check remains inside the Original lease', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		Reflect.deleteProperty(f.host, 'loadOriginal');
		f.hooks.verified = async () => { assert.equal(f.calls().releases, 0);
			await f.native.catalog.savePhoto({ ...f.photo, metadata: { ...f.photo.metadata, title: 'Changed during export verification' } }, f.photo.revision); };
		await assert.rejects((await f.openJournal()).verifyResources(f.request), /revision|changed/iu); assert.equal(f.calls().releases, 1);
	});
});

void test('Current journal retains distinct verification and lease cleanup failures', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		Reflect.deleteProperty(f.host, 'loadOriginal'); const primary = new Error('Actual resource verification observer failure'), cleanup = new Error('Actual ticket already retired; cleanup observer failure');
		f.hooks.verified = async () => { throw primary; }; f.hooks.released = async () => { throw cleanup; };
		let captured: unknown;
		await (await f.openJournal()).verifyResources(f.request).catch((error: unknown) => { captured = error; });
		assert.ok(captured instanceof AggregateError); assert.equal(captured.errors[0], primary); assert.equal(captured.errors[1], cleanup);
		assert.equal(f.calls().releases, 1);
	});
});

void test('Settings-only journal opens without Original capability and Web fallback still verifies genuine body', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		Reflect.deleteProperty(f.host, 'originalSource');
		await (await f.openJournal()).verifyResources(f.request); assert.equal(f.calls().fallbacks, 1); assert.equal(f.calls().acquisitions, 0);
		Reflect.deleteProperty(f.host, 'loadOriginal'); const access = await f.openJournal();
		assert.equal(await access.settings.get(photoRasterExportJournalKeyV1(f.photo.catalogId)), undefined);
		await assert.rejects(access.verifyResources(f.request), /original.*unavailable/iu);
	});
});
