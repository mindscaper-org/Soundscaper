/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/foundation/closed-domain-value.ts';
import { id, integer } from './catalog/value-validation.ts';

/** Fixed families require their own closed domain packets. This inventory
 * offers no reflected method names, paths, callbacks or native owner access. */
export const DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 = Object.freeze({
	open: 'lightscaper:v1:photo-session:open', stop: 'lightscaper:v1:photo-session:stop',
	close: 'lightscaper:v1:photo-session:close', cancel: 'lightscaper:v1:photo-session:cancel',
	catalog: 'lightscaper:v1:photo-session:catalog', query: 'lightscaper:v1:photo-session:query',
	stacks: 'lightscaper:v1:photo-session:stacks', saved: 'lightscaper:v1:photo-session:saved',
	settings: 'lightscaper:v1:photo-session:settings', custody: 'lightscaper:v1:photo-session:custody',
	originalOpen: 'lightscaper:v1:photo-session:original-open', originalRead: 'lightscaper:v1:photo-session:original-read',
	rawOpen: 'lightscaper:v1:photo-session:raw-open', rawRead: 'lightscaper:v1:photo-session:raw-read', rawClose: 'lightscaper:v1:photo-session:raw-close',
	rawInput: 'lightscaper:v1:photo-session:raw-input',
	originalClose: 'lightscaper:v1:photo-session:original-close', originalOpenGroup: 'lightscaper:v1:photo-session:original-open-group',
	originalReadGroup: 'lightscaper:v1:photo-session:original-read-group', originalCloseGroup: 'lightscaper:v1:photo-session:original-close-group',
	upload: 'lightscaper:v1:photo-session:upload', cache: 'lightscaper:v1:photo-session:cache',
	resource: 'lightscaper:v1:photo-session:resource', archive: 'lightscaper:v1:photo-session:archive',
	exclusive: 'lightscaper:v1:photo-session:exclusive',
	linked: 'lightscaper:v1:photo-session:linked',
});

/** Connection capacity, separate from each owning value grammar. Originals
 * keep their existing independent acquisition/count/encoded-byte budgets.
 * Cancellation and cleanup must remain admissible when work slots are full. */
export const DESKTOP_PHOTO_LIBRARY_SESSION_PROTOCOL_LIMITS_CURRENT_V1 = Object.freeze({
	maximumActiveRequests: 16, maximumHandles: 16, maximumInFlightChunks: 1,
	maximumChunkBytes: 1_048_576, maximumRetainedBodyBytes: 134_217_728,
});

export interface DesktopPhotoLibrarySessionDescriptorCurrentV1 {
	readonly schemaVersion: 1;
	readonly kind: 'desktop-photo-session';
	readonly profile: 'current3';
	readonly sessionId: string;
	readonly catalogId: string;
	readonly selectionToken: string;
}

export interface DesktopPhotoLibrarySessionRequestIdentityCurrentV1 {
	readonly schemaVersion: 1;
	readonly sessionId: string;
	readonly requestId: number;
	readonly exclusiveId: string | null;
}

export type DesktopPhotoLibrarySessionHandleKindCurrentV1 = 'upload' | 'download' | 'resource' | 'archive' | 'exclusive' | 'raw-input' | 'linked-input' | 'linked-scan';
export interface DesktopPhotoLibrarySessionHandleCurrentV1<Kind extends DesktopPhotoLibrarySessionHandleKindCurrentV1 = DesktopPhotoLibrarySessionHandleKindCurrentV1> {
	readonly kind: Kind;
	readonly id: string;
}

export function readDesktopPhotoLibrarySessionDescriptorCurrentV1(value: unknown): Readonly<DesktopPhotoLibrarySessionDescriptorCurrentV1> {
	const label = 'desktop Photo Session descriptor';
	const input = record(value, label, ['schemaVersion', 'kind', 'profile', 'sessionId', 'catalogId', 'selectionToken']);
	version(field(input, 'schemaVersion', label));
	if (field(input, 'kind', label) !== 'desktop-photo-session' || field(input, 'profile', label) !== 'current3')
		throw new RangeError('Unsupported desktop Photo Session profile.');
	return Object.freeze({ schemaVersion: 1, kind: 'desktop-photo-session', profile: 'current3',
		sessionId: hexadecimal(field(input, 'sessionId', label), 64), catalogId: id(field(input, 'catalogId', label), 'Session catalog ID'),
		selectionToken: hexadecimal(field(input, 'selectionToken', label), 32) });
}

/** Parse only inert routing scalars. Main must authenticate the actual frame
 * and document owner, consume its send-time request watermark, and validate
 * the fixed domain packet. This record alone grants no native authority. */
export function readDesktopPhotoLibrarySessionRequestIdentityCurrentV1(value: unknown): Readonly<DesktopPhotoLibrarySessionRequestIdentityCurrentV1> {
	const label = 'desktop Photo Session request identity';
	const input = record(value, label, ['schemaVersion', 'sessionId', 'requestId', 'exclusiveId']);
	version(field(input, 'schemaVersion', label));
	const exclusiveId = field(input, 'exclusiveId', label);
	return Object.freeze({ schemaVersion: 1, sessionId: hexadecimal(field(input, 'sessionId', label), 64),
		requestId: integer(field(input, 'requestId', label), 1, Number.MAX_SAFE_INTEGER, 'Session request ID'),
		exclusiveId: exclusiveId === null ? null : hexadecimal(exclusiveId, 64) });
}

/** A parsed handle is not a retirement receipt or a capability for a foreign
 * owner. The live Main registry must also bind session, document and purpose. */
export function readDesktopPhotoLibrarySessionHandleCurrentV1<Kind extends DesktopPhotoLibrarySessionHandleKindCurrentV1>(
	value: unknown, expectedKind: Kind,
): Readonly<DesktopPhotoLibrarySessionHandleCurrentV1<Kind>> {
	const label = 'desktop Photo Session handle', input = record(value, label, ['kind', 'id']);
	const kind = field(input, 'kind', label);
	if (!['upload', 'download', 'resource', 'archive', 'exclusive', 'raw-input', 'linked-input', 'linked-scan'].includes(typeof kind === 'string' ? kind : '') || kind !== expectedKind)
		throw new RangeError('Desktop Photo Session handle has an unsupported purpose.');
	return Object.freeze({ kind: expectedKind, id: hexadecimal(field(input, 'id', label), 64) });
}

function version(value: unknown): void {
	if (value !== 1) throw new RangeError('Unsupported desktop Photo Session wire version.');
}
function hexadecimal(value: unknown, length: 32 | 64): string {
	if (typeof value !== 'string' || value.length !== length || !/^[0-9a-f]+$/u.test(value))
		throw new TypeError('Desktop Photo Session requires an exact lowercase opaque token.');
	return value;
}
