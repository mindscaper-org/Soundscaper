/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { canonicalMediaContentBlob } from '../common/editor/storage/media-content-digest.ts';
import { measureDesktopPhotoCloneCurrentV1 } from './desktop-photo-clone-current-v1.ts';
import { DesktopPhotoSessionClientCallsCurrentV1 as Calls, desktopPhotoSignalCurrentV1 as signalOf,
	desktopPhotoVoidCurrentV1 as empty } from './desktop-photo-library-session-client-calls-current-v1.ts';
import { readDesktopPhotoLibrarySessionHandleCurrentV1 as handle } from './desktop-photo-library-session-protocol-current-v1.ts';
import { array, boolean, field, integer, record, text } from './catalog/value-validation.ts';
import { DESKTOP_PHOTO_TRANSFER_BYTES_CURRENT_V1, copyDesktopPhotoBytesCurrentV1, desktopPhotoDigestCurrentV1 } from './desktop-photo-transfer-bytes-current-v1.ts';
export { DESKTOP_PHOTO_TRANSFER_BYTES_CURRENT_V1, copyDesktopPhotoBytesCurrentV1, desktopPhotoDigestCurrentV1 };

const SLICE = Blob.prototype.slice, READ = Blob.prototype.arrayBuffer, FILL = Uint8Array.prototype.fill;
export type UploadReceiptReader<Value> = (value: unknown) => Value | Promise<Value>;

export function wipeDesktopPhotoBytesCurrentV1(bytes: Uint8Array): void { Reflect.apply(FILL, bytes, [0]); }
export function hashDesktopPhotoBytesCurrentV1(value: Uint8Array): string { return bytesToHex(sha256(value)); }

/** Every escaped writer caches terminal requests and joins an accepted write.
	* Native COMMIT is the publication ACK; no post-ACK signal check revokes it. */
