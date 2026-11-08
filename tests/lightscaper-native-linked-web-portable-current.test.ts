/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createPhotoLibraryRestoreRuntimeCurrentV1 } from '../src/lightscaper/photo-library-restore-runtime-current-v1.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { exportPhotoFramescaperHandoffArchiveCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-archive-current-v1.ts';
import { withPhotoFramescaperHandoffReadCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-read-current-v1.ts';
import { nativeLinkedPortableArchiveCurrentV1 as archive, readNativeLinkedPortableArchiveCurrentV1 as read,
	linkedArchiveJsonShaCurrentV1 as sha } from './helpers/lightscaper-native-linked-archive-restore-fixture-current.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { currentAppLocks } from './helpers/lightscaper-current-app-fixture.tsx';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { createRawFrameFixtureCurrentV1 } from './helpers/lightscaper-raw-frame-current-fixture.ts';

/** Actual Web restore/storage/Session owners run over the maintained explicit
 * instrumented IDB+locks. This is not a claim of real browser IDB execution. */
for (const handoff of [false, true]) void test(`Native linked portable archive remains readable in complete Web Current Session${handoff ? ' and actual RAW editable Frame roundtrip' : ' and complete portable backup'}`,
	{ concurrency: false, timeout: 15_000 }, async context => {
		const original = await archive(context), factory = mediaRestoreFixture(), locks = currentAppLocks();
		const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
		Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
		const options = { name: 'Portable Web copy', indexedDB: factory.factory, locks }, controller = new AbortController();
		const runtime = createPhotoLibraryRestoreRuntimeCurrentV1(options), sessions: Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>>[] = [];
		let raw: Awaited<ReturnType<typeof createRawFrameFixtureCurrentV1>> | undefined, expired = false;
		const stop = (): void => { controller.abort(context.signal.reason); void runtime.close().catch(() => undefined);
			for (const session of sessions) void session.close().catch(() => undefined); void raw?.close().catch(() => undefined); };
		context.signal.addEventListener('abort', stop, { once: true }); if (context.signal.aborted) stop();
		const timer = setTimeout(() => { expired = true; stop(); }, 12_000);
		let failed = false, primary: unknown;
		try {
			const receipt = await runtime.restoreArchive(original.blob, { signal: controller.signal }); assert.equal(receipt.photoCount, 2);
			const session = await createPhotoLibrarySessionCurrentV1({ ...options, signal: controller.signal }); sessions.push(session);
			assert.equal((await session.readPage({ signal: controller.signal })).totalCount, 2);
			const selected = original.photos[0]!, capture = session.imageHandoffCurrent; assert.ok(capture);
			const binding = { catalogId: selected.catalogId, photoId: selected.id, versionId: selected.activeVersionId, expectedRevision: selected.revision };
			await capture.withCapture(binding, async view => {
				const hash = createHash('sha256');
				for (let offset = 0; offset < view.originalBlob.size; offset += 1024 * 1024) {
					const bytes = new Uint8Array(await view.originalBlob.slice(offset, offset + 1024 * 1024).arrayBuffer()); hash.update(bytes); bytes.fill(0);
				} assert.equal(hash.digest('hex'), selected.original.contentSha256);
				for (const reference of view.lutReferences) await view.withLutBytes(reference, bytes => { assert.equal(createHash('sha256').update(bytes).digest('hex'), reference.sha256); });
				for (const reference of view.maskRasterReferences) await view.withMaskRasterBytes(reference, bytes => { assert.equal(createHash('sha256').update(bytes).digest('hex'), reference.sha256); });
			}, { signal: controller.signal });
			const portable = await session.backupCatalog({ signal: controller.signal, maximumBlobBytes: 8 * 1024 * 1024 }); assert.ok(portable.blob);
			const admitted = await read(portable.blob, controller.signal);
			assert.equal(sha(admitted.photos), sha(original.photos)); assert.ok(admitted.photos.every(photo => photo.original.retention === 'linked'));
			assert.equal(sha(admitted.stacks), sha([original.stack])); assert.equal(sha(admitted.saved), sha([original.saved])); assert.equal(sha(admitted.preset), sha(original.preset));
			if (handoff) {
				raw = await createRawFrameFixtureCurrentV1();
				await raw.withDefaultTransport(async () => {
					let sequence = 0;
					const frame = await exportPhotoFramescaperHandoffArchiveCurrentV1({ capture, binding, signal: controller.signal },
						{ createId: () => `portable-linked-frame-${++sequence}`, now: () => '2026-10-20T00:00:00.000Z' });
					assert.ok(frame.blob.size > 0 && frame.blob.size <= 8 * 1024 * 1024);
					await withPhotoFramescaperHandoffReadCurrentV1({ archive: frame.blob, sourceId: 'portable-linked-frame-2', signal: controller.signal }, view => {
						assert.equal(view.source.schemaVersion, 4); assert.equal(view.source.original.sha256, selected.original.contentSha256);
						assert.equal(Object.hasOwn(view.source, 'retention'), false); assert.equal(Object.hasOwn(view.source.original, 'grantId'), false);
					});
					assert.ok(session.imageReceiveCurrent);
					const received = await session.imageReceiveCurrent.receive({ archive: frame.blob, sourceId: 'portable-linked-frame-2' }, { signal: controller.signal });
					assert.equal(received.status, 'imported'); assert.equal(received.settlement, 'complete');
					const result = await session.backupCatalog({ signal: controller.signal, maximumBlobBytes: 8 * 1024 * 1024 }); assert.ok(result.blob);
					const current = await read(result.blob, controller.signal), photo = current.photos.find(value => value.id === received.photoId); assert.ok(photo);
					assert.equal(photo.original.retention, 'managed'); assert.equal(photo.original.contentSha256, selected.original.contentSha256);
					assert.equal(current.photos.filter(value => value.original.retention === 'linked').length, 2);
				});
				assert.equal(raw.workers.active(), 0);
			}
			await session.close();
			const reopened = await createPhotoLibrarySessionCurrentV1({ ...options, signal: controller.signal }); sessions.push(reopened);
			assert.equal((await reopened.readPage()).totalCount, handoff ? 3 : 2); assert.equal(expired, false);
		} catch (error) { failed = true; primary = error; }
		const errors: unknown[] = [];
		for (const owner of [...sessions, runtime, ...(raw ? [raw] : [])]) { try { await owner.close(); } catch (error) { errors.push(error); } }
		clearTimeout(timer); context.signal.removeEventListener('abort', stop);
		if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange');
		if (errors.length) throw new AggregateError([...(failed ? [primary] : []), ...errors], 'Portable Web consumers did not retire actual owners.', { cause: errors[0] });
		if (failed) throw primary;
	});
