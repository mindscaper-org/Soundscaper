/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';

export interface DigestWriter {
	update(bytes: Uint8Array): unknown;
	digest(): Uint8Array;
}

/** Snapshot bytes before exposing a stream, so a caller cannot mutate its body. */
export function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return new Blob([copy.buffer]).stream();
}

/** Hash the exact stream while preserving a consumer's cancellation boundary. */
export function hashingStream(
	stream: ReadableStream<Uint8Array>,
	digest: DigestWriter,
	signal?: AbortSignal,
	assertSignal: (signal?: AbortSignal) => void = current => current?.throwIfAborted(),
): ReadableStream<Uint8Array> {
	return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			assertSignal(signal);
			const bytes = byteChunk(chunk);
			digest.update(bytes);
			controller.enqueue(bytes);
		},
	}), signal ? { signal } : undefined);
}

export function digestBytes(bytes: Uint8Array): string {
	return hex(sha256(bytes));
}

export function createDigest(): DigestWriter {
	return sha256.create();
}

export function hex(bytes: Uint8Array): string {
	return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

function byteChunk(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	throw new TypeError('A media asset emitted a non-byte chunk.');
}
