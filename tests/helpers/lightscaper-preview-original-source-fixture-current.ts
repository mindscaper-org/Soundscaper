/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { TestContext } from 'node:test';
import { compilePinnedLibRawModuleV1 } from '../../src/common/editor/raw/libraw-runtime-asset-v1.ts';
import { canonicalMediaContentBlob } from '../../src/common/editor/storage/media-content-digest.ts';
import { withDecodedRawOriginalV1, withRawEmbeddedPreviewV1 } from '../../src/common/editor/raw/libraw-runtime-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { PhotoPreviewSchedulerCurrentV1 } from '../../src/lightscaper/preview/photo-preview-scheduler-current-v1.ts';
import type { PhotoPreviewSchedulerOptionsCurrentV1 } from '../../src/lightscaper/preview/photo-preview-scheduler-current-v1.ts';
import type { PhotoPreviewSchedulerV1 } from '../../src/lightscaper/preview/photo-preview-scheduler-v1.ts';
import type { PhotoPreviewSchedulerV2 } from '../../src/lightscaper/preview/photo-preview-scheduler-v2.ts';
import { withPhotoPreviewOriginalFrameCurrentV1, withPhotoOriginalFrameCurrentV1 } from '../../src/lightscaper/preview/photo-original-frame-current-v1.ts';
import { withPhotoCullingFrameCurrentV1 } from '../../src/lightscaper/preview/photo-culling-frame-current-v1.ts';
import type { PreparedPhotoPreviewV1 } from '../../src/lightscaper/preview/photo-preview-preparation-v1.ts';
import type { PhotoPreviewCachePortCore, PhotoPreviewPreparedCore } from '../../src/lightscaper/preview/photo-preview-scheduler-core.ts';
import type { PreparedPhotoCullingPreviewCurrentV1 } from '../../src/lightscaper/preview/photo-culling-preview-preparation-current-v1.ts';
import type { PreparedPhotoHdrPreviewCurrentV1 } from '../../src/lightscaper/preview/photo-hdr-preview-preparation-current-v1.ts';
import type { PhotoLibraryOriginalSourceCurrentV1 } from '../../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';
import { rawDngFixtureV1 } from './lightscaper-raw-dng-current-fixture.ts';
import { rawWorkerFixtureV1 } from './lightscaper-raw-worker-current-fixture.ts';
import { hdrFrameFixtureCurrentV1 } from './lightscaper-hdr-frame-current-fixture.ts';

