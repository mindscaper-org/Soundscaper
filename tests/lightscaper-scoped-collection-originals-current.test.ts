/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { PhotoLibrarySessionCurrentV1 } from '../src/lightscaper/controller/photo-library-session-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { scopedCollectionWebFixtureCurrentV1 as fixture, collectionExactFailureCurrentV1 as exactFailure,
	remainsPending } from './helpers/lightscaper-scoped-collection-originals-web-fixture-current.ts';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

for (const kind of ['manual', 'smart', 'saved'] as const) test(`Current scoped collection ${kind} acquires every Photo alias in one complete genuine File group`, { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const binding = f.base.binding(kind);
		await f.capture(async view => {
			assert.equal(f.calls().groups, 1); assert.equal(f.calls().closes, 0); assert.equal(f.calls().individuals, 0);
			const ids = kind === 'saved' ? [...f.base.selectedPhotos].reverse().map(photo => photo.id) : f.base.selectedPhotos.map(photo => photo.id);
			assert.deepEqual(view.photos.map(photo => photo.binding.photoId), ids); assert.deepEqual(f.requests[0]!.map(request => request.photoId), ids);
			assert.equal(f.requests[0]!.length, f.base.selectedPhotos.length);
			for (const photo of view.photos) await view.withOriginal(photo.binding.photoId, async body => {
				assert.ok(body instanceof Blob); assert.equal(body.size, f.base.encoded.byteLength);
				assert.equal(sha(new Uint8Array(await body.arrayBuffer())), photo.original.contentSha256);
			});
		}, { signal: context.signal }, binding); assert.deepEqual(f.calls(), { groups: 1, closes: 1, individuals: 0 });
	}, { count: 6, mixed: false });
});

test('Scoped collection captures group and resource methods before held group IO can mutate their owners', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const hold = f.gate(); f.hooks.open = hold.hold;
		const work = f.capture(async view => { await view.withLutBytes(f.base.resources.luts[0]!, bytes => { assert.ok(bytes.byteLength > 0); }); });
		try { await f.reached(hold.entered, work);
			f.originalSource.acquireGroup = async () => { assert.fail('Late group capability replacement must not run.'); };
			f.base.lutSource.withBytes = async () => { assert.fail('Late resource capability replacement must not run.'); };
			hold.release(); await work; assert.equal(f.calls().closes, 1);
		} finally { hold.release(); await Promise.allSettled([work]); }
	});
});

test('Scoped collection validates retained-only Current resources and selected capability accessors before group body IO', { timeout: 15_000 }, async context => {
	for (const mode of ['retained-resource', 'capability'] as const) await fixture(context, async f => {
		let getters = 0; const method = f.base.lutSource.withBytes;
		if (mode === 'retained-resource') await f.base.corruptResource(f.base.resources.retainedOnly.storageKey);
		else Object.defineProperty(f.base.lutSource, 'withBytes', { enumerable: true, configurable: true,
			get() { getters++; return method; } });
		await assert.rejects(f.capture(() => { assert.fail('Whole preflight failure cannot deliver a prefix.'); }));
		assert.equal(getters, 0); assert.deepEqual(f.calls(), { groups: 0, closes: 0, individuals: 0 });
	});
});

