/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/foundation/closed-domain-value.ts';
import { normalizePhotoOriginalV1 } from './catalog/photo-document-envelope-v1.ts';
import { id } from './catalog/value-validation.ts';
import { IMAGE_HDR_ORIGINAL_LIMITS_V1 } from '../common/editor/imaging/image-hdr-original-profile-v1.ts';
import type { PhotoOriginalV1 } from './catalog/types.ts';
import type { PhotoLibraryOriginalRequestCurrentV1 } from './controller/photo-library-original-source-current-v1.ts';

export const DESKTOP_PHOTO_ORIGINAL_LIMITS_CURRENT_V1 = Object.freeze({ rangeBytes: 1024 * 1024,
	maximumAcquisitions: 4, maximumStages: 4094, maximumEncodedBytes: 384 * 1024 * 1024 });
export interface DesktopPhotoOriginalTicketCurrentV1 { readonly id: string; readonly original: Readonly<PhotoOriginalV1> }
export interface DesktopPhotoOriginalTransportCurrentV1 {
	open(request: Readonly<PhotoLibraryOriginalRequestCurrentV1>): Promise<unknown>;
	read(ticket: Readonly<DesktopPhotoOriginalTicketCurrentV1>, offset: number, length: number): Promise<unknown>;
	/** Cancels admission and joins any actual native pull, including a held read. */
	close(ticket: Readonly<{ id: string }>): Promise<void>;
	/** Optional complete group transport; all three methods must be present together. */
	openGroup?(requests: readonly Readonly<PhotoLibraryOriginalRequestCurrentV1>[]): Promise<unknown>;
	readGroup?(ticket: Readonly<{ id: string }>, index: number, offset: number, length: number): Promise<unknown>;
	closeGroup?(ticket: Readonly<{ id: string }>): Promise<void>;
}
export interface DesktopPhotoOriginalWritableCurrentV1 {
	write(bytes: Uint8Array<ArrayBuffer>): PromiseLike<unknown>;
	close(): PromiseLike<unknown>;
	abort(reason?: unknown): PromiseLike<unknown>;
}
export interface DesktopPhotoOriginalFileHandleCurrentV1 {
	createWritable(options: Readonly<{ keepExistingData: false }>): PromiseLike<DesktopPhotoOriginalWritableCurrentV1>;
	getFile(): PromiseLike<unknown>;
}
export interface DesktopPhotoOriginalDirectoryCurrentV1 {
	getDirectoryHandle(name: string, options: Readonly<{ create: boolean }>): PromiseLike<DesktopPhotoOriginalDirectoryCurrentV1>;
	getFileHandle(name: string, options: Readonly<{ create: boolean }>): PromiseLike<DesktopPhotoOriginalFileHandleCurrentV1>;
	removeEntry(name: string, options: Readonly<{ recursive: true }>): PromiseLike<void>;
}
export interface DesktopPhotoOriginalStorageCurrentV1 { getDirectory(): PromiseLike<DesktopPhotoOriginalDirectoryCurrentV1> }
export interface DesktopPhotoOriginalSourceOptionsCurrentV1 {
	readonly storage?: DesktopPhotoOriginalStorageCurrentV1;
	readonly createId?: () => string;
}

export function readDesktopPhotoOriginalRequestCurrentV1(value: unknown): Readonly<PhotoLibraryOriginalRequestCurrentV1> {
	const input = record(value, 'desktop Original request', ['catalogId', 'photoId', 'original']);
	return Object.freeze({ catalogId: id(field(input, 'catalogId', 'desktop Original request'), 'Original catalog ID'),
		photoId: id(field(input, 'photoId', 'desktop Original request'), 'Original Photo ID'),
		original: original(field(input, 'original', 'desktop Original request')) });
}
export function readDesktopPhotoOriginalTicketIdCurrentV1(value: unknown): string {
	if (value === null || typeof value !== 'object') throw new TypeError('An issued native Original ticket is required.');
	const descriptor = Object.getOwnPropertyDescriptor(value, 'id');
	if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string' || !/^[a-f0-9]{64}$/u.test(descriptor.value)) {
		throw new TypeError('An inert issued native Original ticket ID is required.');
	}
	return descriptor.value;
}
export function readDesktopPhotoOriginalTicketCurrentV1(value: unknown, expected: Readonly<PhotoLibraryOriginalRequestCurrentV1>): Readonly<DesktopPhotoOriginalTicketCurrentV1> {
	const input = record(value, 'desktop Original ticket', ['id', 'original']), ticketId = readDesktopPhotoOriginalTicketIdCurrentV1(value);
	const normalized = original(field(input, 'original', 'desktop Original ticket'));
	if (JSON.stringify(normalized) !== JSON.stringify(expected.original)) throw new Error('Native Original ticket differs from the selected immutable Original.');
	return Object.freeze({ id: ticketId, original: normalized });
}
function original(value: unknown): Readonly<PhotoOriginalV1> {
	const admitted = normalizePhotoOriginalV1(value);
	if (admitted.byteLength > IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumEncodedBytes) throw new RangeError('Desktop Original requires the bounded native byte profile.');
	return admitted;
}
