/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import { PhotoLibrarySessionCurrentV1 } from '../src/lightscaper/controller/photo-library-session-current-v1.ts';
import type { PhotoLibraryOriginalSourceCurrentV1 } from '../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import { developBatchFixture } from './helpers/lightscaper-develop-batch-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

// This isolates actual Session composition and cancellation. Decoder pixel
// qualification lives in the production-worker and real Chromium tests.
for (const Session of [PhotoLibrarySessionV1, PhotoLibrarySessionV2, PhotoLibrarySessionCurrentV1]) {
	test(`${Session.name} captures a source-only Original receiver and joins its late acquisition and cleanup`, { timeout: 15_000 }, async context => {
		const f = await developBatchFixture(), entered = deferred<void>(), acquired = deferred<void>(), retiring = deferred<void>(), retired = deferred<void>();
		let session: InstanceType<typeof Session> | undefined, work: Promise<unknown> | undefined, closing: Promise<void> | undefined;
		let borrowed: AbortSignal | undefined, closes = 0, reads = 0, consumed = 0;
		const cancel = () => { acquired.resolve(); retired.resolve(); void session?.close().catch(() => undefined); };
		context.signal.addEventListener('abort', cancel, { once: true });
		try {
			const photo = f.photos[0]!; assert.ok(photo.original.byteLength <= 1_048_576);
			const body = new Blob([new Uint8Array(photo.original.byteLength)]);
			const originalSource: PhotoLibraryOriginalSourceCurrentV1 = { async acquire(request, options) {
				assert.equal(this, originalSource); reads++;
				assert.equal(request.catalogId, photo.catalogId); assert.equal(request.photoId, photo.id); assert.deepEqual(request.original, photo.original);
				borrowed = options?.signal; entered.resolve(); await acquired.promise;
				return { body, async close() { closes++; retiring.resolve(); await retired.promise; } };
			} };
			const ports = { catalog: f.repository, media: f.ports.media, journal: f.ports.journal, initialize: f.ports.initialize,
				closeResources: f.ports.closeResources, exclusive: f.ports.exclusive, originalSource };
			session = new Session(ports);
			originalSource.acquire = async () => { assert.fail('Session re-read a replaced source method.'); };
			assert.ok(session.develop.original, 'Source-only Original must be reachable without the backup capability.');
			work = session.develop.original.withFrame({ schemaVersion: 1, photoId: photo.id, expectedRevision: 0 }, async () => { consumed++; });
			const outcome = work.then(() => ({ failed: false, error: undefined as unknown }), (error: unknown) => ({ failed: true, error }));
			await Promise.race([entered.promise, work.then(() => { assert.fail('Original ended before source acquisition.'); })]);
			closing = session.close(); assert.equal(closing, session.close()); assert.equal(await remainsPending(closing), true);
			assert.ok(borrowed?.aborted); assert.equal(f.calls.close, 0); acquired.resolve();
			await Promise.race([retiring.promise, work.then(() => { assert.fail('Original ended before lease retirement.'); })]);
			assert.equal(await remainsPending(closing), true); assert.equal(f.calls.close, 0); retired.resolve();
			const result = await outcome; await closing;
			assert.equal(result.failed, true); assert.equal(result.error, borrowed.reason);
			assert.equal(reads, 1); assert.equal(closes, 1); assert.equal(consumed, 0); assert.equal(f.calls.close, 1);
			assert.equal((await f.repository.loadPhoto(photo.catalogId, photo.id))?.revision, photo.revision);
		} finally {
			acquired.resolve(); retired.resolve(); await Promise.allSettled([work, closing]);
			try { await session?.close(); } finally { context.signal.removeEventListener('abort', cancel); await f.close(); }
		}
	});
}
