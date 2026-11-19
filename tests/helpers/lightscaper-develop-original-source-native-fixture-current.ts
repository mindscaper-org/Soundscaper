/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import type { PhotoLibraryOriginalSourceCurrentV1 } from '../../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import type { PhotoLibraryDevelopDerivedOriginalSessionHostCurrentV1 } from '../../src/lightscaper/controller/photo-library-develop-derived-original-session-current-v1.ts';
import { withPhotoOriginalFrameCurrentV1 } from '../../src/lightscaper/preview/photo-original-frame-current-v1.ts';
import { withPhotoOriginalDerivedFrameCurrentV1, type PhotoOriginalDerivedFramePortsCurrentV1 } from '../../src/lightscaper/preview/photo-original-derived-frame-current-v1.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';
import { rawDerivedOriginalFixtureCurrentV1, rawDerivedOriginalNativeCurrentV1 } from './lightscaper-raw-derived-original-current-fixture.ts';

/** Actual production workers + manifest-pinned native WASM. Only Worker
 * transport is adapted by the existing fixture; no pixel decoder substitute. */
export async function developOriginalSourceNativeFixtureCurrentV1(schema: 1 | 2 | 3 = 3,
	testSignal?: AbortSignal, releaseHeld: () => void = () => undefined) {
	const lifetime = new AbortController(), pending = new Set<Promise<unknown>>(), events: string[] = [];
	const cancel = () => { releaseHeld(); lifetime.abort(testSignal?.reason ?? new Error('Native Develop fixture cancelled.')); };
	testSignal?.addEventListener('abort', cancel, { once: true });
	if (testSignal?.aborted) cancel();
	let native: Awaited<ReturnType<typeof rawDerivedOriginalNativeCurrentV1>>;
	try { native = await rawDerivedOriginalNativeCurrentV1(); }
	catch (error) { testSignal?.removeEventListener('abort', cancel); throw error; }
	if (lifetime.signal.aborted) {
		testSignal?.removeEventListener('abort', cancel); await native.close(); lifetime.signal.throwIfAborted();
	}
	const raw = rawDerivedOriginalFixtureCurrentV1(6), seed = photoArchiveFixture().photo;
	let photo = normalizePhotoDocumentCurrentV1({ ...seed, schemaVersion: schema, catalogId: raw.binding.catalogId, id: raw.binding.photoId,
		original: { ...seed.original, id: raw.binding.originalId, storageKey: raw.binding.storageKey, contentSha256: raw.binding.contentSha256,
			byteLength: raw.binding.byteLength, width: raw.binding.width, height: raw.binding.height, mimeType: 'image/x-adobe-dng', name: 'Retained actual.dng' } });
	const hooks = { acquire: async (): Promise<void> => undefined, retireDecoder: async (): Promise<void> => undefined,
		closeLease: async (): Promise<void> => undefined };
	let leases = 0, closes = 0, fallbacks = 0;
	const body = new File([raw.bytes], 'retained.dng', { type: 'image/x-adobe-dng' });
	const originalSource: PhotoLibraryOriginalSourceCurrentV1 = { async acquire(request) {
		assert.equal(this, originalSource); assert.equal(request.catalogId, photo.catalogId); assert.equal(request.photoId, photo.id);
		assert.deepEqual(request.original, photo.original); leases++; events.push('acquire'); await hooks.acquire();
		return { body, async close() { closes++; events.push('lease-close'); await hooks.closeLease(); } };
	} };
	const decoderPorts: PhotoOriginalDerivedFramePortsCurrentV1 = {
		withRawFrame: (request, consume) => native.ports.withRawFrame!(request, consume),
		withRecoveryFrame: (request, consume) => native.ports.withRecoveryFrame!(request, consume),
		assertCurrent: () => native.ports.assertCurrent!(),
	};
	const host = {
		repository: { async loadPhoto() { return photo; } }, ready: async () => photo.catalogId,
		operation<Result>(run: (signal: AbortSignal) => Promise<Result>, caller?: AbortSignal): Promise<Result> {
			const signal = caller ? AbortSignal.any([caller, lifetime.signal]) : lifetime.signal;
			const work = Promise.resolve().then(() => { signal.throwIfAborted(); return run(signal); }); pending.add(work);
			void work.then(() => { pending.delete(work); }, () => { pending.delete(work); }); return work;
		}, originalSource,
		async withFrame(value, consume) {
			const result = await withPhotoOriginalFrameCurrentV1(value, consume, { withRawFrame: decoderPorts.withRawFrame });
			events.push('decoder-retired'); await hooks.retireDecoder(); return result;
		},
		async withDerivedFrame(value, consume, dependencies) {
			const result = await withPhotoOriginalDerivedFrameCurrentV1(value, consume, { ...decoderPorts,
				assertCurrent: async () => { await decoderPorts.assertCurrent!(); await dependencies?.assertCurrent?.(); } });
			events.push('decoder-retired'); await hooks.retireDecoder(); return result;
		},
	} satisfies PhotoLibraryDevelopDerivedOriginalSessionHostCurrentV1 & { originalSource: PhotoLibraryOriginalSourceCurrentV1 };
	let retirement: Promise<void> | undefined;
	return { host, originalSource, body, raw, native, hooks, events, current: () => photo,
		request: () => ({ schemaVersion: 1 as const, photoId: photo.id, expectedRevision: photo.revision }),
		replace(value: unknown) { photo = normalizePhotoDocumentCurrentV1(value); },
		calls: () => ({ leases, closes, fallbacks }),
		async loadOriginal() { fallbacks++; return body; },
		close(): Promise<void> {
			if (retirement) return retirement;
			retirement = Promise.resolve().then(async () => {
				testSignal?.removeEventListener('abort', cancel); releaseHeld();
				lifetime.abort(new Error('Native Develop fixture closed.')); await Promise.allSettled([...pending]); await native.close();
			}); return retirement;
		},
	};
}
