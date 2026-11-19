/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import test from 'node:test';
import { verifyLightscaperSmokePngCurrentV1 } from '../scripts/lib/lightscaper-desktop-managed-smoke-verification-current-v1.ts';
import { pngChunk } from './helpers/image-metadata-fixtures.ts';

test('external PNG verification checks CRC, exact pixels and the complete compressed output', () => {
	const pixels = Uint8Array.of(32, 64, 128, 255, 64, 128, 192, 255);
	const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk('IHDR', Buffer.from([0, 0, 0, 2, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
		pngChunk('sRGB', Buffer.from([0])), pngChunk('IDAT', deflateSync(Buffer.from([0, ...pixels]))), pngChunk('IEND', Buffer.alloc(0))]);
	assert.deepEqual(verifyLightscaperSmokePngCurrentV1(bytes, 2, 1, pixels).pixels, [...pixels]);
	const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
	assert.throws(() => verifyLightscaperSmokePngCurrentV1(corrupt, 2, 1, pixels));
	assert.throws(() => verifyLightscaperSmokePngCurrentV1(Buffer.concat([bytes, Buffer.of(0)]), 2, 1, pixels));
	assert.throws(() => verifyLightscaperSmokePngCurrentV1(bytes, 2, 1, new Uint8Array(pixels.length)));
	const trailingCompressed = Buffer.concat([bytes.subarray(0, 33),
		pngChunk('IDAT', Buffer.concat([deflateSync(Buffer.from([0, ...pixels])), Buffer.of(1, 2, 3)])), pngChunk('IEND', Buffer.alloc(0))]);
	assert.throws(() => verifyLightscaperSmokePngCurrentV1(trailingCompressed, 2, 1, pixels));
});