test('Scoped acquire-only collection refuses before metadata IO even when durable fallback is present', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		Reflect.deleteProperty(f.originalSource, 'acquireGroup'); let metadata = 0;
		const load = f.base.ports.catalog.loadCatalog;
		const actual = f.base.ports.catalog;
		const ports = { ...f.ports, backup: f.base.backup, originalSource: f.originalSource,
			catalog: { loadPhoto: actual.loadPhoto.bind(actual), publishPhotos: actual.publishPhotos.bind(actual),
				savePhoto: actual.savePhoto.bind(actual), saveCatalog: actual.saveCatalog.bind(actual),
				readSummaryPage: actual.readSummaryPage.bind(actual), readQueryPage: actual.readQueryPage.bind(actual),
				rebuildQueryIndexPage: actual.rebuildQueryIndexPage.bind(actual),
				readQueryPageV2: actual.readQueryPageV2!.bind(actual), rebuildQueryIndexPageV2: actual.rebuildQueryIndexPageV2!.bind(actual),
				async loadCatalog(...args: Parameters<typeof load>) {
					metadata++; return Reflect.apply(load, actual, args) as ReturnType<typeof load>;
				} } };
		const session = new PhotoLibrarySessionCurrentV1(ports); f.registerSession(session);
		try { assert.ok(session.collectionHandoffCurrent);
			await assert.rejects(session.collectionHandoffCurrent.withCapture(f.base.manualBinding, () => undefined, { signal: context.signal }), /group|source|capability/iu);
			assert.equal(metadata, 0); assert.equal(f.calls().individuals, 0); assert.equal(f.base.events.includes('original'), false);
		} finally { await session.close(); }
	});
});

test('Scoped collection retains whole group through an escaped body borrower and seals all captured capabilities immediately', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const hold = f.gate(); let retained: Parameters<Parameters<typeof f.capture>[0]>[0] | undefined, child: Promise<unknown> | undefined;
		const work = f.capture(view => { retained = view; child = view.withOriginal(view.photos[0]!.binding.photoId, async body => {
			await body.arrayBuffer(); await hold.hold();
		}); void child.catch(() => undefined); return 'complete'; });
		try { await f.reached(hold.entered, work); assert.ok(retained); assert.equal(f.calls().closes, 0);
			await assert.rejects(retained.withOriginal(retained.photos[0]!.binding.photoId, () => undefined), /closed/iu);
			await assert.rejects(retained.withLutBytes(f.base.resources.luts[0]!, () => undefined), /closed/iu);
			await assert.rejects(retained.withMaskRasterBytes(f.base.resources.brushes[0]!, () => undefined), /closed/iu);
			assert.equal(await remainsPending(work), true); hold.release(); assert.equal(await work, 'complete'); await child;
			assert.equal(f.calls().closes, 1);
		} finally { hold.release(); await Promise.allSettled([work, child]); }
	});
});

test('Scoped collection retains group through actual LUT and brush child cleanup after outer consumption', { timeout: 15_000 }, async context => {
	for (const family of ['lut', 'brush'] as const) await fixture(context, async f => {
		const hold = f.gate(); let child: Promise<unknown> | undefined;
		const work = f.capture(view => {
			child = family === 'lut' ? view.withLutBytes(f.base.resources.luts[0]!, async bytes => { assert.ok(bytes.byteLength); await hold.hold(); })
				: view.withMaskRasterBytes(f.base.resources.brushes[0]!, async bytes => { assert.ok(bytes.byteLength); await hold.hold(); });
			void child.catch(() => undefined); return 'encoded';
		});
		try { await f.reached(hold.entered, work); assert.equal(f.calls().closes, 0); assert.equal(await remainsPending(work), true);
			hold.release(); assert.equal(await work, 'encoded'); await child; assert.equal(f.calls().closes, 1);
		} finally { hold.release(); await Promise.allSettled([work, child]); }
	});
});

test('Scoped collection final same-revision full Photo fence runs before group close', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		await assert.rejects(f.capture(() => {
			assert.equal(f.calls().closes, 0); const photo = f.base.photos[0]!;
			f.base.change(normalizePhotoDocumentCurrentV1({ ...photo, metadata: { ...photo.metadata, caption: 'Complete facts changed' } }), 0);
		}), /changed/iu); assert.equal(f.calls().closes, 1);
	});
});

test('Scoped collection cancellation joins held actual body consumer before whole group and Session retire', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const hold = f.gate(), stop = new AbortController(), reason = Symbol('Scoped collection cancellation');
		const work = f.capture(async view => { await view.withOriginal(view.photos[0]!.binding.photoId, async body => {
			await body.arrayBuffer(); await hold.hold(); }); }, { signal: stop.signal });
		const refused = exactFailure(work, reason);
		try { await f.reached(hold.entered, work); stop.abort(reason); const closing = f.session.close();
			assert.equal(await remainsPending(closing), true); assert.equal(f.calls().closes, 0); hold.release(); await refused; await closing;
			assert.equal(f.calls().closes, 1);
		} finally { hold.release(); await Promise.allSettled([work, refused]); }
	});
});

