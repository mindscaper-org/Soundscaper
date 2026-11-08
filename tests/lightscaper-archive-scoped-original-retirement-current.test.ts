/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { types } from 'node:util';
import { exportPhotoCatalogArchiveV1 } from '../src/lightscaper/archive/catalog-archive-export.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { exportPhotoCatalogArchiveV8 } from '../src/lightscaper/archive/catalog-archive-export-v8.ts';
import { acquirePhotoLibraryOriginalCurrentV1, type PhotoLibraryOriginalSourceCurrentV1 } from '../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
function contains(error: unknown, wanted: unknown): boolean {
	if (Object.is(error, wanted)) return true;
	if (!types.isNativeError(error)) return false;
	const errors: unknown = Object.getOwnPropertyDescriptor(error, 'errors')?.value;
	return Array.isArray(errors) && errors.some((value: unknown) => contains(value, wanted));
}
for (const failure of ['signal', 'destination', 'legacy-signal', 'opaque-cleanup'] as const) test(`Archive ${failure} joins actual retained File read before its yielded lease closes`,
	{ timeout: 15_000 }, async context => {
	const fixture = photoArchiveFixture(), body = new File([new Uint8Array([1, 2, 3])], 'retained.png', { type: 'image/png' });
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const descriptor = Object.getOwnPropertyDescriptor(Blob.prototype, 'arrayBuffer')!;
	const actual = descriptor.value as Blob['arrayBuffer'];
	let held = false, readRetired = false, acquired = 0, closed = 0, written = 0;
	const cleanup = new Error('Actual retained File lease retirement receipt failed.');
	let actualRead: Promise<ArrayBuffer> | undefined, work: Promise<unknown> | undefined;
	let destination!: WritableStreamDefaultController;
	const cancel = () => { release.resolve(); stop.abort(context.signal.reason); };
	context.signal.addEventListener('abort', cancel, { once: true });
	if (context.signal.aborted) cancel();
	const source: PhotoLibraryOriginalSourceCurrentV1 = { async acquire() {
		acquired++; return { body, async close() { closed++; if (failure === 'opaque-cleanup') throw cleanup; } };
	} };
	async function* photos() {
		const lease = await acquirePhotoLibraryOriginalCurrentV1(source,
			{ catalogId: fixture.photo.catalogId, photoId: fixture.photo.id, original: fixture.photo.original }, stop.signal);
		try { yield { photo: fixture.photo, original: lease.body }; } finally { await lease.close(); }
	}
	const writable = new WritableStream<Uint8Array>({ start(controller) { destination = controller; },
		write(bytes) { written += bytes.byteLength; } });
	Object.defineProperty(Blob.prototype, 'arrayBuffer', { ...descriptor, value: function (this: Blob) {
		const read = Reflect.apply(actual, this, []) as Promise<ArrayBuffer>;
		if (held || Reflect.apply(SIZE, this, []) !== 3) return read;
		held = true; actualRead = read.then(async bytes => {
			entered.resolve(); await release.promise; readRetired = true; return bytes;
		}); return actualRead;
	} });
	try {
		const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
			id: fixture.photo.catalogId, name: 'Retained originals', revision: 0, photoCount: 1, folders: [], keywords: [], collections: [] });
		work = failure === 'legacy-signal' ? exportPhotoCatalogArchiveV1(root, photos(), { writable, signal: stop.signal })
			: exportPhotoCatalogArchiveV8(root, photos(), [], null, [], null, undefined, undefined, { writable, signal: stop.signal });
		void work.catch(() => undefined);
		await Promise.race([entered.promise, work.then(() => { throw new Error('Archive completed before actual original read barrier.'); })]);
		assert.equal(acquired, 1); assert.equal(closed, 0); assert.equal(readRetired, false);
		const reason = failure === 'opaque-cleanup' ? Symbol('Opaque original archive cancellation') : new Error(`Actual archive ${failure} cancellation.`);
		if (failure === 'destination') destination.error(reason); else stop.abort(reason);
		await settle(2);
		assert.equal(closed, 0, 'Source retirement cannot delete a stage while its native read is still accepted.');
		assert.equal(await remainsPending(work), true);
		release.resolve(); let refused = false, failureValue: unknown;
		await work.then(() => undefined, (error: unknown) => { refused = true; failureValue = error; });
		if (failure === 'opaque-cleanup') { assert.equal(contains(failureValue, reason), true); assert.equal(contains(failureValue, cleanup), true); }
		assert.equal(refused, true); assert.equal(readRetired, true); assert.equal(closed, 1);
		assert.ok(written < 64 * 1024);
	} finally {
		release.resolve(); stop.abort(new Error('Archive ownership fixture retiring.'));
		await Promise.allSettled([work, actualRead]);
		Object.defineProperty(Blob.prototype, 'arrayBuffer', descriptor);
		context.signal.removeEventListener('abort', cancel);
	}
});
