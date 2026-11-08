/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeOriginalReaderFixtureCurrentV1 as fixture, holdReaderFileReadCurrentV1 as holdRead,
	deferred, remainsPending, exactReaderFailureCurrentV1 as exactFailure,
	READER_CATALOG_CURRENT_V1 as CATALOG, Media } from './helpers/lightscaper-native-photo-original-reader-fixture-current.ts';

function opaqueReason() { return new Proxy(Object.create(null) as object, { get() { throw new Error('An opaque abort reason was inspected.'); } }); }

test('Lightscaper native Original reader refuses overlapping pulls and joins native read retirement on close', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		await holdRead(f.appDataPath, async gate => {
			const consumer = deferred<void>(); let first: Promise<Uint8Array> | undefined;
			const work = f.reader.withOriginal(f.request, async view => {
				first = view.read(0, 97); void first.catch(() => undefined); await gate.entered;
				await assert.rejects(view.read(97, 11)); await consumer.promise; await first;
			});
			void work.catch(() => undefined); let close: Promise<void> | undefined;
			try {
				await gate.entered; close = f.reader.close(); assert.equal(close, f.reader.close());
				assert.equal(await remainsPending(close), true); consumer.resolve(); assert.equal(await remainsPending(close), true);
				gate.release(); await assert.rejects(work); await close;
			} finally { consumer.resolve(); gate.release(); await Promise.allSettled([work, close]); }
		});
	});
});

test('Lightscaper native Original reader callback failure waits for accepted native reads before unpinning', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const peer = await Media.open({ appDataPath: f.appDataPath });
		try {
			await holdRead(f.appDataPath, async gate => {
				const reason = opaqueReason();
				const work = f.reader.withOriginal(f.request, async view => {
					const read = view.read(0, 101); void read.catch(() => undefined); await gate.entered; throw reason;
				});
				void work.catch(() => undefined);
				try {
					await gate.entered; assert.equal(await remainsPending(work), true);
					await peer.catalogOriginals.release(CATALOG, [f.entry.photo.id]); await assert.rejects(peer.deleteAsset(f.entry.original.storageKey));
					gate.release(); await exactFailure(work, reason); await peer.deleteAsset(f.entry.original.storageKey);
				} finally { gate.release(); await Promise.allSettled([work]); }
			});
		} finally { await peer.close(); }
	});
});

test('Lightscaper native Original reader keeps its consumer pin after the last byte until callback retirement', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const entered = deferred<void>(), release = deferred<void>();
		const work = f.reader.withOriginal(f.request, async view => { await view.read(0, 1); entered.resolve(); await release.promise; });
		void work.catch(() => undefined);
		try {
			await entered.promise; await f.media.catalogOriginals.release(CATALOG, [f.entry.photo.id]);
			await assert.rejects(f.media.deleteAsset(f.entry.original.storageKey));
			const close = f.reader.close(); assert.equal(await remainsPending(close), true);
			release.resolve(); await assert.rejects(work); await close;
			await f.media.deleteAsset(f.entry.original.storageKey);
		} finally { release.resolve(); await Promise.allSettled([work]); }
	});
});

test('Lightscaper native Original reader preserves opaque caller cancellation while joining the held physical pull', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		await holdRead(f.appDataPath, async gate => {
			const controller = new AbortController(), reason = opaqueReason();
			const work = f.reader.withOriginal(f.request, async view => { await view.read(0, 111); }, { signal: controller.signal });
			void work.catch(() => undefined); let close: Promise<void> | undefined;
			try {
				await gate.entered; controller.abort(reason);
				assert.equal(await remainsPending(work), true); close = f.reader.close(); assert.equal(await remainsPending(close), true);
				gate.release(); await exactFailure(work, reason); await close;
			} finally { gate.release(); await Promise.allSettled([work, close]); }
		});
	});
});

test('Lightscaper native Original reader persistent scope cancellation fences escaped views and joins callbacks', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const entered = deferred<void>(), release = deferred<void>(), reason = opaqueReason();
		let pull: (() => Promise<Uint8Array>) | undefined;
		const work = f.reader.withOriginal(f.request, async view => { pull = () => view.read(0, 1); entered.resolve(); await release.promise; });
		void work.catch(() => undefined);
		try {
			await entered.promise; f.scope.abort(reason); assert.ok(pull); await exactFailure(pull(), reason);
			const close = f.reader.close(); assert.equal(await remainsPending(close), true); release.resolve(); await exactFailure(work, reason); await close;
		} finally { release.resolve(); await Promise.allSettled([work]); }
	});
});

test('Lightscaper native Original reader registers admission before options reflection can reenter close', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		let closing: Promise<void> | undefined, called = false;
		const options = new Proxy({}, { ownKeys(target) { closing = f.reader.close(); return Reflect.ownKeys(target); } });
		const work = f.reader.withOriginal(f.request, () => { called = true; }, options); void work.catch(() => undefined);
		await assert.rejects(work); assert.ok(closing); await closing; assert.equal(called, false);
		await assert.rejects(f.reader.withOriginal(f.request, () => undefined));
	});
});

test('Lightscaper native Original reader rejects preaborted and forged signals before borrowed request access', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const controller = new AbortController(), reason = opaqueReason(); controller.abort(reason);
		let reads = 0; const request = new Proxy(f.request, { ownKeys() { reads++; throw new Error('Request access was too early.'); } });
		await exactFailure(f.reader.withOriginal(request, () => undefined, { signal: controller.signal }), reason); assert.equal(reads, 0);
		await assert.rejects(f.reader.withOriginal(f.request, () => undefined, { signal: {} as AbortSignal }));
	});
});
