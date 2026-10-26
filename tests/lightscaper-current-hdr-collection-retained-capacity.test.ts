/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { exportPhotoFramescaperCollectionHandoffArchiveCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-collection-handoff-archive-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { createPhotoExportSidecarCurrentV1, serializePhotoExportSidecarCurrentV1 } from '../src/lightscaper/catalog/photo-export-sidecar-current-v1.ts';
import type { PhotoLibraryCollectionHandoffPortV2 } from '../src/common/editor/photo-library-collection-handoff-port-v2.ts';
import { readImageHdrOriginalV1 } from '../src/common/editor/imaging/image-hdr-original-v1.ts';
import { serializeImageHdrOriginalProvenanceV1 } from '../src/common/editor/imaging/image-hdr-original-contract-v1.ts';
import { IMAGE_HDR_ORIGINAL_LIMITS_V1 } from '../src/common/editor/imaging/image-hdr-original-profile-v1.ts';
import { hdrFrameFixtureCurrentV1, HDR_FRAME_TIME } from './helpers/lightscaper-hdr-frame-current-fixture.ts';

test('Current HDR collection refuses cumulative retained work before bodies while one Photo reaches its Original borrow', async () => {
	const f = await hdrFrameFixtureCurrentV1(), width = 4096, height = 1366;
	const before = readImageHdrOriginalV1(f.original).provenance;
	const provenance = { ...before, inputs: before.inputs.map(input => ({ ...input, original: { ...input.original, width, height } })),
		output: { x: 0, y: 0, width, height } };
	const metadata = new TextEncoder().encode(serializeImageHdrOriginalProvenanceV1(provenance));
	const payloadOffset = Math.ceil((IMAGE_HDR_ORIGINAL_LIMITS_V1.headerBytes + metadata.byteLength) / 4) * 4;
	// Declared metadata only: no large pixel/body allocation or physical HDR proof.
	const byteLength = payloadOffset + width * height * 12;
	const photos = [0, 1].map(index => {
		const photo = normalizePhotoDocumentCurrentV1({ ...f.photo, id: `hdr-retained-photo-${index}`,
			original: { ...f.photo.original, byteLength, width, height } });
		const binding = { catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision };
		return { binding, factsJson: serializePhotoExportSidecarCurrentV1(createPhotoExportSidecarCurrentV1(photo, binding)),
			original: { exactName: photo.original.name, contentSha256: photo.original.contentSha256, byteLength,
				mimeType: 'image/x-lightscaper-hdr' as const, width, height, hasAlpha: false } };
	});
	const senderBefore = JSON.stringify(photos), originalBefore = f.original.slice();
	const binding = { catalogId: f.photo.catalogId, collectionId: 'hdr-retained', scope: 'catalog' as const, expectedCatalogRevision: 7 };
	const signal = new AbortController().signal, borrowMarker = new Error('Single Photo metadata reached Original acquisition.');
	let originals = 0, resources = 0, rasterOpens = 0, nextId = 0;
	function capture(count: 1 | 2): PhotoLibraryCollectionHandoffPortV2 {
		const port: PhotoLibraryCollectionHandoffPortV2 = { async withCapture(request, consume) {
			assert.equal(this, port); assert.deepEqual(request, binding);
			return consume({ schemaVersion: 2, signal,
				collection: { catalogId: binding.catalogId, id: binding.collectionId, scope: binding.scope,
					name: 'HDR retained capacity', catalogRevision: 7, indexRevision: 7, definitionRevision: null, definitionJson: '{}' },
				photos: photos.slice(0, count), lutReferences: [], maskRasterReferences: [],
				withOriginal: async () => { originals++; throw borrowMarker; },
				withLutBytes: async () => { resources++; throw new Error('No LUT body may be borrowed.'); },
				withMaskRasterBytes: async () => { resources++; throw new Error('No brush body may be borrowed.'); } });
		} }; return port;
	}
	const dependencies = { createId: () => `hdr-retained-id-${++nextId}`, now: () => HDR_FRAME_TIME,
		openImage: async () => { rasterOpens++; throw new Error('No raster decode may begin.'); } };

	await assert.rejects(exportPhotoFramescaperCollectionHandoffArchiveCurrentV1({ capture: capture(2), binding }, dependencies), /1 GiB phase working bound/u);
	assert.equal(originals, 0); assert.equal(resources, 0); assert.equal(rasterOpens, 0);
	await assert.rejects(exportPhotoFramescaperCollectionHandoffArchiveCurrentV1({ capture: capture(1), binding }, dependencies), error => Object.is(error, borrowMarker));
	assert.equal(originals, 1); assert.equal(resources, 0); assert.equal(rasterOpens, 0);
	assert.equal(JSON.stringify(photos), senderBefore); assert.deepEqual(f.original, originalBefore);
});
