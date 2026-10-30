/* SPDX-License-Identifier: AGPL-3.0-only */

import { digestBytes, hashingStream, type DigestWriter } from '../media/bytes.ts';
import { throwIfScapeAborted } from './abort.ts';
import type { ScapeDescriptor } from './archive-envelope.ts';

export interface ScapeExtractedAsset {
	readonly digest: string;
	readonly size: number;
}

export function scapeHashingStream(
	stream: ReadableStream<Uint8Array>,
	digest: DigestWriter,
	signal?: AbortSignal,
): ReadableStream<Uint8Array> {
	return hashingStream(stream, digest, signal, throwIfScapeAborted);
}

export function verifyScapeAssetBytes(bytes: Uint8Array, descriptor: ScapeDescriptor, label: string): void {
	verifyScapeExtractedAsset(descriptor, digestBytes(bytes), bytes.byteLength, label);
}

export function verifyScapeExtractedAsset(
	descriptor: ScapeDescriptor,
	digest: string,
	size: number,
	label: string,
): void {
	if (size !== descriptor.size) throw new Error(`${label} has an unexpected size.`);
	if (digest !== descriptor.sha256) throw new Error(`${label} failed SHA-256 verification.`);
}
