/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { scopedCollectionNativeFixtureCurrentV1 as fixture, scopedCollectionNativeShaCurrentV1 as sha,
	remainsPending } from './helpers/lightscaper-scoped-collection-originals-integration-fixture-current.ts';

for (const kind of ['manual', 'smart', 'saved'] as const) test(`Native ${kind} collection authenticates all six Photo authorities and delivers real staged File bodies`, { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		await f.capture(async view => {
			const ids = f.photos.map(photo => photo.id); if (kind === 'saved') ids.reverse();
			assert.deepEqual(view.photos.map(photo => photo.binding.photoId), ids);
			assert.deepEqual(f.requests[0]!.map(request => request.photoId), ids);
			assert.equal(f.counts().opens, 1); assert.equal(f.counts().singles, 0); assert.equal(f.counts().closes, 0);
			assert.equal(f.files.length, 2); assert.ok(f.files.every(file => file instanceof File));
			assert.equal(new Set(f.reads).size, 6, 'Every same-key/digest alias is read through its own native Photo authority.');
			for (const photo of view.photos) await view.withOriginal(photo.binding.photoId, async body => {
				assert.ok(body instanceof Blob); assert.equal(body.size, photo.original.byteLength);
				assert.equal(sha(new Uint8Array(await body.arrayBuffer())), photo.original.contentSha256);
			});
		}, { signal: context.signal }, kind);
		assert.deepEqual(f.counts(), { opens: 1, closes: 1, singles: 0, stages: 0 });
	});
});

test('Native collection holds each locator pin after root release and retires it only after whole consumer settles', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const keys = [...new Set(f.photos.map(photo => photo.original.storageKey))];
		await f.capture(async view => {
			await view.withOriginal(view.photos[0]!.binding.photoId, async body => {
				assert.equal(sha(new Uint8Array(await body.arrayBuffer())), view.photos[0]!.original.contentSha256);
			});
			for (const key of keys) {
				await f.roots(key, false);
				try { await assert.rejects(f.components.media.deleteAsset(key), /pinned.*live consumer/iu); }
				finally { await f.roots(key, true); }
			}
		});
		for (const key of keys) { await f.roots(key, false); await f.components.media.deleteAsset(key); assert.equal(await f.components.media.getAssetMetadata(key), null); }
		assert.equal(f.counts().closes, 1); assert.equal(f.counts().stages, 0);
	});
});

for (const failure of ['same-key-root', 'different-key-body'] as const) test(`Native complete collection refuses missing later ${failure} without delivering a prefix`, { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const selected = f.photos[failure === 'same-key-root' ? 2 : 3]!;
		await f.components.media.catalogOriginals.release(selected.catalogId, [selected.id]);
		if (failure === 'different-key-body') await f.components.media.deleteAsset(selected.original.storageKey);
		let delivered = 0;
		await assert.rejects(f.capture(() => { delivered++; })); assert.equal(delivered, 0); assert.equal(f.counts().opens, 1);
		assert.equal(f.counts().singles, 0); assert.equal(f.counts().stages, 0);
		// Removing real roots after a refused all-or-none admission must leave
		// no surviving first-prefix native pin.
		await f.roots('collection-shared', false); await f.components.media.deleteAsset('collection-shared');
		assert.equal(await f.components.media.getAssetMetadata('collection-shared'), null);
	});
});

for (const kind of ['original', 'lut', 'brush'] as const) test(`Native collection joins escaped ${kind} child before real group/File retirement`, { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const entered = f.gate(), release = f.gate(); let child: Promise<unknown> | undefined;
		const work = f.capture(view => {
			const hold = async (bytes: Uint8Array): Promise<void> => { assert.ok(bytes.byteLength); entered.release(); await release.promise; };
			child = kind === 'original' ? view.withOriginal(view.photos[0]!.binding.photoId, async body => { await hold(new Uint8Array(await body.arrayBuffer())); })
				: kind === 'lut' ? view.withLutBytes(view.lutReferences[0]!, hold) : view.withMaskRasterBytes(view.maskRasterReferences[0]!, hold);
			void child.catch(() => undefined); return 'outer returned';
		}, { signal: context.signal });
		try { await f.reached(entered.promise, work); assert.equal(f.counts().closes, 0); assert.equal(f.counts().stages, 2);
			assert.equal(await remainsPending(work), true); release.release(); assert.equal(await work, 'outer returned'); await child;
			assert.equal(f.counts().closes, 1); assert.equal(f.counts().stages, 0);
		} finally { release.release(); await Promise.allSettled([work, child]); }
	});
});

test('Native collection final full Photo/index fence refuses an actual catalog edit before group cleanup completes', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		await assert.rejects(f.capture(async () => {
			assert.equal(f.counts().closes, 0); const photo = f.photos[0]!;
			await f.components.catalog.savePhoto(normalizePhotoDocumentCurrentV1({ ...photo, metadata: { ...photo.metadata, caption: 'Changed while exporting' } }), photo.revision);
		}), /changed|revision|conflict/iu);
		assert.equal(f.counts().closes, 1); assert.equal(f.counts().stages, 0);
	});
});

test('Native collection cancellation joins held actual OPFS-port write, group ticket and Session before cleanup', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const entered = f.gate(), release = f.gate(), stop = new AbortController(), reason = Symbol('Native group cancelled');
		f.storage.hooks.write = async () => { entered.release(); await release.promise; };
		let delivered = 0;
		const work = f.capture(() => { delivered++; }, { signal: stop.signal });
		const outcome = work.then(() => ({ okay: true, error: undefined as unknown }), (error: unknown) => ({ okay: false, error }));
		try { await f.reached(entered.promise, work); stop.abort(reason); const closing = f.session.close();
			assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing), true); release.release();
			const result = await outcome; assert.equal(result.okay, false); assert.equal(Object.is(result.error, reason), true);
			await closing; assert.equal(delivered, 0); assert.equal(f.counts().closes, 1); assert.equal(f.counts().stages, 0);
		} finally { release.release(); await Promise.allSettled([work, outcome]); }
	});
});
