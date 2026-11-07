/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';

/** Independent chunk oracle for the small RIFF/WAVE fixtures and deliveries. */
export function readRiffChunks(bytes: Uint8Array): ReadonlyMap<string, Uint8Array> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const text = (start: number, length: number): string => new TextDecoder().decode(bytes.subarray(start, start + length));
	assert.ok(bytes.byteLength >= 12, 'RIFF header is truncated');
	assert.equal(text(0, 4), 'RIFF'); assert.equal(text(8, 4), 'WAVE');
	assert.equal(view.getUint32(4, true) + 8, bytes.byteLength, 'RIFF length matches its body');
	const chunks = new Map<string, Uint8Array>();
	let offset = 12;
	while (offset < bytes.byteLength) {
		assert.ok(offset + 8 <= bytes.byteLength, 'RIFF chunk header is truncated');
		const size = view.getUint32(offset + 4, true), start = offset + 8;
		assert.ok(start + size <= bytes.byteLength, 'RIFF chunk payload is truncated');
		chunks.set(text(offset, 4), bytes.subarray(start, start + size));
		offset = start + size + size % 2;
	}
	assert.equal(offset, bytes.byteLength, 'RIFF chunk padding is present');
	return chunks;
}
