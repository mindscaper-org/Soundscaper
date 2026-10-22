/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from './closed-domain-value.ts';
import { isProjectFileName } from '../project-file-extensions.ts';
import { DESKTOP_READ_PROFILE_SCAPE_RANGE, DESKTOP_SCAPE_MIME_TYPE, DESKTOP_SCAPE_READ_HARD_LIMIT_BYTES } from './desktop-read-profile.ts';

export interface DesktopLightscaperArchiveOpenDescriptorCurrentV1 {
	readonly id: string;
	readonly url: string;
	readonly name: string;
	readonly size: number;
	readonly mimeType: typeof DESKTOP_SCAPE_MIME_TYPE;
	readonly readProfile: typeof DESKTOP_READ_PROFILE_SCAPE_RANGE;
	readonly lastModified: number;
}
export interface DesktopLightscaperArchiveOpenFinishCurrentV1 { readonly id: string }
export interface DesktopLightscaperArchiveOpenAvailabilityCurrentV1 { readonly available: boolean }
export interface DesktopLightscaperArchiveOpenBridgeCurrentV1 {
	takeArchive(): Promise<Readonly<DesktopLightscaperArchiveOpenDescriptorCurrentV1> | null>;
	finishArchive(request: Readonly<DesktopLightscaperArchiveOpenFinishCurrentV1>): Promise<void>;
	onArchiveAvailable(listener: () => void): () => void;
}

const DESCRIPTOR_FIELDS = ['id', 'url', 'name', 'size', 'mimeType', 'readProfile', 'lastModified'] as const;
const ORIGIN = 'lightscaper-app://bundle';

/** The native store's existing seven-field DTO, narrowed to Light's exact
 * archive route. A suffix routes the input; its Photo manifest decides content
 * eligibility. No native path, helper ticket or overwrite authority crosses. */
export function readDesktopLightscaperArchiveOpenDescriptorCurrentV1(value: unknown): Readonly<DesktopLightscaperArchiveOpenDescriptorCurrentV1> {
	const input = readClosedDomainRecord(value, 'Lightscaper archive descriptor', DESCRIPTOR_FIELDS);
	const field = (key: string): unknown => readClosedDomainField(input, key, 'Lightscaper archive descriptor');
	const id = archiveId(field('id')), name = field('name');
	if (typeof name !== 'string' || !name || name.length > 255 || name.includes('/') || name.includes('\\')
		|| Array.from(name).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
		|| !isProjectFileName(name)) throw new TypeError('Lightscaper archive requires a safe terminal Scape name.');
	if (field('readProfile') !== DESKTOP_READ_PROFILE_SCAPE_RANGE || field('mimeType') !== DESKTOP_SCAPE_MIME_TYPE) {
		throw new TypeError('Lightscaper archive requires the native Scape range profile.');
	}
	const size = nonnegativeInteger(field('size')), lastModified = nonnegativeInteger(field('lastModified'));
	if (size > DESKTOP_SCAPE_READ_HARD_LIMIT_BYTES) throw new RangeError('Lightscaper archive exceeds the native Scape range bound.');
	const url = field('url'), expected = `${ORIGIN}/_desktop/read/${DESKTOP_READ_PROFILE_SCAPE_RANGE}/${id}/${encodeURIComponent(name)}`;
	if (url !== expected) throw new TypeError('Lightscaper archive requires its exact same-origin native read URL.');
	return Object.freeze({ id, url: expected, name, size, mimeType: DESKTOP_SCAPE_MIME_TYPE, readProfile: DESKTOP_READ_PROFILE_SCAPE_RANGE, lastModified });
}
export function readDesktopLightscaperArchiveOpenFinishCurrentV1(value: unknown): Readonly<DesktopLightscaperArchiveOpenFinishCurrentV1> {
	const input = readClosedDomainRecord(value, 'Lightscaper archive finish', ['id']);
	return Object.freeze({ id: archiveId(readClosedDomainField(input, 'id', 'Lightscaper archive finish')) });
}
export function readDesktopLightscaperArchiveOpenAvailabilityCurrentV1(value: unknown): Readonly<DesktopLightscaperArchiveOpenAvailabilityCurrentV1> {
	const input = readClosedDomainRecord(value, 'Lightscaper archive availability', ['available']);
	const available = readClosedDomainField(input, 'available', 'Lightscaper archive availability');
	if (typeof available !== 'boolean') throw new TypeError('Lightscaper archive availability requires a boolean.');
	return Object.freeze({ available });
}
function archiveId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Lightscaper archive requires its opaque native read identity.');
	return value;
}
function nonnegativeInteger(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new RangeError('Lightscaper archive requires canonical nonnegative integer facts.');
	return value;
}