export const scopedPreviewShaCurrentV1 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export type ScopedPreviewSchedulerCurrentV1 = PhotoPreviewSchedulerCurrentV1 | PhotoPreviewSchedulerV1 | PhotoPreviewSchedulerV2;
type Owner = typeof PhotoPreviewSchedulerCurrentV1 | typeof PhotoPreviewSchedulerV1 | typeof PhotoPreviewSchedulerV2;
const BODY_BYTES = Blob.prototype.arrayBuffer;
let compiled: Promise<WebAssembly.Module> | undefined;
function moduleBytes() {
	compiled ??= readFile(new URL('../../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url))
		.then(bytes => compilePinnedLibRawModuleV1(new Uint8Array(bytes))); return compiled;
}

/** Production RAW worker + pinned WASM and real File; no substituted decoded
 * pixels. Every diagnostic deadline releases test barriers and aborts actual
 * scheduler work, then finally joins jobs, leases and native workers. */
export async function scopedPreviewFixtureCurrentV1(context: TestContext, options: Readonly<{ schema?: 1 | 2 | 3; hdr?: boolean }> = {}) {
	const stop = new AbortController(), releases = new Set<() => void>(), owners = new Set<ScopedPreviewSchedulerCurrentV1>(), work = new Set<Promise<unknown>>();
	const cancel = () => { for (const release of releases) release(); stop.abort(context.signal.reason); };
	context.signal.addEventListener('abort', cancel, { once: true }); if (context.signal.aborted) cancel();
	const native = await rawWorkerFixtureV1();
	const raw = rawDngFixtureV1(), hdr = options.hdr ? await hdrFrameFixtureCurrentV1() : undefined;
	const seed = photoArchiveFixture(1, raw.bytes).photo;
	let photo = hdr?.photo ?? normalizePhotoDocumentCurrentV1({ ...seed, schemaVersion: options.schema ?? 3,
		original: { ...seed.original, name: 'Scoped actual.dng', mimeType: 'image/x-adobe-dng', width: 32, height: 32 } });
	const bytes = hdr?.original ?? raw.bytes, body = new File([bytes], photo.original.name, { type: photo.original.mimeType });
	const events: string[] = [], pixels: ArrayBuffer[] = [];
	const hooks = { acquire: async (): Promise<void> => undefined, closeLease: async (): Promise<void> => undefined,
		frame: async (): Promise<void> => undefined, decoderRetired: async (): Promise<void> => undefined,
		loadPhoto: async (): Promise<void> => undefined, store: async (): Promise<void> => undefined,
		trim: async (): Promise<void> => undefined };
	const calls = { acquire: 0, close: 0, fallback: 0, frames: 0, photos: 0, stores: 0, trims: 0 };
	const originalSource: PhotoLibraryOriginalSourceCurrentV1 = { async acquire(request, value) {
		assert.equal(this, originalSource); assert.equal(request.catalogId, photo.catalogId); assert.equal(request.photoId, photo.id);
		assert.deepEqual(request.original, photo.original); assert.ok(value?.signal instanceof AbortSignal);
		calls.acquire++; events.push('acquire'); await hooks.acquire();
		return { body, async close() { calls.close++; events.push('lease-close'); await hooks.closeLease(); } };
	} };
	const rawFrame: typeof withDecodedRawOriginalV1 = (value, consume) => withDecodedRawOriginalV1(value, frame => {
		assert.equal(native.active(), 0); pixels.push(frame.frame.pixels.buffer); return consume(frame);
	}, { loadModule: moduleBytes, createWorker: native.createWorker });
	async function assertBody(value: unknown): Promise<void> {
		const canonical = canonicalMediaContentBlob(Reflect.get(value as object, 'body'));
		assert.equal(body instanceof File, true); assert.equal(canonical.size, bytes.byteLength);
		assert.equal(scopedPreviewShaCurrentV1(new Uint8Array(await Reflect.apply(BODY_BYTES, canonical, []) as ArrayBuffer)), scopedPreviewShaCurrentV1(bytes));
	}
	const regenerate: NonNullable<PhotoPreviewSchedulerOptionsCurrentV1['regenerate']> = async (value, consume) => {
		await assertBody(value);
		const result = await withPhotoPreviewOriginalFrameCurrentV1(value, async (frame, provenance) => {
			calls.frames++; events.push('frame'); await hooks.frame(); return consume(frame, provenance);
		}, { withRawFrame: rawFrame });
		events.push('decoder-retired'); await hooks.decoderRetired(); return result;
	};
	const regenerateCulling: typeof withPhotoCullingFrameCurrentV1 = (value, consume) => withPhotoCullingFrameCurrentV1(value, consume, {
		withRawPreview: (request, accept) => withRawEmbeddedPreviewV1(request, accept, { loadModule: moduleBytes, createWorker: native.createWorker }),
		withOriginalFrame: regenerate,
	});
	const regenerateHdr: typeof withPhotoOriginalFrameCurrentV1 = (value, consume) => withPhotoOriginalFrameCurrentV1(value, async (frame, provenance) => {
		await assertBody(value); calls.frames++; events.push('frame'); await hooks.frame(); return consume(frame, provenance);
	});
	function cacheFor<Prepared extends PhotoPreviewPreparedCore>() {
		let stored: Readonly<Prepared> | null = null;
		const cache: PhotoPreviewCachePortCore<Prepared> = { async load() { return stored; }, async store(value) {
			calls.stores++; events.push('store'); await hooks.store(); stored = value as Readonly<Prepared>; return { outcome: 'stored' };
		}, async trim() { calls.trims++; events.push('trim'); await hooks.trim(); return { removedEntries: 0, removedBytes: 0, more: false }; } };
		return { cache, clear() { stored = null; } };
	}
	const canonical = cacheFor<PreparedPhotoPreviewV1>(), culling = cacheFor<PreparedPhotoCullingPreviewCurrentV1>(), high = cacheFor<PreparedPhotoHdrPreviewCurrentV1>();
	const ports = { catalogId: photo.catalogId, originalSource, cache: canonical.cache, cullingCache: culling.cache, hdrCache: high.cache,
		async loadPhoto() { calls.photos++; events.push('photo'); await hooks.loadPhoto(); return photo; },
		async loadOriginal() { calls.fallback++; return body; }, regenerate, regenerateCulling, regenerateHdr };
	const gate = () => {
		let resolve!: () => void, released = false; const promise = new Promise<void>(done => { resolve = done; });
		const release = () => { released = true; resolve(); releases.delete(release); }; releases.add(release); if (stop.signal.aborted) release();
		return { promise, release, isReleased: () => released };
	};
	// Control waits observe failure of the already-owned job promptly. They do
	// not retire or replace it; close still joins every real job and native IO.
	const wait = (gate: Readonly<{ promise: Promise<void>; isReleased(): boolean }>, terminal: Promise<unknown>): Promise<void> => new Promise<void>((resolve, reject) => {
		void gate.promise.then(resolve, reject);
		void terminal.then(() => { if (!gate.isReleased()) reject(new Error('Preview job settled before the expected control receipt.')); },
			(error: unknown) => { if (!gate.isReleased()) reject(error); });
	});
	let closing: Promise<void> | undefined;
	return { native, hooks, calls, events, body, bytes, pixels, originalSource, ports, stop, gate, wait, current: () => photo,
		replace(value: unknown) { photo = normalizePhotoDocumentCurrentV1(value); },
		make(OwnerClass: Owner = PhotoPreviewSchedulerCurrentV1, changes: Record<string, unknown> = {}, scopedOnly = true): ScopedPreviewSchedulerCurrentV1 {
			const base: Record<string, unknown> = { ...ports };
			if (OwnerClass !== PhotoPreviewSchedulerCurrentV1) for (const key of ['cullingCache', 'hdrCache', 'regenerateCulling', 'regenerateHdr']) delete base[key];
			if (scopedOnly) delete base.loadOriginal;
			const scheduler = Reflect.construct(OwnerClass, [{ ...base, ...changes }]) as ScopedPreviewSchedulerCurrentV1; owners.add(scheduler); return scheduler;
		},
		run(scheduler: ScopedPreviewSchedulerCurrentV1, changes: Record<string, unknown> = {}) {
			const signal = changes.signal instanceof AbortSignal ? AbortSignal.any([stop.signal, changes.signal]) : stop.signal;
			const task = scheduler.request({ photoId: photo.id, tier: 'thumbnail', ...changes, signal }); work.add(task);
			void task.then(() => { work.delete(task); }, () => { work.delete(task); }); return task;
		},
		close(): Promise<void> {
			closing ??= Promise.resolve().then(async () => {
				for (const release of releases) release(); stop.abort(new Error('Scoped preview fixture closing.'));
				await Promise.allSettled([...owners].map(owner => owner.close())); await Promise.allSettled([...work]);
				try { await native.close(); } finally { context.signal.removeEventListener('abort', cancel); }
				for (const backing of pixels) assert.equal(new Uint8Array(backing).every(byte => byte === 0), true);
			}); return closing;
		},
	};
}
