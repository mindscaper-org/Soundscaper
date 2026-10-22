/* SPDX-License-Identifier: AGPL-3.0-only */

import { crc32, deflateSync } from 'node:zlib';

/** PNG3: red default image outside a one-frame, blue APNG animation. */
export function singleFramePosterApng(): Buffer { return posterApng(1); }
export function twoFramePosterApng(): Buffer { return posterApng(2); }

function posterApng(frameCount: number): Buffer {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header.set([8, 6], 8);
	const animation = Buffer.alloc(8); animation.writeUInt32BE(frameCount, 0);
	const control = Buffer.alloc(26);
	control.writeUInt32BE(1, 4); control.writeUInt32BE(1, 8);
	control.writeUInt16BE(1, 20); control.writeUInt16BE(2, 22);
	const secondControl = Buffer.from(control); secondControl.writeUInt32BE(2, 0);
	const secondData = Buffer.concat([Buffer.from([0, 0, 0, 3]), deflateSync(Buffer.from([0, 0, 255, 0, 255]))]);
	const data = Buffer.concat([Buffer.from([0, 0, 0, 1]), deflateSync(Buffer.from([0, 0, 0, 255, 255]))]);
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', header), chunk('acTL', animation),
		chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
		chunk('fcTL', control), chunk('fdAT', data),
		...(frameCount === 2 ? [chunk('fcTL', secondControl), chunk('fdAT', secondData)] : []),
		chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type: string, data: Buffer): Buffer {
	const content = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const result = Buffer.alloc(data.length + 12);
	result.writeUInt32BE(data.length, 0); content.copy(result, 4);
	result.writeUInt32BE(crc32(content), result.length - 4);
	return result;
}
