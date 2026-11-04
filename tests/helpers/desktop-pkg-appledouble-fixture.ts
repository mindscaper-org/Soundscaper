/* SPDX-License-Identifier: AGPL-3.0-only */

/** Apple's AppleDouble wrapper for detached code-signing extended attributes. */
export function pkgCodeSignatureSidecar(): Buffer {
	const name = Buffer.from('com.apple.cs.CodeDirectory\0');
	const value = Buffer.from('code signature fixture');
	const dataStart = (120 + 11 + name.length + 3) & ~3;
	const bytes = Buffer.alloc(dataStart + value.length);
	bytes.writeUInt32BE(0x00051607, 0);
	bytes.writeUInt32BE(0x00020000, 4);
	bytes.write('Mac OS X        ', 8);
	bytes.writeUInt16BE(2, 24);
	bytes.writeUInt32BE(9, 26);
	bytes.writeUInt32BE(50, 30);
	bytes.writeUInt32BE(bytes.length - 50, 34);
	bytes.writeUInt32BE(2, 38);
	bytes.writeUInt32BE(bytes.length, 42);
	bytes.write('ATTR', 84);
	bytes.writeUInt32BE(bytes.length, 92);
	bytes.writeUInt32BE(dataStart, 96);
	bytes.writeUInt32BE(value.length, 100);
	bytes.writeUInt16BE(1, 118);
	bytes.writeUInt32BE(dataStart, 120);
	bytes.writeUInt32BE(value.length, 124);
	bytes.writeUInt8(name.length, 130);
	name.copy(bytes, 131);
	value.copy(bytes, dataStart);
	return bytes;
}
