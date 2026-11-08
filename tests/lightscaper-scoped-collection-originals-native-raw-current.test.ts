/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoLibraryCollectionHandoffPortV2 } from '../src/common/editor/photo-library-collection-handoff-port-v2.ts';
import { exportPhotoFramescaperCollectionHandoffArchiveCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-collection-handoff-archive-current-v1.ts';
import { createRawFrameFixtureCurrentV1 } from './helpers/lightscaper-raw-frame-current-fixture.ts';
import { scopedCollectionNativeFixtureCurrentV1 as fixture, scopedCollectionNativeShaCurrentV1 as sha } from './helpers/lightscaper-scoped-collection-originals-integration-fixture-current.ts';

test('Native group File consumer exports six independently editable RAW packs through actual LibRaw workers and real collection archive', { timeout: 15_000 }, async context => {
	const raw = await createRawFrameFixtureCurrentV1(); let failed = false, primary: unknown;
	try {
		await raw.withDefaultTransport(async () => {
			await fixture(context, async f => {
				assert.ok(f.session.collectionHandoffCurrent); const actual = f.session.collectionHandoffCurrent;
				let deliveries = 0;
				// This observer forwards the genuine Session view and owns its real
				// consumer result; it supplies no Photo, body, pixel or decoder.
				const capture: PhotoLibraryCollectionHandoffPortV2 = { withCapture(request, consume, options) {
					return actual.withCapture(request, async view => {
						deliveries++; assert.equal(f.counts().closes, 0); assert.equal(f.counts().stages, 2);
						const result = await consume(view);
						assert.equal(raw.workers.active(), 0); assert.equal(f.counts().closes, 0); return result;
					}, options);
				} };
				let ids = 0;
				const result = await exportPhotoFramescaperCollectionHandoffArchiveCurrentV1({ capture, binding: f.binding(), signal: context.signal },
					{ createId: () => `native-scoped-collection-${++ids}`, now: () => '2026-10-18T00:00:00.000Z' });
				assert.equal(deliveries, 1); assert.equal(result.photoCount, 6); assert.ok(result.blob instanceof Blob); assert.ok(result.blob.size > 0 && result.blob.size <= 8 * 1024 * 1024);
				assert.equal(Buffer.from(await result.blob.slice(0, 4).arrayBuffer()).toString('hex'), '504b0304');
				assert.equal(sha(new Uint8Array(await result.blob.arrayBuffer())).length, 64);
				assert.equal(raw.workers.active(), 0); assert.deepEqual(f.counts(), { opens: 1, closes: 1, singles: 0, stages: 0 });
			});
		});
	} catch (error) { failed = true; primary = error; }
	try { await raw.close(); } catch (cleanup) {
		if (failed && !Object.is(primary, cleanup)) throw new AggregateError([primary, cleanup], 'Real RAW collection export and worker retirement failed.', { cause: cleanup }); throw cleanup;
	}
	if (failed) throw primary;
});
