/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { encodePixelFramePng16V1 } from '../src/common/editor/imaging/pixel-frame-png16-v1.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { withPhotoLibraryImageHandoffForProfileV1 } from '../src/lightscaper/controller/internal/photo-library-image-handoff-kernel-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { LUT_REFERENCE, LUT_BODY } from './helpers/lightscaper-lut-archive-fixture.ts';
import { withPhotoOriginalFrameCurrentV1 } from '../src/lightscaper/preview/photo-original-frame-current-v1.ts';
import { rawDerivedOriginalNativeCurrentV1 } from './helpers/lightscaper-raw-derived-original-current-fixture.ts';
import { scopedExportOriginalFixtureCurrentV1 as fixture, exportOriginalTestCurrentV1 as test, deferred, remainsPending,
	exportOriginalShaCurrentV1 as sha, exportReachedCurrentV1 as reached, exportExactFailureCurrentV1 as exactFailure } from './helpers/lightscaper-scoped-export-original-fixture-current.ts';

void test('Current source-only image handoff retains actual ticket through held File read, native RAW decode, PNG16 encode and decoder retirement', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const native = await rawDerivedOriginalNativeCurrentV1(), entered = deferred<void>(), release = deferred<void>(), retiring = deferred<void>(), retired = deferred<void>();
		let borrowed: Uint16Array | undefined, work: Promise<unknown> | undefined;
		const actualRead = Blob.prototype.arrayBuffer; let holdBodyRead = false;
		const renderer = createPhotoDevelopRenderRuntimeCurrentV1();
		Blob.prototype.arrayBuffer = function () {
			const result = Reflect.apply(actualRead, this, []) as Promise<ArrayBuffer>;
			if (!holdBodyRead) return result; holdBodyRead = false;
			// The owning decoder deliberately slices a canonical native Blob from
			// the File. Hold its actual first read receipt, not object identity.
			return result.then(async bytes => { assert.equal(bytes.byteLength, f.photo.original.byteLength); entered.resolve(); await release.promise; return bytes; });
		};
		const abort = (): void => { release.resolve(); retired.resolve(); };
		context.signal.addEventListener('abort', abort, { once: true }); if (context.signal.aborted) abort();
		try {
			native.hooks.afterCanonical = async () => { retiring.resolve(); await retired.promise; };
			work = f.image(async view => {
				holdBodyRead = true; const original = f.photo.original;
				return await withPhotoOriginalFrameCurrentV1({ body: view.originalBlob, signal: view.signal, binding: {
					catalogId: f.photo.catalogId, photoId: f.photo.id, originalId: original.id, storageKey: original.storageKey,
					contentSha256: original.contentSha256, byteLength: original.byteLength, width: original.width, height: original.height } }, async frame => {
					assert.equal(frame.descriptor.sampleFormat, 'unorm16'); assert.ok(frame.pixels instanceof Uint16Array);
					assert.ok(frame.pixels.some(value => value > 0)); borrowed = frame.pixels;
					return renderer.withFullResolution({ frame, develop: f.photo.versions[0]!.develop, signal: view.signal }, async output => {
						assert.equal(output.frame.descriptor.sampleFormat, 'float32');
						const encoded = await encodePixelFramePng16V1(output.frame, { signal: view.signal });
						assert.equal(encoded[24], 16); assert.equal(encoded[25], 6); assert.equal(f.calls().releases, 0);
						return sha(encoded);
					});
				}, { withRawFrame: (request, consume) => native.ports.withRawFrame!(request, consume) });
			}); void work.catch(() => undefined);
			await reached(entered.promise, work); assert.equal(f.calls().releases, 0); await f.provePinned();
			release.resolve(); await reached(retiring.promise, work); assert.equal(native.canonical.statistics.joined, 1);
			assert.equal(f.calls().releases, 0); assert.equal(await remainsPending(work), true); assert.ok(borrowed);
			assert.equal(borrowed.every(value => value === 0), true); retired.resolve(); assert.match(String(await work), /^[a-f0-9]{64}$/u);
			assert.equal(f.calls().releases, 1); assert.equal(f.calls().fallbacks, 0);
		} finally {
			abort(); context.signal.removeEventListener('abort', abort); await Promise.allSettled([work]);
			Blob.prototype.arrayBuffer = actualRead; await native.close();
		}
	});
});

void test('Current image handoff Original lease survives the final native whole Photo publication fence', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const entered = deferred<void>(), release = deferred<void>();
		f.hooks.loaded = async count => { if (count === 3) { entered.resolve(); await release.promise; } };
		const work = f.image(async view => { assert.equal(sha(new Uint8Array(await view.originalBlob.arrayBuffer())), f.photo.original.contentSha256); return 'encoded'; });
		void work.catch(() => undefined);
		try { await reached(entered.promise, work); assert.equal(f.calls().releases, 0); assert.equal(await remainsPending(work), true);
			release.resolve(); assert.equal(await work, 'encoded'); assert.equal(f.calls().releases, 1);
		} finally { release.resolve(); await Promise.allSettled([work]); }
	});
});

