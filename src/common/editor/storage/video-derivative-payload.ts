/* SPDX-License-Identifier: AGPL-3.0-only */

import { VIDEO_PREVIEW_CAPTURE_MAXIMUM_ENCODED_BYTES } from '../video-preview-capture-admission.ts';
import type { StorageRecord } from './media-records.ts';

export const VIDEO_DERIVATIVE_BYTES_STORAGE = 'indexeddb-video-preview-bytes-v1';

/** Small reproducible previews remain portable where IndexedDB cannot clone Blob objects. */
export async function prepareVideoDerivativePayload(
	blob: Blob,
	file: Readonly<{ path: string }> | null,
	indexedDB: boolean,
): Promise<StorageRecord> {
	if (file) return { storage: 'opfs', path: file.path };
	if (!indexedDB || blob.size > VIDEO_PREVIEW_CAPTURE_MAXIMUM_ENCODED_BYTES) {
		return { storage: 'indexeddb-blob', blob };
	}
	const encodedBytes = new Uint8Array(await blob.arrayBuffer());
	if (encodedBytes.byteLength !== blob.size) throw new Error('The video derivative byte payload has an invalid size.');
	return { storage: VIDEO_DERIVATIVE_BYTES_STORAGE, encodedBytes };
}

/** Legacy Blob and OPFS records continue through the existing binary-record reader. */
export function readVideoDerivativeBytePayload(record: StorageRecord): Blob | null {
	if (record.storage !== VIDEO_DERIVATIVE_BYTES_STORAGE) return null;
	const bytes = record.encodedBytes;
	if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(record.size)
		|| Number(record.size) < 0 || Number(record.size) > VIDEO_PREVIEW_CAPTURE_MAXIMUM_ENCODED_BYTES
		|| bytes.byteLength !== record.size) {
		throw new Error('The video derivative byte payload failed its size integrity check.');
	}
	return new Blob([Uint8Array.from(bytes)], { type: typeof record.mimeType === 'string' ? record.mimeType : '' });
}