for (const same of [true, false]) test(`Scoped collection preserves ${same ? 'same' : 'distinct'} opaque consumer and group cleanup failures`, { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const primary = Symbol('Collection failed'), cleanup = same ? primary : Symbol('Group cleanup failed');
		f.hooks.close = async () => { throw cleanup; };
		const outcome = await f.capture(() => { throw primary; }).then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
		if (same) assert.equal(Object.is(outcome.error, primary), true);
		else { assert.ok(outcome.error instanceof AggregateError); assert.equal(outcome.error.errors.length, 2);
			assert.equal(Object.is(outcome.error.errors[0], primary), true); assert.equal(Object.is(outcome.error.errors[1], cleanup), true); }
		assert.equal(f.calls().closes, 1);
	});
});

test('Scoped group capability and receiver are captured by actual Session construction before selected initialization yields', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		f.originalSource.acquireGroup = async () => { assert.fail('Session reread the source after construction.'); };
		await f.capture(() => 'captured'); assert.deepEqual(f.calls(), { groups: 1, closes: 1, individuals: 0 });
	});
});

test('Permanent legacy collection keeps strict View1 facts while using complete scoped group acquisition', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		await f.session.collectionHandoff.withCapture(f.base.manualBinding, async view => {
			assert.equal(view.schemaVersion, 1); assert.equal(Object.hasOwn(view, 'maskRasterReferences'), false);
			assert.equal(f.requests[0]!.length, f.base.selectedPhotos.length);
			for (const entry of view.photos) await view.withOriginal(entry.binding.photoId, async body => {
				assert.equal(sha(new Uint8Array(await body.arrayBuffer())), entry.original.contentSha256);
			});
		}); assert.deepEqual(f.calls(), { groups: 1, closes: 1, individuals: 0 });
	}, { count: 6, mixed: false });
});

test('Collection durable Web fallback retains one body per storage locator and native-order complete delivery', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const session = new PhotoLibrarySessionCurrentV1({ ...f.base.ports, initialize: f.base.ports.initialize.bind(f.base.ports),
			cubeLutResources: f.base.ports.cubeLutResources!.bind(f.base.ports), maskRasterResources: f.base.ports.maskRasterResources!.bind(f.base.ports),
			closeResources: async () => undefined }); f.registerSession(session);
		try { assert.ok(session.collectionHandoffCurrent);
			await session.collectionHandoffCurrent.withCapture(f.base.manualBinding, async view => {
				assert.equal(view.photos.length, f.base.selectedPhotos.length);
				for (const entry of view.photos) await view.withOriginal(entry.binding.photoId, async body => {
					assert.equal(sha(new Uint8Array(await body.arrayBuffer())), entry.original.contentSha256);
				});
			}, { signal: context.signal }); assert.equal(f.base.events.filter(value => value === 'original').length, 1); assert.equal(f.calls().groups, 0);
		} finally { await session.close(); }
	});
});

test('Scoped group remains held through final root and same-revision saved definition fences', { timeout: 15_000 }, async context => {
	for (const mode of ['root', 'saved'] as const) await fixture(context, async f => {
		const binding = mode === 'root' ? f.base.manualBinding : f.base.savedBinding;
		await assert.rejects(f.capture(async () => {
			assert.equal(f.calls().closes, 0);
			if (mode === 'saved') f.base.changeDefinition({ ...f.base.definition, name: 'Same revision replacement' });
			else { const root = await f.base.catalog.loadCatalog(binding.catalogId); assert.ok(root);
				await f.base.catalog.saveCatalog({ ...root, collections: root.collections.map(value => ({ ...value, name: 'Changed root definition' })) }, root.revision); }
		}, {}, binding), /changed/iu); assert.equal(f.calls().closes, 1);
	});
});
