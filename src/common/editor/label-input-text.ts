/* SPDX-License-Identifier: AGPL-3.0-only */

import { decodeBomMarkedUtf16 } from './bom-marked-text.ts';

/** SubRip has common legacy ANSI writers; WebVTT and Audacity TXT stay UTF-8. */
export function decodeLabelInputText(bytes: Uint8Array | ArrayBuffer, legacySubRip: boolean): string {
	if (legacySubRip) {
		const marked = decodeBomMarkedUtf16(bytes);
		if (marked !== null) return marked;
	}
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch (error) {
		if (!legacySubRip) throw error;
		return new TextDecoder('windows-1252').decode(bytes);
	}
}
