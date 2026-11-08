/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { normalizePhotoDocumentCurrentV1, serializePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { createPhotoResourceReachabilityCurrentV1 } from '../src/lightscaper/catalog/photo-resource-reachability-current-v1.ts';
import { photoMemberships } from '../src/lightscaper/catalog/repository-records.ts';
import { PHOTO_CATALOG_REPOSITORY_LIMITS as LIMITS } from '../src/lightscaper/catalog/repository-types.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import type { PhotoOriginalV1 } from '../src/lightscaper/catalog/types.ts';
import { array, field, record, unique } from '../src/lightscaper/catalog/value-validation.ts';
import { readLightscaperNativePhotoOriginalEnvelopeCurrentV1 as readLightscaperNativeOriginalCurrentV1 } from './lightscaper-native-photo-original-envelope-current-v1.ts';

export type LightscaperNativeCatalogAdmissionPurposeCurrentV1 = 'import' | 'edit';
export interface LightscaperNativeCatalogVerificationCurrentV1 {
	readonly verifyOriginal?: (original: PhotoOriginalV1, signal?: AbortSignal) => Promise<void>;
	readonly verifyResources?: (photo: PhotoDocumentCurrentV1, signal?: AbortSignal) => Promise<void>;
}
declare const admissionBrand: unique symbol;
export interface LightscaperNativeCatalogPhotoAdmissionCurrentV1 { readonly [admissionBrand]: true }
interface Admission {
	readonly database: DatabaseSync;
	readonly purpose: LightscaperNativeCatalogAdmissionPurposeCurrentV1;
	readonly photos: readonly PhotoDocumentCurrentV1[];
}
const admissions = new WeakMap<object, Admission>();

/** The main owner registers and joins this entire promise before invoking it.
 * Capture every whole document and callback before the first borrowed wait.
 * Edit admission deliberately does not read a possibly unavailable Original. */
export async function admitLightscaperNativeCatalogPhotosCurrentV1(database: DatabaseSync, values: unknown,
	purpose: LightscaperNativeCatalogAdmissionPurposeCurrentV1, ports: LightscaperNativeCatalogVerificationCurrentV1,
	signal?: AbortSignal): Promise<LightscaperNativeCatalogPhotoAdmissionCurrentV1> {
	assertSignal(signal);
	if (purpose !== 'import' && purpose !== 'edit') throw new TypeError('Unsupported native Photo admission purpose.');
	const options = record(ports, 'native catalog verification', ['verifyOriginal', 'verifyResources'], []);
	const original = Object.hasOwn(options, 'verifyOriginal') ? field(options, 'verifyOriginal') : undefined;
	const resources = Object.hasOwn(options, 'verifyResources') ? field(options, 'verifyResources') : undefined;
	if ((original !== undefined && typeof original !== 'function') || (resources !== undefined && typeof resources !== 'function')) {
		throw new TypeError('Native catalog verification ports require functions.');
	}
	if (purpose === 'import' && typeof original !== 'function') throw new TypeError('Native import requires immutable Original custody verification.');
	const photos = Object.freeze(array(values, 'native catalog photos', 1, purpose === 'edit' ? 1 : LIMITS.maximumImportPhotos)
		.map(normalizePhotoDocumentCurrentV1));
	unique(photos.map(photo => photo.id), 'native catalog photos');
	let bytes = 0, memberships = 0;
	const needsResources = photos.map(photo => {
		readLightscaperNativeOriginalCurrentV1(photo.original);
		if (purpose === 'import' && photo.revision !== 0) throw new RangeError('Imported Photos require initial revision zero.');
		bytes += new TextEncoder().encode(serializePhotoDocumentCurrentV1(photo)).byteLength;
		memberships += photoMemberships(photo).length;
		const closure = createPhotoResourceReachabilityCurrentV1(); closure.addPhoto(photo);
		const { luts, brushes } = closure.finish();
		return luts.length !== 0 || brushes.length !== 0;
	});
	if (bytes > LIMITS.maximumImportBytes || memberships > LIMITS.maximumMembershipWrites) throw new RangeError('Native Photo batch exceeds its byte or membership budget.');
	if (needsResources.some(Boolean) && typeof resources !== 'function') throw new TypeError('Photo resources require selected-library verification.');
	for (let index = 0; index < photos.length; index++) {
		const photo = photos[index]!; assertSignal(signal);
		if (purpose === 'import') {
			await Reflect.apply(original as NonNullable<typeof ports.verifyOriginal>, ports, [photo.original, signal]);
			assertSignal(signal);
		}
		if (typeof resources === 'function') {
			await Reflect.apply(resources as NonNullable<typeof ports.verifyResources>, ports, [photo, signal]);
			assertSignal(signal);
		}
	}
	assertSignal(signal);
	const token = Object.freeze({}) as LightscaperNativeCatalogPhotoAdmissionCurrentV1;
	admissions.set(token, Object.freeze({ database, purpose, photos }));
	return token;
}

/** Main-private SQL boundary: neither a structural clone nor an edit-only
 * receipt can authorize insertion. No body verification occurs inside SQLite. */
export function readLightscaperNativeCatalogPhotoAdmissionCurrentV1(value: unknown, database: DatabaseSync,
	purpose: LightscaperNativeCatalogAdmissionPurposeCurrentV1): readonly PhotoDocumentCurrentV1[] {
	const admitted = value !== null && typeof value === 'object' ? admissions.get(value) : undefined;
	if (!admitted || admitted.database !== database || admitted.purpose !== purpose) throw new TypeError('Native catalog requires its database and purpose-bound Photo admission.');
	return admitted.photos;
}
function assertSignal(signal: AbortSignal | undefined): void { if (signal !== undefined) assertPhotoStackQuerySignalV1(signal); }
