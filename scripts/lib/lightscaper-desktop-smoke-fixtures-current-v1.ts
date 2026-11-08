/* SPDX-License-Identifier: AGPL-3.0-only */
import {deflateSync} from 'node:zlib';
import {pngChunk} from '../../tests/helpers/image-metadata-fixtures.ts';
export function ownedRaster(): Uint8Array<ArrayBuffer> {
	return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk('IHDR', Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0])), pngChunk('sRGB', Buffer.of(0)),
		pngChunk('IDAT', deflateSync(Buffer.from([0, 32, 64, 128, 255, 64, 128, 192, 255, 0, 96, 160, 224, 255, 128, 192, 240, 255]))), pngChunk('IEND', Buffer.alloc(0))]));
}
