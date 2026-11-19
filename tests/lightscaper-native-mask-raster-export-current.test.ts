/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { PhotoRasterExportCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-current-v1.ts';
import { encodePhotoPngCurrentV1 } from '../src/lightscaper/controller/photo-png-export-encoder-current-v1.ts';
import { recoveryRasterFixture } from './helpers/lightscaper-raw-development-raster-export-fixture.ts';
import { targetRasterReference, inspectRasterPng } from './helpers/lightscaper-p3-raster-reference-current.ts';

const WIDTH = 128, HEIGHT = 96, TARGET = { profile: 'display-p3', bitDepth: 16 } as const;
const ALPHA = { id: 'zero', kind: 'alpha', inputName: 'paint' } as const;
const CASES: readonly Readonly<{ id: string; brush: boolean; nodes: readonly unknown[]; output: string;
	coverage: (x: number, y: number) => 0 | 255 }>[] = [
	{ id: 'empty-brush', brush: true, nodes: [ALPHA], output: 'zero', coverage: () => 0 },
	{ id: 'inverted-empty-brush', brush: true, nodes: [ALPHA, { id: 'inverse', kind: 'invert', inputNodeId: 'zero' }],
		output: 'inverse', coverage: () => 255 },
	{ id: 'boolean-intersection', brush: false, nodes: [
		{ id: 'left', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: .5, height: 1 },
		{ id: 'top', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: .5 },
		{ id: 'intersection', kind: 'boolean', operation: 'intersect', inputNodeIds: ['left', 'top'] },
	], output: 'intersection', coverage: (x, y) => x < 64 && y < 48 ? 255 : 0 },
	{ id: 'partly-outside', brush: false, nodes: [
		{ id: 'outside', kind: 'vector-shape', shape: 'rectangle', x: -.25, y: 0, width: .5, height: 1 },
	], output: 'outside', coverage: x => x < 32 ? 255 : 0 },
	{ id: 'fully-outside', brush: false, nodes: [
		{ id: 'outside', kind: 'vector-shape', shape: 'rectangle', x: 2, y: -2, width: .5, height: 1 },
	], output: 'outside', coverage: () => 0 },
];

for (const row of CASES) test(`Current saved RAW ${row.id} mask has independent full-preview and P3 PNG16 pixels with unchanged custody`, { timeout: 30_000 }, async () => {
	const f = await recoveryRasterFixture(), owner = new PhotoRasterExportCurrentV1('png');
	try {
		const masks = f.session.develop.maskRasters, selectedSource = f.session.maskRasterSource; assert.ok(masks && selectedSource);
		const installed = await withPreparedBrushMaskResourceV1({ width: 4, height: 3, alpha: new Uint8Array(12) }, async body => {
			const bytes = body.bytes.slice(), acknowledgement = await masks.install(body.reference, body.bytes);
			assert.deepEqual(acknowledgement.reference, body.reference); assert.equal(acknowledgement.catalogId, f.saved.catalogId);
			assert.deepEqual(acknowledgement.notices, []); return { reference: body.reference, bytes };
		});
		const borrowedBrush: Uint8Array[] = [], borrowedNative: ArrayBuffer[] = [];
		let graphReads = 0;
		const observed: MaskRasterSourcePortV1 = { async withBytes(reference, consume, options) {
			graphReads++; assert.deepEqual(reference, installed.reference);
			return selectedSource.withBytes(reference, async bytes => {
				borrowedBrush.push(bytes); assert.deepEqual(bytes, installed.bytes); return consume(bytes);
			}, options);
		} };
		const readInstalled = () => masks.source.withBytes(installed.reference, bytes => {
			borrowedBrush.push(bytes); return bytes.slice();
		});
		assert.deepEqual(await readInstalled(), installed.bytes);
		const develop = normalizeImageDevelopStateV4({ ...f.saved.develop,
			masks: [{ schemaVersion: 1, id: 'edge', kind: 'mask', inputs: row.brush
				? [{ name: 'paint', kind: 'alpha', sourceRef: installed.reference.storageKey }] : [], nodes: row.nodes, outputNodeId: row.output }],
			maskBindings: [{ effectId: 'exposure', maskId: 'edge' }] });
		assert.equal(develop.processVersion, 4); assert.deepEqual(develop.rawDevelopment, { schemaVersion: 1, mode: 'recovery' });
		const acknowledged = await f.session.develop.apply({ schemaVersion: 3, photoId: f.saved.photoId, expectedRevision: f.saved.revision,
			command: { type: 'record-develop', versionId: f.saved.versionId, develop, label: row.id, createdAt: '2026-10-27T20:00:00.000Z' } });
		const saved = acknowledged.snapshot, custody = await f.inspectCurrentCustody(), metadata = await f.session.readMetadata(saved.photoId);
		assert.deepEqual(saved.develop, develop); assert.equal(saved.revision, f.saved.revision + 1);
		assert.deepEqual(saved.develop.maskBindings, [{ effectId: 'exposure', maskId: 'edge' }]);
		assert.deepEqual(custody.photo.original, f.custodies[0]!.photo.original); assert.deepEqual(custody.bytes, f.raw);
		assert.deepEqual(custody.roots, f.custodies[0]!.roots); assert.deepEqual(custody.assets, f.custodies[0]!.assets);
		assert.deepEqual(metadata.metadata, f.metadata.metadata); assert.deepEqual(metadata.extracted, f.metadata.extracted);
		const coverage = Uint8Array.from({ length: WIDTH * HEIGHT }, (_, index) => row.coverage(index % WIDTH, Math.floor(index / WIDTH)));
		// Hard, aligned rectangles and the zero brush give literal endpoints.
		// No mask evaluator, renderer or quantizer computes this expected plane.
		const expected = Float32Array.from(f.floats, (value, index) => index % 4 === 3 || coverage[Math.floor(index / 4)] === 0
			? value : Math.fround(value * .5));
		const target = targetRasterReference(expected, TARGET), signal = new AbortController().signal;
		const runtime = createPhotoDevelopRenderRuntimeCurrentV1({ source: f.session.cubeLuts.source, maskSource: observed });
		let preview: Float32Array | undefined, previewCoverage: Uint8Array | undefined;
		await f.original.withDerivedFrame!({ schemaVersion: 1, photoId: saved.photoId, expectedRevision: saved.revision, profile: 'highlight-recovery-v1' }, view => {
			assert.ok(view.frame.pixels instanceof Float32Array); borrowedNative.push(view.frame.pixels.buffer);
			return runtime.withFullResolution({ frame: view.frame, develop: saved.develop, signal,
				maskOverlay: { effectId: 'exposure', maskId: 'edge' } }, result => {
				assert.ok(result.frame.pixels instanceof Float32Array); assert.ok(result.maskOverlay);
				assert.deepEqual([result.frame.descriptor.width, result.frame.descriptor.height], [WIDTH, HEIGHT]);
				assert.deepEqual(result.frame.pixels, expected); assert.deepEqual(result.maskOverlay.coverage, coverage);
				preview = result.frame.pixels; previewCoverage = result.maskOverlay.coverage;
			});
		});
		assert.ok(preview?.every(value => value === 0)); assert.ok(previewCoverage?.every(value => value === 0));
		const receipt = await owner.start({ ...f.request, expectedRevision: saved.revision, loadRenderer: async () => runtime,
			output: { schemaVersion: 3, ...TARGET, sizing: { kind: 'original' }, quality: 'nearest', metadataScope: 'strip' },
			encode: async (frame, options) => {
				assert.equal(frame.descriptor.sampleFormat, 'float32'); assert.equal(frame.descriptor.transfer, 'linear');
				assert.deepEqual(frame.pixels, expected); assert.equal(options.profile, 'display-p3'); assert.equal(options.bitDepth, 16);
				const bytes = await encodePhotoPngCurrentV1(frame, options); f.encoded.push(bytes); return bytes;
			} });
		assert.ok(receipt.status !== 'cancelled'); assert.equal(receipt.status, 'download-started'); assert.equal(f.deliveries.length, 1);
		assert.deepEqual([receipt.width, receipt.height], [WIDTH, HEIGHT]); assert.equal(receipt.byteLength, f.deliveries[0]!.bytes.length);
		inspectRasterPng(f.deliveries[0]!.bytes, WIDTH, HEIGHT, TARGET, false, target);
		assert.deepEqual(await f.inspectCurrentCustody(), custody); assert.deepEqual(await f.session.readMetadata(saved.photoId), metadata);
		assert.deepEqual(await f.session.develop.read({ schemaVersion: 3, photoId: saved.photoId }), saved);
		assert.deepEqual(await readInstalled(), installed.bytes); assert.equal(row.brush ? graphReads >= 2 : graphReads === 0, true);
		assert.ok(borrowedBrush.every(bytes => bytes.every(value => value === 0)));
		assert.ok([...borrowedNative, ...f.borrowed].every(buffer => new Uint8Array(buffer).every(value => value === 0)));
		assert.ok(f.encoded.every(bytes => bytes.every(value => value === 0))); assert.equal(f.events.includes('canonical'), false);
		assert.equal(f.canonical.active(), 0); assert.equal(f.recovery.active(), 0);
	} finally { await owner.cancelAndJoin(); await f.close(); }
});
