/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoPreviewSchedulerV1 } from '../src/lightscaper/preview/photo-preview-scheduler-v1.ts';
import { PhotoPreviewSchedulerV2 } from '../src/lightscaper/preview/photo-preview-scheduler-v2.ts';
import { DesktopPhotoOriginalSourceCurrentV1 } from '../src/lightscaper/desktop-photo-original-source-current-v1.ts';
import type { PhotoLibraryOriginalRequestCurrentV1 } from '../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import { PhotoPreviewSchedulerCurrentV1 } from '../src/lightscaper/preview/photo-preview-scheduler-current-v1.ts';
import type { PreparedPhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-preparation-v1.ts';
import { remainsPending } from './helpers/async-test-control.ts';
import { scopedPreviewFixtureCurrentV1, scopedPreviewShaCurrentV1 as sha } from './helpers/lightscaper-preview-original-source-fixture-current.ts';

const deadline = { timeout: 15_000 };
for (const [Owner, schema] of [[PhotoPreviewSchedulerV1, 1], [PhotoPreviewSchedulerV2, 2], [PhotoPreviewSchedulerCurrentV1, 3]] as const) {
	test(`Lightscaper ${Owner.name} accepts a scoped-only real File and actual RAW decoder, then hits independent cache`, deadline, async context => {
		const f = await scopedPreviewFixtureCurrentV1(context, { schema });
		try {
			const scheduler = f.make(Owner), ready = await f.run(scheduler); assert.equal(ready.outcome, 'ready');
			if (ready.outcome !== 'ready') assert.fail('Actual RAW preview is missing.');
			assert.equal(ready.cache, 'stored'); assert.equal(ready.preview.body.size, 32 * 32 * 4);
			const pixels = new Uint8Array(await ready.preview.body.arrayBuffer());
			assert.equal(sha(pixels), ready.preview.outputSha256);
			assert.equal(pixels.filter((_value, index) => index % 4 === 3).every(value => value === 255), true);
			assert.equal(pixels.some((value, index) => index % 4 !== 3 && value > 0 && value < 255), true);
			assert.equal(f.calls.acquire, 1); assert.equal(f.calls.close, 1); assert.equal(f.calls.fallback, 0);
			assert.equal(f.native.statistics.created, 1); assert.equal(f.native.statistics.joined, 1); assert.equal(f.native.active(), 0);
			const hit = await f.run(scheduler); assert.equal(hit.outcome, 'ready');
			if (hit.outcome !== 'ready') assert.fail('Warm preview is missing.');
			assert.equal(hit.cache, 'hit'); assert.equal(hit.preview, ready.preview); assert.equal(f.calls.acquire, 1);
			await scheduler.close();
		} finally { await f.close(); }
	});
}

test('Lightscaper scoped preview retains File through actual frame retirement, cache publication and final binding check', deadline, async context => {
	const f = await scopedPreviewFixtureCurrentV1(context), frame = f.gate(), releaseFrame = f.gate(), stored = f.gate(), releaseStore = f.gate(), final = f.gate(), releaseFinal = f.gate();
	try {
		f.hooks.frame = async () => { frame.release(); await releaseFrame.promise; };
		f.hooks.store = async () => { stored.release(); await releaseStore.promise; };
		f.hooks.loadPhoto = async () => { if (f.calls.photos === 3) { final.release(); await releaseFinal.promise; } };
		const scheduler = f.make(), work = f.run(scheduler); await f.wait(frame, work); context.signal.throwIfAborted();
		assert.equal(f.calls.close, 0); assert.equal(f.native.active(), 0); releaseFrame.release();
		await f.wait(stored, work); context.signal.throwIfAborted(); assert.ok(f.events.includes('decoder-retired')); assert.equal(f.calls.close, 0);
		releaseStore.release(); await f.wait(final, work); context.signal.throwIfAborted(); assert.equal(f.calls.close, 0);
		releaseFinal.release(); assert.equal((await work).outcome, 'ready'); assert.equal(f.calls.close, 1); await scheduler.close();
	} finally { releaseFrame.release(); releaseStore.release(); releaseFinal.release(); await f.close(); }
});

test('Lightscaper scoped preview keeps its lease through pressure trim and the acknowledged retry', deadline, async context => {
	const f = await scopedPreviewFixtureCurrentV1(context), entered = f.gate(), release = f.gate();
	try {
		let attempts = 0;
		const cache = { ...f.ports.cache, async store(value: PreparedPhotoPreviewV1, signal?: AbortSignal) {
			assert.equal(f.calls.close, 0); if (++attempts === 1) return { outcome: 'pressure' as const };
			return f.ports.cache.store(value, signal);
		}, async trim() { entered.release(); await release.promise; assert.equal(f.calls.close, 0); return { removedEntries: 0, removedBytes: 0, more: false }; } };
		const scheduler = f.make(PhotoPreviewSchedulerCurrentV1, { cache }), work = f.run(scheduler);
		await f.wait(entered, work); context.signal.throwIfAborted(); assert.equal(f.calls.close, 0); release.release();
		const result = await work; assert.equal(result.outcome, 'ready'); if (result.outcome === 'ready') assert.equal(result.cache, 'stored');
		assert.equal(attempts, 2); assert.equal(f.calls.close, 1); await scheduler.close();
	} finally { release.release(); await f.close(); }
});

test('Lightscaper scoped preview coalescing keeps the real File until the remaining consumer and lease close join', deadline, async context => {
	const f = await scopedPreviewFixtureCurrentV1(context), entered = f.gate(), release = f.gate(), closing = f.gate(), releaseClose = f.gate(), caller = new AbortController();
	const reason = Symbol('one-observer');
	try {
		f.hooks.frame = async () => { entered.release(); await release.promise; };
		f.hooks.closeLease = async () => { closing.release(); await releaseClose.promise; };
		const scheduler = f.make(), cancelled = f.run(scheduler, { signal: caller.signal });
		const observed = cancelled.then(() => ({ ok: true }), (error: unknown) => ({ ok: false, error }));
		const kept = f.run(scheduler); await f.wait(entered, kept); context.signal.throwIfAborted(); caller.abort(reason);
		const failed = await observed; assert.equal(failed.ok, false); if ('error' in failed) assert.equal(failed.error, reason);
		assert.equal(f.calls.close, 0); release.release(); await f.wait(closing, kept); context.signal.throwIfAborted();
		assert.equal(await remainsPending(kept), true); releaseClose.release(); assert.equal((await kept).outcome, 'ready');
		assert.equal(f.calls.acquire, 1); assert.equal(f.calls.close, 1); await scheduler.close();
	} finally { release.release(); releaseClose.release(); await f.close(); }
});

test('Lightscaper scoped preview Close cancels observers promptly but joins actual held frame and lease retirement', deadline, async context => {
	const f = await scopedPreviewFixtureCurrentV1(context), entered = f.gate(), release = f.gate(), closeEntered = f.gate(), releaseClose = f.gate();
	try {
		f.hooks.frame = async () => { entered.release(); await release.promise; };
		f.hooks.closeLease = async () => { closeEntered.release(); await releaseClose.promise; };
		const scheduler = f.make(), work = f.run(scheduler), observed = work.then(() => false, () => true);
		await f.wait(entered, work); context.signal.throwIfAborted(); const closing = scheduler.close(); assert.equal(closing, scheduler.close());
		assert.equal(await observed, true); assert.equal(await remainsPending(closing), true); assert.equal(f.calls.close, 0);
		release.release(); await f.wait(closeEntered, closing); context.signal.throwIfAborted(); assert.equal(await remainsPending(closing), true);
		releaseClose.release(); await closing; assert.equal(f.calls.stores, 0); assert.equal(f.calls.close, 1);
	} finally { release.release(); releaseClose.release(); await f.close(); }
});

test('Lightscaper scoped preview cancellation retains opaque reason and independently reports source cleanup failure', deadline, async context => {
	const f = await scopedPreviewFixtureCurrentV1(context), entered = f.gate(), release = f.gate(), stop = new AbortController();
	const reason = Proxy.revocable({}, {}); reason.revoke(); const cleanup = Symbol('source-close');
	try {
		f.hooks.frame = async () => { entered.release(); await release.promise; };
		f.hooks.closeLease = async () => { throw cleanup; };
		const scheduler = f.make(), work = f.run(scheduler, { signal: stop.signal });
		const observed = work.then(() => ({ okay: true as const }), (error: unknown) => ({ okay: false as const, error }));
		await f.wait(entered, work); context.signal.throwIfAborted(); stop.abort(reason.proxy); const closing = scheduler.close();
		const retired = closing.then(() => ({ okay: true as const }), (error: unknown) => ({ okay: false as const, error }));
		release.release(); const failed = await observed, ended = await retired;
		assert.equal(failed.okay, false); if (!failed.okay) assert.ok(Object.is(failed.error, reason.proxy));
		assert.equal(ended.okay, false); if (!ended.okay) {
			assert.ok(ended.error instanceof AggregateError);
			assert.ok(ended.error.errors.some(value => Object.is(value, reason.proxy))); assert.ok(ended.error.errors.includes(cleanup));
		}
		assert.equal(f.calls.close, 1);
	} finally { release.release(); await f.close(); }
});

test('Lightscaper scoped preview captures source function and receiver before replacement, and source precedes legacy loader', deadline, async context => {
	const f = await scopedPreviewFixtureCurrentV1(context), entered = f.gate(), release = f.gate();
	try {
		f.hooks.loadPhoto = async () => { if (f.calls.photos === 1) { entered.release(); await release.promise; } };
		const scheduler = f.make(PhotoPreviewSchedulerCurrentV1, {}, false), work = f.run(scheduler);
		await f.wait(entered, work); context.signal.throwIfAborted();
		Reflect.set(f.originalSource, 'acquire', async () => { assert.fail('Late source replacement was read.'); });
		release.release(); assert.equal((await work).outcome, 'ready'); assert.equal(f.calls.fallback, 0); await scheduler.close();
	} finally { release.release(); await f.close(); }
});

test('Lightscaper scoped preview retains attribute edits but supersedes Original replacement before cache publication', deadline, async context => {
	for (const replaceOriginal of [false, true]) {
		const f = await scopedPreviewFixtureCurrentV1(context), entered = f.gate(), release = f.gate();
		try {
			f.hooks.frame = async () => { entered.release(); await release.promise; };
			const scheduler = f.make(), work = f.run(scheduler); await f.wait(entered, work); context.signal.throwIfAborted();
			const current = f.current(); f.replace({ ...current, revision: current.revision + 1, rating: 4,
				...(replaceOriginal ? { original: { ...current.original, id: 'new-original', storageKey: 'new-body' } } : {}) });
			release.release(); assert.equal((await work).outcome, replaceOriginal ? 'superseded' : 'ready');
			assert.equal(f.calls.stores, replaceOriginal ? 0 : 1); assert.equal(f.calls.close, 1); await scheduler.close();
		} finally { release.release(); await f.close(); }
	}
});

test('Lightscaper scoped camera culling uses real RAW extraction and canonical fallback while retaining its distinct cache recipe', deadline, async context => {
	const f = await scopedPreviewFixtureCurrentV1(context);
	try {
		const scheduler = f.make(), ready = await f.run(scheduler, { rawPreviewSource: 'camera-embedded' }); assert.equal(ready.outcome, 'ready');
		if (ready.outcome !== 'ready') assert.fail('Actual camera-fallback preview is missing.');
		assert.equal(ready.preview.recipe.id, 'lightscaper.raw-culling.camera-embedded.rgba8-contain-nearest');
		assert.equal(f.native.statistics.created, 2); assert.equal(f.native.statistics.joined, 2); assert.equal(f.calls.close, 1);
		assert.equal(sha(new Uint8Array(await ready.preview.body.arrayBuffer())), ready.preview.outputSha256);
		const hit = await f.run(scheduler, { rawPreviewSource: 'camera-embedded' }); assert.equal(hit.outcome, 'ready');
		if (hit.outcome === 'ready') assert.equal(hit.cache, 'hit'); assert.equal(f.calls.acquire, 1); await scheduler.close();
	} finally { await f.close(); }
});

test('Lightscaper scoped HDR preview uses the real HDR codec and keeps its File through final publication', deadline, async context => {
	const f = await scopedPreviewFixtureCurrentV1(context, { hdr: true }), entered = f.gate(), release = f.gate();
	try {
		f.hooks.store = async () => { entered.release(); await release.promise; };
		const scheduler = f.make(), work = f.run(scheduler); await f.wait(entered, work); context.signal.throwIfAborted(); assert.equal(f.calls.close, 0);
		release.release(); const ready = await work; assert.equal(ready.outcome, 'ready'); if (ready.outcome !== 'ready') assert.fail('HDR preview missing.');
		assert.equal(ready.preview.recipe.id, 'lightscaper.hdr-original-preview.linear-f32-srgb.rgba8-nearest');
		assert.equal(sha(new Uint8Array(await ready.preview.body.arrayBuffer())), sha(Uint8Array.of(255, 188, 0, 255, 0, 0, 0, 255)));
		assert.equal(f.calls.close, 1); assert.equal(f.native.statistics.created, 0); await scheduler.close();
	} finally { release.release(); await f.close(); }
});

test('Lightscaper scoped preview preserves fixed Photo profile admission before any Original acquisition', deadline, async context => {
	for (const [Owner, schema] of [[PhotoPreviewSchedulerV1, 2], [PhotoPreviewSchedulerV2, 3]] as const) {
		const f = await scopedPreviewFixtureCurrentV1(context, { schema });
		try { const scheduler = f.make(Owner); await assert.rejects(f.run(scheduler)); assert.equal(f.calls.acquire, 0); await scheduler.close(); }
		finally { await f.close(); }
	}
});

test('Lightscaper scoped preview closes rejected length-mismatched genuine File without invoking producer', deadline, async context => {
	const f = await scopedPreviewFixtureCurrentV1(context); let retired = 0;
	try {
		const scheduler = f.make(PhotoPreviewSchedulerCurrentV1, { originalSource: { async acquire() {
			return { body: new File([Uint8Array.of(1)], 'wrong.dng'), async close() { retired++; } };
		} } });
		await assert.rejects(f.run(scheduler), /byte length/u); assert.equal(retired, 1); assert.equal(f.calls.frames, 0); await scheduler.close();
	} finally { await f.close(); }
});

test('Lightscaper scoped preview requires a callable source or a genuine legacy loader within closed scheduler options', deadline, async context => {
	const f = await scopedPreviewFixtureCurrentV1(context);
	try {
		for (const source of [null, { acquire: 1 }, {}]) assert.throws(() => f.make(PhotoPreviewSchedulerCurrentV1, { originalSource: source }));
		assert.throws(() => f.make(PhotoPreviewSchedulerCurrentV1, { originalSource: undefined }));
		assert.throws(() => f.make(PhotoPreviewSchedulerCurrentV1, { loadOriginal: null }));
		assert.throws(() => f.make(PhotoPreviewSchedulerCurrentV1, { extra: true }));
		assert.equal(f.calls.acquire, 0);
	} finally { await f.close(); }
});

test('Lightscaper scoped preview captures a prototype acquire method with its actual private-field receiver', deadline, async context => {
	const f = await scopedPreviewFixtureCurrentV1(context); let acquired = 0, retired = 0;
	class SelectedSource {
		readonly #body = f.body;
		async acquire(request: Readonly<PhotoLibraryOriginalRequestCurrentV1>) {
			assert.deepEqual(request.original, f.current().original); acquired++;
			return { body: this.#body, close: async () => { retired++; } };
		}
	}
	try {
		const source = new SelectedSource(), scheduler = f.make(PhotoPreviewSchedulerCurrentV1, { originalSource: source });
		Reflect.set(source, 'acquire', async () => { assert.fail('Replaced prototype capability was read.'); });
		assert.equal((await f.run(scheduler)).outcome, 'ready'); assert.equal(acquired, 1); assert.equal(retired, 1); await scheduler.close();
	} finally { await f.close(); }
});

test('Lightscaper preview admits the actual Desktop Original owner without manufacturing a plain source facade', deadline, async context => {
	const f = await scopedPreviewFixtureCurrentV1(context);
	const source = new DesktopPhotoOriginalSourceCurrentV1({
		open: async () => { assert.fail('Missing Photo must not request native bytes.'); },
		read: async () => { assert.fail('Missing Photo must not read native bytes.'); }, close: async () => undefined,
	}, { storage: { getDirectory: async () => { assert.fail('Missing Photo must not stage native bytes.'); } } });
	try {
		const scheduler = f.make(PhotoPreviewSchedulerCurrentV1, { originalSource: source, loadPhoto: async () => null });
		assert.equal((await f.run(scheduler)).outcome, 'missing'); await scheduler.close();
	} finally { await source.close(); await f.close(); }
});

test('Lightscaper scoped preview preserves a genuine legacy Blob fallback and its original options receiver', deadline, async context => {
	const f = await scopedPreviewFixtureCurrentV1(context, { schema: 1 }); let receiverMatches = false;
	try {
		const options = { catalogId: f.current().catalogId, cache: f.ports.cache, loadPhoto: f.ports.loadPhoto, regenerate: f.ports.regenerate,
			async loadOriginal(key: string) { receiverMatches = this === options; assert.equal(key, f.current().original.storageKey); return f.body; } };
		const scheduler = new PhotoPreviewSchedulerV1(options);
		try { assert.equal((await f.run(scheduler)).outcome, 'ready'); assert.equal(receiverMatches, true); assert.equal(f.calls.acquire, 0); }
		finally { await scheduler.close(); }
	} finally { await f.close(); }
});


test('Lightscaper scoped preview registers its active join before acquisition synchronously reenters Close', deadline, async context => {
	const f = await scopedPreviewFixtureCurrentV1(context), entered = f.gate(), release = f.gate();
	let scheduler: ReturnType<typeof f.make>, closing: Promise<void> | undefined, retired = 0;
	try {
		scheduler = f.make(PhotoPreviewSchedulerCurrentV1, { originalSource: { async acquire() {
			closing = scheduler.close(); entered.release(); await release.promise;
			return { body: f.body, async close() { retired++; } };
		} } });
		const work = f.run(scheduler), observed = work.then(() => false, () => true);
		await f.wait(entered, work); context.signal.throwIfAborted(); assert.ok(closing); assert.equal(await remainsPending(closing), true);
		release.release(); await closing; assert.equal(await observed, true); assert.equal(retired, 1); assert.equal(f.calls.frames, 0);
	} finally { release.release(); await f.close(); }
});


test('Lightscaper failed owned preview rejects a control wait promptly and still joins its actual work', deadline, async context => {
	const f = await scopedPreviewFixtureCurrentV1(context), neverEntered = f.gate(), reason = Symbol('source-refusal');
	try {
		f.hooks.acquire = async () => { throw reason; };
		const scheduler = f.make(), work = f.run(scheduler);
		const outcome = await f.wait(neverEntered, work).then(() => ({ okay: true as const }),
			(error: unknown) => ({ okay: false as const, error }));
		assert.equal(outcome.okay, false); if (!outcome.okay) assert.equal(outcome.error, reason);
		assert.equal(neverEntered.isReleased(), false); assert.equal(f.calls.frames, 0); assert.equal(f.calls.close, 0); await scheduler.close();
	} finally { await f.close(); }
});
