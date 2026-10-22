/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';
import type { PhotoOriginalV1 } from './catalog/types.ts';
import type { PhotoLibraryOriginalRequestCurrentV1 } from './controller/photo-library-original-source-current-v1.ts';
import { DESKTOP_PHOTO_ORIGINAL_LIMITS_CURRENT_V1 as LIMITS, readDesktopPhotoOriginalTicketCurrentV1,
	readDesktopPhotoOriginalTicketIdCurrentV1 } from './desktop-photo-original-contract-current-v1.ts';

export interface DesktopPhotoOriginalGroupTicketCurrentV1 {
	readonly id: string;
	readonly originals: readonly Readonly<PhotoOriginalV1>[];
}
/** Cleanup captures the group ID before inspecting a possibly malformed
 * Original vector. Main binds indexed reads to the captured group authority. */
export function readDesktopPhotoOriginalGroupTicketIdCurrentV1(value: unknown): string {
	return readDesktopPhotoOriginalTicketIdCurrentV1(value);
}
/** Main-issued vector must match every captured Photo's full immutable Original
 * in order. No member ID or individually closeable native ticket is exposed. */
export function readDesktopPhotoOriginalGroupTicketCurrentV1(value: unknown,
	expectedRequests: readonly Readonly<PhotoLibraryOriginalRequestCurrentV1>[]): Readonly<DesktopPhotoOriginalGroupTicketCurrentV1> {
	const input = record(value, 'desktop Original group ticket', ['id', 'originals']);
	const id = readDesktopPhotoOriginalGroupTicketIdCurrentV1(value);
	const candidates = readClosedDomainArray(field(input, 'originals', 'desktop Original group ticket'), 'desktop Original group vector', 0, LIMITS.maximumStages);
	if (candidates.length !== expectedRequests.length) throw new RangeError('Native Original group differs from its complete selected authority vector.');
	const originals = candidates.map((original, index) => readDesktopPhotoOriginalTicketCurrentV1({ id, original }, expectedRequests[index]!).original);
	return Object.freeze({ id, originals: Object.freeze(originals) });
}
