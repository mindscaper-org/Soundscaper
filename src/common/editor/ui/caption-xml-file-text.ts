/* SPDX-License-Identifier: AGPL-3.0-only */

import { decodeBomMarkedUtf16 } from '../bom-marked-text.ts';

/** XML declares its byte encoding before any non-ASCII document content. */
export function decodeCaptionXmlFile(bytes: ArrayBuffer): string {
	const marked = decodeBomMarkedUtf16(bytes);
	if (marked !== null) return marked;
	const view = new Uint8Array(bytes);
	const offset = view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf ? 3 : 0;
	let declarationEnd = offset;
	if (view[offset] === 0x3c && view[offset + 1] === 0x3f && view[offset + 2] === 0x78
		&& view[offset + 3] === 0x6d && view[offset + 4] === 0x6c) {
		declarationEnd += 5;
		while (declarationEnd < view.length && !(view[declarationEnd - 1] === 0x3f && view[declarationEnd] === 0x3e)) declarationEnd += 1;
	}
	const declaration = new TextDecoder().decode(view.subarray(offset, declarationEnd + 1));
	const encoding = declaration.match(/\bencoding[ \t\r\n]*=[ \t\r\n]*(["'])([A-Za-z][A-Za-z0-9._-]*)\1/u)?.[2] ?? 'utf-8';
	return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}
