/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoRasterExportBatchQueueCurrentV1, type PhotoRasterExportBatchRuntimeCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-batch-queue-current-v1.ts';
import { PhotoRasterPersistedBatchCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-persisted-batch-current-v1.ts';
import { preparePhotoRasterBatchGraphicV1, reselectPhotoRasterBatchGraphicV1, type PreparedPhotoRasterBatchGraphicV1 } from '../src/lightscaper/controller/photo-raster-export-batch-graphic-v1.ts';
import { encodePhotoPngCurrentV1 } from '../src/lightscaper/controller/photo-png-export-encoder-current-v1.ts';
import { recoveryRasterFixture } from './helpers/lightscaper-raw-development-raster-export-fixture.ts';
import { pngBytes } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';
import { nativeRasterReference, chromaticRasterReference, targetRasterReference, inspectRasterPng } from './helpers/lightscaper-p3-raster-reference-current.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const TARGET = { profile: 'display-p3', bitDepth: 16 } as const;
const TEXT = { schemaVersion: 1, font: 'inter-600-latin', color: '#0000ff', text: 'P3 native',
	anchor: 'middle-center', widthFraction: 1, marginFraction: 0, opacity: 1 } as const;
const redPixels = () => Uint8Array.from(Array.from({ length: 12 }, () => [255, 0, 0, 128]).flat());
const bluePixels = () => Uint8Array.from(Array.from({ length: 12 }, () => [0, 0, 255, 64]).flat());
const markDescriptor = { schemaVersion: 1, width: 4, height: 3, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' } as const;

for (const metadataScope of ['strip', 'capture'] as const) {
	test(`Current native P3 PNG16 ${metadataScope} batch joins interrupted delivery and recovers exact marked pixels and JSON without repeating its image ACK`, { timeout: 120_000 }, async () => {
		const f = await recoveryRasterFixture('recovery', 2), held = deferred<void>(), entered = deferred<void>();
		let initial: PhotoRasterExportBatchQueueCurrentV1 | undefined, retry: PhotoRasterExportBatchQueueCurrentV1 | undefined;
		let first: PhotoRasterPersistedBatchCurrentV1 | undefined, reopened: PhotoRasterPersistedBatchCurrentV1 | undefined;
		let primaryFailed = false, primary: unknown; const cleanupFailures: unknown[] = [];
		try {
			const input = f.request, graphicBytes = pngBytes([...redPixels()], 3), graphicBody = new Blob([graphicBytes]);
			const preparedGraphic = await preparePhotoRasterBatchGraphicV1({ body: graphicBody, anchor: 'middle-center', widthFraction: 1, marginFraction: 0, opacity: 1 });
			const native = chromaticRasterReference(nativeRasterReference(f.floats, 128, 96, 64, 48, 'bilinear'));
			const expected = targetRasterReference(native, TARGET), borrowed: Uint8Array[] = [], encoded: Uint8Array[] = [];
			const output = { schemaVersion: 3, ...TARGET, sizing: { kind: 'percentage', percentage: 50 }, quality: 'bilinear', metadataScope, textWatermark: TEXT } as const;
			const members = f.savedRows.map((row, index) => ({ photoId: row.photoId, versionId: row.versionId, expectedRevision: row.revision,
				sourceFileName: f.metadataRows[index]!.metadata.fileName }));
			const rawPlan = { schemaVersion: 1, batchId: 'native-p3-recovery', format: 'png', filenameTemplate: '{index:2}-{name}',
				members, output, sidecarEnabled: true, graphicWatermark: preparedGraphic.intent };
			let recovering = false, glyphs = 0, graphics = 0;
			const prepare = (recovery = false) => PhotoRasterPersistedBatchCurrentV1.prepare({
				selection: recovery ? [] : members.map(member => ({ photoId: member.photoId, fileName: member.sourceFileName })),
				execute: f.execute, readSidecar: f.readSidecar, openJournal: f.openJournal, signal: new AbortController().signal });
			const saves = { prepareSave: input.prepareSave, async saveFile(request: Parameters<typeof input.saveFile>[0]) {
				const name = request.suggestedName ?? request.fileName; assert.ok(typeof name === 'string');
				if (!recovering && request.mimeType === 'application/json') throw new Error('The first JSON delivery was refused.');
				if (!recovering && name.startsWith('02-')) { entered.resolve(); await held.promise; throw new Error('The second native image delivery was refused after cancellation.'); }
				return input.saveFile(request);
			} };
			const runtime = (owner: PhotoRasterPersistedBatchCurrentV1, graphic: Readonly<PreparedPhotoRasterBatchGraphicV1>, recovery = false): PhotoRasterExportBatchRuntimeCurrentV1 => ({
				fileTypeDescription: 'PNG', execute: f.execute, withOriginalFrame: input.withOriginalFrame, withDerivedFrame: input.withDerivedFrame,
				loadRenderer: input.loadRenderer, readSidecar: f.readSidecar, graphicWatermark: graphic,
				readMetadata: async (photoId, revision, options) => {
					const snapshot = await f.session.readMetadata(photoId, options); assert.equal(snapshot.revision, revision);
					return { catalogId: f.saved.catalogId, snapshot };
				},
				prepareDestinations(plan) { return recovery ? owner.prepareRecoveryDestinations(plan, saves, ['native-p3-recovery:1', 'native-p3-recovery:2'])
					: owner.prepareFreshDestinations(plan, saves, '{index:2}-{name}'); },
				// Node has no native image/font decoder. Pin only these two decoded
				// resource edges; actual RAW, Develop, output stages, codecs and native
				// CAS/delivery owners remain in the production path.
				async withGraphicFrame(request, consume) {
					assert.equal(f.canonical.active(), 0); assert.equal(f.recovery.active(), 0);
					assert.ok(request !== null && typeof request === 'object' && 'body' in request && request.body instanceof Blob);
					assert.deepEqual(new Uint8Array(await request.body.arrayBuffer()), graphicBytes);
					const pixels = redPixels(); borrowed.push(pixels); graphics++;
					try { return await consume({ descriptor: markDescriptor, pixels }, { orientation: 1, runtimeVersion: 'independent-pinned-mark' }); }
					finally { pixels.fill(0); }
				},
				async withTextFrame(request, consume) {
					assert.ok(request !== null && typeof request === 'object' && 'width' in request && 'height' in request && 'text' in request);
					assert.deepEqual([request.width, request.height], [64, 48]); assert.deepEqual(request.text, TEXT);
					const pixels = bluePixels(); borrowed.push(pixels); glyphs++;
					try { return await consume({ descriptor: markDescriptor, pixels }); } finally { pixels.fill(0); }
				},
				async encode(format, frame, options) {
					assert.equal(format, 'png'); assert.equal(frame.descriptor.sampleFormat, 'float32'); assert.equal(frame.descriptor.transfer, 'linear');
					assert.deepEqual([frame.descriptor.width, frame.descriptor.height], [64, 48]); assert.deepEqual(frame.pixels, native);
					assert.equal(options.profile, 'display-p3'); assert.equal(options.bitDepth, 16);
					const bytes = await encodePhotoPngCurrentV1(frame, options); encoded.push(bytes); return bytes;
				},
			});
			const seedBefore = await f.inspect(); first = await prepare(); initial = new PhotoRasterExportBatchQueueCurrentV1(runtime(first, preparedGraphic));
			const work = initial.start(rawPlan), outcome = work.then(value => ({ value }), (error: unknown) => ({ error }));
			await Promise.race([entered.promise, work.then(() => assert.fail('The actual second image save did not enter its held destination.'))]);
			assert.deepEqual(first.journal!.output, output); assert.deepEqual(first.journal!.members.map(member => member.state), ['committed', 'started']);
			assert.equal(first.journal!.members[0]!.sidecar!.state, 'started'); assert.equal(f.deliveries.length, 1);
			const firstAck = first.journal!.members[0]!.delivery, firstBytes = f.deliveries[0]!.bytes.slice(); assert.ok(firstAck);
			assert.equal(firstAck.size, firstBytes.length); inspectRasterPng(firstBytes, 64, 48, TARGET, metadataScope === 'capture', expected);
			const closing = initial.cancelAndJoin(); assert.equal(await remainsPending(closing), true);
			held.resolve(); await closing; const interrupted = await outcome; assert.ok('error' in interrupted);
			assert.equal(f.deliveries.length, 1); assert.equal(encoded.length, 2); await first.closeAndJoin();
			reopened = await prepare(true); assert.deepEqual(reopened.recovery.map(entry => entry.disposition), ['needs-review', 'needs-review']);
			assert.deepEqual(reopened.journal!.output, output); assert.deepEqual(reopened.journal!.members[0]!.delivery, firstAck);
			const graphic = await reselectPhotoRasterBatchGraphicV1(reopened.journal!.graphicWatermark, new File([graphicBytes], 'Reselected under another name.png'));
			recovering = true; retry = new PhotoRasterExportBatchQueueCurrentV1(runtime(reopened, graphic, true));
			const resumed = await retry.startRecovery(reopened.journal, ['native-p3-recovery:1', 'native-p3-recovery:2']);
			assert.deepEqual(resumed.members.map(member => [member.index, member.state]), [[1, 'completed'], [2, 'completed']]);
			assert.deepEqual(f.deliveries.map(delivery => delivery.mimeType), ['image/png', 'application/json', 'image/png', 'application/json']);
			assert.deepEqual(f.deliveries[0]!.bytes, firstBytes); assert.equal(encoded.length, 3); assert.equal(graphics, 3); assert.equal(glyphs, 3);
			assert.equal(f.events.filter(event => event === 'derived').length, 3); assert.equal(f.events.includes('canonical'), false);
			assert.equal(f.events.filter(event => event === 'picker').length, 3);
			assert.ok(expected.some((value, index) => index % 4 !== 3 && value % 257 !== 0));
			const second = f.deliveries[2]!; inspectRasterPng(second.bytes, 64, 48, TARGET, metadataScope === 'capture', expected);
			assert.equal(f.deliveries.filter(delivery => delivery.name === f.deliveries[0]!.name).length, 1);
			for (const [index, row] of f.savedRows.entries()) {
				const delivery = f.deliveries[index * 2 + 1]!;
				const savedSidecar = await f.readSidecar({ catalogId: row.catalogId, photoId: row.photoId, versionId: row.versionId, expectedRevision: row.revision }, { signal: new AbortController().signal });
				assert.equal(new TextDecoder().decode(delivery.bytes), savedSidecar); assert.equal(delivery.name, f.deliveries[index * 2]!.name + '.lightscaper.json');
			}
			assert.deepEqual(reopened.journal!.members.map(member => [member.state, member.sidecar!.state]), [['committed', 'committed'], ['committed', 'committed']]);
			assert.deepEqual(reopened.journal!.members[0]!.delivery, firstAck); assert.equal(reopened.journal!.members[1]!.delivery!.size, second.bytes.length);
			assert.ok(borrowed.every(bytes => bytes.every(value => value === 0))); assert.ok(encoded.every(bytes => bytes.every(value => value === 0)));
			assert.deepEqual(await f.inspect(), seedBefore); await f.assertCustody();
		} catch (error) { primaryFailed = true; primary = error; }
		finally {
			held.resolve();
			const closers = [() => initial?.cancelAndJoin(), () => retry?.cancelAndJoin(), () => first?.closeAndJoin(), () => reopened?.closeAndJoin()];
			const cleanup = await Promise.allSettled(closers.map(close => Promise.resolve().then(close)));
			for (const result of cleanup) if (result.status === 'rejected') cleanupFailures.push(result.reason);
			try { await f.close(); } catch (error) { cleanupFailures.push(error); }
		}
		if (primaryFailed) {
			if (cleanupFailures.length) throw new AggregateError([primary, ...cleanupFailures], 'P3 batch qualification and cleanup failed.', { cause: primary });
			throw primary;
		}
		if (cleanupFailures.length === 1) throw cleanupFailures[0];
		if (cleanupFailures.length) throw new AggregateError(cleanupFailures, 'P3 batch cleanup failed.', { cause: cleanupFailures[0] });
	});
}
