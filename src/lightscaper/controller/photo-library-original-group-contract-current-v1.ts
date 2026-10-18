/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray } from '../../common/editor/closed-domain-value.ts';
import { normalizePhotoOriginalV1 } from '../catalog/photo-document-envelope-v1.ts';
import { field, id, record } from '../catalog/value-validation.ts';
import type { PhotoLibraryOriginalRequestCurrentV1 as Request } from './photo-library-original-source-current-v1.ts';

export const PHOTO_LIBRARY_ORIGINAL_GROUP_LIMITS_CURRENT_V1 = Object.freeze({ maximumEntries: 4094,
	maximumRequestBytes: 2 * 1024 * 1024, maximumEncodedBytes: 384 * 1024 * 1024 });
export interface PhotoLibraryOriginalGroupPlanCurrentV1 {
	readonly requests: readonly Readonly<Request>[];
	/** Each Photo retains its authority; this index shares compatible bytes only. */
	readonly representatives: readonly number[];
	readonly uniqueEncodedBytes: number;
}
/** Detach the entire bounded authority vector before any acquisition starts.
 * Shared digest/locator declarations must agree about immutable body shape. */
export function readPhotoLibraryOriginalGroupCurrentV1(value: unknown): Readonly<PhotoLibraryOriginalGroupPlanCurrentV1> {
	const limits = PHOTO_LIBRARY_ORIGINAL_GROUP_LIMITS_CURRENT_V1;
	const input = readClosedDomainArray(value, 'Original group requests', 0, limits.maximumEntries);
	const requests: Readonly<Request>[] = [], representatives: number[] = [], photos = new Set<string>();
	const digests = new Map<string, Readonly<{ identity: string; index: number }>>(), locators = new Map<string, string>();
	let uniqueEncodedBytes = 0, requestBytes = 2, catalogId: string | undefined;
	for (const raw of input) {
		const entry = record(raw, 'Original group request', ['catalogId', 'photoId', 'original']);
		const request = Object.freeze({ catalogId: id(field(entry, 'catalogId'), 'Original group catalog ID'),
			photoId: id(field(entry, 'photoId'), 'Original group Photo ID'), original: normalizePhotoOriginalV1(field(entry, 'original')) });
		if (catalogId !== undefined && catalogId !== request.catalogId) throw new TypeError('Original group crosses its selected catalog.');
		catalogId = request.catalogId;
		if (photos.has(request.photoId)) throw new TypeError('Original group repeats a Photo authority.'); photos.add(request.photoId);
		requestBytes += new TextEncoder().encode(JSON.stringify(request)).byteLength + (requests.length ? 1 : 0);
		if (requestBytes > limits.maximumRequestBytes) throw new RangeError('Original group request byte capacity exceeded.');
		const original = request.original, identity = JSON.stringify({ byteLength: original.byteLength, mimeType: original.mimeType,
			width: original.width, height: original.height, hasAlpha: original.hasAlpha });
		const previous = digests.get(original.contentSha256), locator = JSON.stringify([original.contentSha256, identity]);
		if (previous !== undefined && previous.identity !== identity) throw new TypeError('Original group shared digest identity differs.');
		if (locators.has(original.storageKey) && locators.get(original.storageKey) !== locator) throw new TypeError('Original group shared locator identity differs.');
		locators.set(original.storageKey, locator);
		if (previous === undefined) {
			if (original.byteLength > limits.maximumEncodedBytes - uniqueEncodedBytes) throw new RangeError('Original group encoded byte capacity exceeded.');
			uniqueEncodedBytes += original.byteLength; digests.set(original.contentSha256, { identity, index: requests.length });
		}
		representatives.push(previous?.index ?? requests.length); requests.push(request);
	}
	return Object.freeze({ requests: Object.freeze(requests), representatives: Object.freeze(representatives), uniqueEncodedBytes });
}
