/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateV3 } from '../../src/common/editor/imaging/image-develop-state-v3.ts';
import { nativeResourceBundleCurrentV1, nativeResourcePhotoCurrentV1, installNativeResourceBundleCurrentV1,
	type NativeResourceBundleCurrentV1 } from './lightscaper-native-photo-resources-integration-fixture-current.ts';
import type { ManagedMediaIntegrationOwnersCurrentV1 } from './lightscaper-native-managed-media-integration-fixture-current.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';
import { rawDngFixtureV1 } from './lightscaper-raw-dng-current-fixture.ts';
import { hdrFrameFixtureCurrentV1 } from './lightscaper-hdr-frame-current-fixture.ts';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5RkAAAAASUVORK5CYII=';
export const managedMediaIntegrationShaCurrentV1 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Encoded real PNG/DNG/HDR bytes. No decode or pixel-verifier seam is
 * installed: these tests qualify import persistence/custody, not decoding. */
export async function managedMediaIntegrationInputsCurrentV1() {
	const png = Uint8Array.from(Buffer.from(PNG, 'base64')), raw = rawDngFixtureV1().bytes, bundles: NativeResourceBundleCurrentV1[] = [];
	for (let index = 0; index < 6; index++) bundles.push(await nativeResourceBundleCurrentV1(index));
	const first = photoArchiveFixture(1, png), second = photoArchiveFixture(2, png), third = photoArchiveFixture(3, raw);
	const photo1 = normalizePhotoDocumentCurrentV1({ ...first.photo, original: { ...first.photo.original, hasAlpha: true } });
	const photo2 = normalizePhotoDocumentCurrentV1({ ...second.photo, schemaVersion: 2, original: { ...second.photo.original, hasAlpha: true },
		versions: second.photo.versions.map(version => ({ ...version, develop: defaultImageDevelopStateV2() })) });
	const rawOriginal = (index: number) => ({ ...third.photo.original, id: `source-${index}`, storageKey: `original-${index}`, name: `Original ${index}.dng`, mimeType: 'image/x-adobe-dng', width: 32, height: 32 });
	const photo3 = normalizePhotoDocumentCurrentV1({ ...third.photo, schemaVersion: 3, original: rawOriginal(3), metadata: { ...third.photo.metadata, fileName: 'Original 3.dng' },
		versions: third.photo.versions.map(version => ({ ...version, develop: normalizeImageDevelopStateV3({ ...defaultImageDevelopStateV2(), processVersion: 3, repairs: { schemaVersion: 1, spots: [] } }) })) });
	const full = nativeResourcePhotoCurrentV1(bundles);
	const photo4 = normalizePhotoDocumentCurrentV1({ ...full, id: 'photo-4', original: rawOriginal(4), metadata: { ...full.metadata, fileName: 'Original 4.dng' } });
	const hdr = await hdrFrameFixtureCurrentV1();
	const photo5 = normalizePhotoDocumentCurrentV1({ ...hdr.photo, catalogId: 'catalog-1', id: 'photo-5',
		original: { ...hdr.photo.original, id: 'source-5', storageKey: 'original-5' } });
	const entries = [
		{ photo: photo1, original: new Blob([png], { type: 'image/png' }), bytes: png },
		{ photo: photo2, original: new Blob([png], { type: 'image/png' }), bytes: png },
		{ photo: photo3, original: new Blob([raw], { type: 'image/x-adobe-dng' }), bytes: raw },
		{ photo: photo4, original: new Blob([raw], { type: 'image/x-adobe-dng' }), bytes: raw },
		{ photo: photo5, original: new Blob([hdr.original], { type: 'image/x-lightscaper-hdr' }), bytes: hdr.original },
	] as const;
	return { entries, bundles, async install(owner: ManagedMediaIntegrationOwnersCurrentV1) {
		for (const bundle of bundles) await installNativeResourceBundleCurrentV1(owner.resources, bundle);
	} };
}
