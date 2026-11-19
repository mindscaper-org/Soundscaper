/* SPDX-License-Identifier: AGPL-3.0-only */

import { open } from 'node:fs/promises';

/** Refuse a damaged WAL instead of letting SQLite silently ignore its unreadable frames. */
export async function validateAudacityWal(path: string): Promise<Readonly<{ pageSize: number; committedFrames: number }>> {
	const file = await open(path, 'r');
	try {
		const header = Buffer.alloc(32);
		if ((await file.read(header, 0, 32, 0)).bytesRead !== 32) throw new Error('The Audacity WAL header is incomplete.');
		const magic = header.readUInt32BE(0), pageSize = header.readUInt32BE(8), size = (await file.stat()).size;
		if (![0x377f0682, 0x377f0683].includes(magic) || header.readUInt32BE(4) !== 3007000
			|| pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) || (size - 32) % (pageSize + 24)) throw new Error('The Audacity WAL layout is invalid or incomplete.');
		let first = 0, second = 0;
		const little = magic === 0x377f0682;
		function checksum(bytes: Buffer): void {
			for (let offset = 0; offset < bytes.length; offset += 8) {
				first = (first + (little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset)) + second) >>> 0;
				second = (second + (little ? bytes.readUInt32LE(offset + 4) : bytes.readUInt32BE(offset + 4)) + first) >>> 0;
			}
		}
		checksum(header.subarray(0, 24));
		if (first !== header.readUInt32BE(24) || second !== header.readUInt32BE(28)) throw new Error('The Audacity WAL header checksum failed.');
		const frame = Buffer.alloc(pageSize + 24);
		let committedFrames = 0;
		for (let offset = 32; offset < size; offset += frame.length) {
			if ((await file.read(frame, 0, frame.length, offset)).bytesRead !== frame.length
				|| frame.readUInt32BE(0) === 0 || !frame.subarray(8, 16).equals(header.subarray(16, 24))) throw new Error('The Audacity WAL frame identity is invalid.');
			checksum(frame.subarray(0, 8)); checksum(frame.subarray(24));
			if (first !== frame.readUInt32BE(16) || second !== frame.readUInt32BE(20)) throw new Error('The Audacity WAL frame checksum failed. Keep the original and its companions together.');
			if (frame.readUInt32BE(4) > 0) committedFrames = (offset - 32) / frame.length + 1;
		}
		return { pageSize, committedFrames };
	} finally { await file.close(); }
}