void test('Current image handoff cancellation joins actual consumer before native ticket release and source cleanup', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
		const reason = new Proxy({}, { get() { assert.fail('Opaque export reason inspected.'); }, getPrototypeOf() { assert.fail('Opaque export reason reflected.'); } });
		const work = f.image(async view => { await view.originalBlob.arrayBuffer(); entered.resolve(); await release.promise; return 'late'; }, stop.signal);
		const refusal = exactFailure(work, reason);
		try { await reached(entered.promise, work); stop.abort(reason); const closing = f.close();
			assert.equal(await remainsPending(closing), true); assert.equal(f.calls().releases, 0); release.resolve(); await refusal; await closing;
			assert.equal(f.calls().releases, 1);
		} finally { release.resolve(); await Promise.allSettled([work, refusal]); }
	});
});

void test('Current image handoff source and receiver are pinned before asynchronous Photo loading', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const entered = deferred<void>(), release = deferred<void>();
		f.hooks.loaded = async count => { if (count === 1) { entered.resolve(); await release.promise; } };
		const work = f.image(async () => 'source'); void work.catch(() => undefined);
		try { await reached(entered.promise, work);
			f.originalSource.acquire = async () => { assert.fail('Source acquire was not captured at operation start.'); };
			release.resolve(); assert.equal(await work, 'source'); assert.equal(f.calls().acquisitions, 1); assert.equal(f.calls().releases, 1);
		} finally { release.resolve(); await Promise.allSettled([work]); }
	});
});

void test('Current image handoff fails real digest or changed whole Photo without publishing and still retires lease', { timeout: 15_000 }, async context => {
	for (const mode of ['digest', 'photo'] as const) await fixture(context, async f => {
		if (mode === 'digest') f.hooks.body = body => new File([new Uint8Array(body.size)], body.name, { type: body.type });
		let consumers = 0;
		await assert.rejects(f.image(async () => {
			consumers++; await f.native.catalog.savePhoto({ ...f.photo, metadata: { ...f.photo.metadata, title: 'Changed while encoding' } }, f.photo.revision);
		}), /identity|hash|revision|changed/iu);
		assert.equal(consumers, mode === 'digest' ? 0 : 1); assert.equal(f.calls().releases, 1);
	});
});

void test('Current image handoff preserves genuine Web File fallback when no scoped source exists', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		Reflect.deleteProperty(f.ports, 'originalSource');
		const backup = { readSnapshot: f.native.catalog.readSnapshot.bind(f.native.catalog),
			captureSmartCollectionArchiveV1: f.native.catalog.captureSmartCollectionArchiveV1.bind(f.native.catalog),
			loadOriginal: f.fallback.loadOriginal.bind(f.fallback) };
		Object.defineProperty(f.ports, 'backup', { value: backup });
		assert.equal(await f.image(async view => sha(new Uint8Array(await view.originalBlob.arrayBuffer()))), f.photo.original.contentSha256);
		assert.equal(f.calls().fallbacks, 1); assert.equal(f.calls().acquisitions, 0);
	});
});

void test('Current handoff joins actual retained LUT child cleanup before closing Original lease or publishing final facts', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const resources = await f.native.resources.cubeLutResources(); await resources.put(LUT_REFERENCE, LUT_BODY);
		const version = f.photo.versions[0]!;
		const photo = await f.native.catalog.savePhoto(normalizePhotoDocumentCurrentV1({ ...f.photo, schemaVersion: 2,
			versions: [{ ...version, develop: { ...version.develop, processVersion: 2,
				effects: [{ id: 'retained-lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: LUT_REFERENCE } }] } }] }), f.photo.revision);
		const entered = deferred<void>(), release = deferred<void>(); let reads = 0, child: Promise<unknown> | undefined;
		const source: CubeLutSourcePortV1 = { withBytes(reference, consume, options) {
			return resources.source.withBytes(reference, async bytes => {
				const result = await consume(bytes); if (++reads === 2) { entered.resolve(); await release.promise; } return result;
			}, options);
		} };
		const ports = { ...f.ports, cubeLutResources: async () => ({ ...resources, source }) };
		const work = f.lifetime.operation(signal => withPhotoLibraryImageHandoffForProfileV1('current3', ports, photo.catalogId,
			{ ...f.request, expectedRevision: photo.revision }, view => {
				child = view.withLutBytes(LUT_REFERENCE, bytes => { assert.equal(sha(bytes), LUT_REFERENCE.sha256); });
				void child.catch(() => undefined); return 'encoded';
			}, signal)); void work.catch(() => undefined);
		try { await reached(entered.promise, work); assert.equal(f.calls().releases, 0); assert.equal(await remainsPending(work), true);
			release.resolve(); assert.equal(await work, 'encoded'); assert.equal(f.calls().releases, 1); await child;
		} finally { release.resolve(); await Promise.allSettled([work, child]); }
	});
});

for (const shared of [false, true]) void test(`Current image handoff preserves ${shared ? 'identical' : 'distinct'} opaque Original retirement failures`, { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const primary = Symbol('Image consumer failure'), cleanup = shared ? primary : Symbol('Original retirement failure');
		f.hooks.released = async () => { throw cleanup; };
		const outcome = await f.image(() => { throw primary; }).then(() => ({ failed: false, error: undefined as unknown }),
			(error: unknown) => ({ failed: true, error }));
		assert.equal(outcome.failed, true); assert.equal(f.calls().releases, 1);
		if (shared) assert.equal(Object.is(outcome.error, primary), true);
		else {
			assert.ok(outcome.error instanceof AggregateError); assert.equal(outcome.error.errors.length, 2);
			assert.equal(Object.is(outcome.error.errors[0], primary), true); assert.equal(Object.is(outcome.error.errors[1], cleanup), true);
		}
	});
});
