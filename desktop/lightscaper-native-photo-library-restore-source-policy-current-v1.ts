/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { normalizePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { canonicalPhotoDocumentJsonV1 } from '../src/lightscaper/catalog/photo-document-json-v1.ts';

export interface LightscaperNativePhotoLibraryRestoreSourcePolicyCurrentV1 {
	readonly schemaVersion: 1;
	readonly kind: 'native-photo-library-restore-source-policy';
	readonly profile: 'embedded-originals-as-managed-copies/v1';
	readonly sourceOriginalSha256: string;
	readonly destinationOriginalSha256: string;
	readonly converted: boolean;
}
export interface LightscaperNativePhotoLibraryRestorePhotoCurrentV1 {
	readonly source: Readonly<PhotoDocumentCurrentV1>;
	readonly photo: Readonly<PhotoDocumentCurrentV1>;
	readonly policy: Readonly<LightscaperNativePhotoLibraryRestoreSourcePolicyCurrentV1>;
}

/** The archive codec admits the unchanged source graph before this native
 * destination policy. Embedded bytes become managed copies; grants, paths and
 * linked locator authority never enter the fresh generation. Descriptor hashes
 * describe the transform, while real Media/Catalog finish own body/readiness. */
export function captureLightscaperNativePhotoLibraryRestorePhotoCurrentV1(value: unknown): Readonly<LightscaperNativePhotoLibraryRestorePhotoCurrentV1> {
	const source = normalizePhotoDocumentCurrentV1(value), converted = source.original.retention === 'linked';
	const photo = converted ? normalizePhotoDocumentCurrentV1({ ...source, original: { ...source.original, retention: 'managed' } }) : source;
	const digest = (original: PhotoDocumentCurrentV1['original']): string =>
		createHash('sha256').update(canonicalPhotoDocumentJsonV1(original)).digest('hex');
	return Object.freeze({ source, photo, policy: Object.freeze({ schemaVersion: 1, kind: 'native-photo-library-restore-source-policy',
		profile: 'embedded-originals-as-managed-copies/v1', sourceOriginalSha256: digest(source.original),
		destinationOriginalSha256: digest(photo.original), converted }) });
}
