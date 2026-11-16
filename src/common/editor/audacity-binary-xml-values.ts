/* SPDX-License-Identifier: AGPL-3.0-only */

export class AudacityBinaryXmlError extends Error {
	readonly code: string;
	constructor(message: string, code = 'INVALID_BINARY_XML', options?: ErrorOptions) {
		super(message, options);
		this.name = 'AudacityBinaryXmlError';
		this.code = code;
	}
}

export function encodeString(value: unknown, charSize: number): Uint8Array<ArrayBuffer> {
	if (charSize === 1) return new TextEncoder().encode(String(value));
	const codePoints = [...String(value)].map((character) => character.codePointAt(0)!);
	const units = charSize === 2
		? Array.from(String(value), (character) => character.codePointAt(0)!).flatMap((point) => point <= 0xffff
			? [point]
			: [0xd800 + ((point - 0x10000) >>> 10), 0xdc00 + ((point - 0x10000) & 0x3ff)])
		: codePoints;
	const bytes = new Uint8Array(units.length * charSize);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < units.length; index += 1) {
		if (charSize === 2) view.setUint16(index * 2, units[index]!, true);
		else view.setUint32(index * 4, units[index]!, true);
	}
	return bytes;
}

export function decodeString(bytes: Uint8Array, charSize: number): string {
	if (bytes.byteLength % charSize !== 0) throw new AudacityBinaryXmlError('Audacity string length is not aligned to its character width.', 'INVALID_STRING');
	try {
		if (charSize === 1) return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		if (charSize === 2) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
	} catch (error) {
		throw new AudacityBinaryXmlError('Audacity binary XML contains invalid Unicode.', 'INVALID_STRING', { cause: error });
	}
	let value = '';
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = 0; offset < bytes.byteLength; offset += 4) {
		const point = view.getUint32(offset, true);
		if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) throw new AudacityBinaryXmlError('Audacity UTF-32 data contains an invalid code point.', 'INVALID_STRING');
		value += String.fromCodePoint(point);
	}
	return value;
}
