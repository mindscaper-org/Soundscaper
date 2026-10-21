/* SPDX-License-Identifier: AGPL-3.0-only */

/** Decode explicitly marked UTF-16 before legacy ANSI fallback sees its BOM. */
export function decodeBomMarkedUtf16(input: Uint8Array | ArrayBuffer): string | null {
	const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
	const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
		: bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : null;
	return encoding === null ? null : new TextDecoder(encoding, { fatal: true }).decode(bytes);
}