export async function openDesktopPhotoUploadCurrentV1<Value>(c: Calls, payload: Record<string, unknown>, expectedBytes: number,
	signal: AbortSignal | undefined, readReceipt: UploadReceiptReader<Value>) {
	// Transfer the caller's preflight debt synchronously into the actual upload
	// owner. These bounded bodies remain retained until terminal native cleanup.
	const bodyBytes = payload.operation === 'asset-begin' ? measureDesktopPhotoCloneCurrentV1(payload.metadata) : payload.operation === 'repair-begin' ? 0 : expectedBytes;
	const release = c.reserve(bodyBytes); let h: ReturnType<typeof handle<'upload'>> | undefined;
	try {
		h = await c.send('upload', () => payload, value => { const row = record(value, 'desktop upload', ['handle', 'maximumChunkBytes', 'bytesWritten']);
			if (field(row, 'maximumChunkBytes') !== DESKTOP_PHOTO_TRANSFER_BYTES_CURRENT_V1 || field(row, 'bytesWritten') !== 0) throw new TypeError('Invalid initial upload offset.'); return handle(field(row, 'handle'), 'upload'); }, signal, false, true);
		c.assert(); if (signal) signal.throwIfAborted();
	} catch (primary) { if (h) { try { await c.send('upload', () => ({ operation: 'abort', handle: h }), empty, undefined, true, true); } catch (cleanup) { c.notice(cleanup); throw new AggregateError([primary, cleanup], 'Upload opening and retirement failed.', { cause: cleanup }); } } release(); throw primary; }
	const issued = h; let written = 0, sequence = 0, writing: Promise<void> | undefined, committed: Promise<Value> | undefined, aborted: Promise<void> | undefined, terminal = false;
	const writer = Object.freeze({ maximumChunkBytes: DESKTOP_PHOTO_TRANSFER_BYTES_CURRENT_V1, get bytesWritten() { return written; },
		write(value: Uint8Array, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<void> {
			return c.own(() => {
				if (terminal || writing || committed) throw new Error('Desktop upload is terminal or busy.');
				let done!: () => void, fail!: (reason: unknown) => void; const work = new Promise<void>((yes, no) => { done = yes; fail = no; }); writing = work;
				let bytes: Uint8Array<ArrayBuffer> | undefined;
				try {
					const activeSignal = signalOf(options) ?? signal; bytes = copyDesktopPhotoBytesCurrentV1(value);
					if (bytes.byteLength > expectedBytes - written) throw new RangeError('Desktop upload exceeds declared size.');
					const accepted = bytes, acceptedSequence = sequence, offset = written;
					void c.send('upload', () => ({ operation: 'write', handle: issued, sequence: acceptedSequence, offset, bytes: accepted }), reply => {
						const ack = record(reply, 'desktop chunk ACK', ['sequence', 'offset']);
						if (field(ack, 'sequence') !== acceptedSequence || field(ack, 'offset') !== offset + accepted.byteLength) throw new TypeError('Desktop chunk ACK disagrees with accepted bytes.');
						written += accepted.byteLength; sequence++; }, activeSignal, false, true).then(done, fail);
				} catch (error) { fail(error); }
				return work.finally(() => { if (bytes) Reflect.apply(FILL, bytes, [0]); writing = undefined; });
			});
		},
		commit(options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Value> {
			if (committed) return committed;
			let resolve!: (value: Value | PromiseLike<Value>) => void, reject!: (reason: unknown) => void;
			committed = new Promise<Value>((yes, no) => { resolve = yes; reject = no; });
			void c.own(async () => {
				const activeSignal = signalOf(options) ?? signal; if (aborted) throw new Error('Desktop upload was aborted.');
				await writing; if (written !== expectedBytes) throw new RangeError('Desktop upload is incomplete.');
				const result = await c.send('upload', () => ({ operation: 'commit', handle: issued }), readReceipt, activeSignal, false, true);
				terminal = true; release(); return result;
			}).then(resolve, reject); return committed;
		},
		abort(): Promise<void> {
			if (aborted) return aborted; if (terminal) return aborted = Promise.resolve(); terminal = true;
			aborted = c.own(async () => { await writing?.catch(() => undefined);
				await c.send('upload', () => ({ operation: 'abort', handle: issued }), empty, undefined, true, true);
				await committed?.catch(() => undefined); release(); }, true); return aborted;
		},
	}); return writer;
}
export async function uploadDesktopPhotoBlobCurrentV1<Value>(c: Calls, payload: Record<string, unknown>, input: Blob,
	signal: AbortSignal | undefined, readReceipt: UploadReceiptReader<Value>): Promise<Value> {
	const body = canonicalMediaContentBlob(input), writer = await openDesktopPhotoUploadCurrentV1(c, payload, body.size, signal, readReceipt);
	let primary: unknown;
	try {
		for (let offset = 0; offset < body.size; offset += DESKTOP_PHOTO_TRANSFER_BYTES_CURRENT_V1) {
			c.assert(); if (signal) signal.throwIfAborted();
			const part = Reflect.apply(SLICE, body, [offset, Math.min(offset + DESKTOP_PHOTO_TRANSFER_BYTES_CURRENT_V1, body.size)]) as Blob;
			const bytes = new Uint8Array(await (Reflect.apply(READ, part, []) as Promise<ArrayBuffer>));
			try { await writer.write(bytes, signal ? { signal } : {}); } finally { wipeDesktopPhotoBytesCurrentV1(bytes); }
		}
		return await writer.commit(signal ? { signal } : {});
	} catch (error) { primary = error; }
	try { await writer.abort(); } catch (cleanup) { c.notice(cleanup); throw new AggregateError([primary, cleanup], 'Desktop upload and retirement failed.', { cause: cleanup }); }
	throw primary;
}
export async function readDesktopPhotoDownloadCurrentV1(c: Calls, family: 'cache' | 'resource', receipt: unknown,
	expectedBytes: number, expectedSha256: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
	const row = record(receipt, 'desktop body receipt', family === 'cache' ? ['handle', 'identity', 'outputSha256', 'mimeType', 'byteLength'] : ['handle', 'byteLength']);
	const h = handle(field(row, 'handle'), family === 'cache' ? 'download' : 'resource');
	const size = integer(field(row, 'byteLength'), 0, 134_217_728, 'download size'); if (size !== expectedBytes) throw new TypeError('Native body size differs from its admitted reference.');
	const bytes = new Uint8Array(size), digest = sha256.create(); let primary: unknown;
	try {
		for (let offset = 0; offset < size; offset += DESKTOP_PHOTO_TRANSFER_BYTES_CURRENT_V1) {
			const length = Math.min(DESKTOP_PHOTO_TRANSFER_BYTES_CURRENT_V1, size - offset);
			const part = await c.send(family, () => ({ operation: family === 'cache' ? 'download' : 'read', handle: h, offset, length }), value => copyDesktopPhotoBytesCurrentV1(value), signal);
			try { if (part.byteLength !== length) throw new TypeError('Native download returned a short range.'); bytes.set(part, offset); digest.update(part); } finally { wipeDesktopPhotoBytesCurrentV1(part); }
		}
		if (bytesToHex(digest.digest()) !== expectedSha256) throw new Error('Native downloaded body digest mismatch.'); return bytes;
	} catch (error) { primary = error; wipeDesktopPhotoBytesCurrentV1(bytes); }
	// A resource's real callback must remain held until the local consumer joins;
	// its caller owns CLOSE even when materialization succeeds.
	throw primary;
}
export async function digestDesktopPhotoBlobCurrentV1(body: Blob, signal?: AbortSignal): Promise<string> {
	const native = canonicalMediaContentBlob(body), hash = sha256.create();
	for (let offset = 0; offset < native.size; offset += DESKTOP_PHOTO_TRANSFER_BYTES_CURRENT_V1) {
		if (signal) signal.throwIfAborted();
		const part = Reflect.apply(SLICE, native, [offset, Math.min(native.size, offset + DESKTOP_PHOTO_TRANSFER_BYTES_CURRENT_V1)]) as Blob;
		const bytes = new Uint8Array(await (Reflect.apply(READ, part, []) as Promise<ArrayBuffer>));
		try { if (signal) signal.throwIfAborted(); hash.update(bytes); } finally { wipeDesktopPhotoBytesCurrentV1(bytes); }
	}
	if (signal) signal.throwIfAborted(); return bytesToHex(hash.digest());
}
export function readDesktopPhotoCacheStoreCurrentV1(value: unknown) {
	const row = record(value, 'cache store receipt', ['outcome', 'cleanupErrors'], ['outcome']), outcome = field(row, 'outcome');
	if (outcome !== 'stored' && outcome !== 'pressure') throw new TypeError('Invalid native cache publication.');
	return Object.freeze({ outcome, ...(Object.hasOwn(row, 'cleanupErrors') ? { cleanupErrors: Object.freeze(array(field(row, 'cleanupErrors'), 'cache cleanup notices', 0, 16)) } : {}) });
}
export function readDesktopPhotoCacheTrimCurrentV1(value: unknown) {
	const row = record(value, 'cache trim receipt', ['removedEntries', 'removedBytes', 'more', 'cleanupErrors'], ['removedEntries', 'removedBytes', 'more']);
	return Object.freeze({ removedEntries: integer(field(row, 'removedEntries'), 0, 16, 'trim count'), removedBytes: integer(field(row, 'removedBytes'), 0, 134_217_728, 'trim bytes'), more: boolean(field(row, 'more'), 'trim progress'),
		...(Object.hasOwn(row, 'cleanupErrors') ? { cleanupErrors: Object.freeze(array(field(row, 'cleanupErrors'), 'cache cleanup notices', 0, 16)) } : {}) });
}
export function desktopPhotoMimeCurrentV1(value: unknown): string { return text(value, 'desktop MIME', 256); }
