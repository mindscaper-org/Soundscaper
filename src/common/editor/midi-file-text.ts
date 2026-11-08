/* SPDX-License-Identifier: AGPL-3.0-only */

const utf8 = new TextDecoder('utf-8', { fatal: true });
const legacy = new TextDecoder('windows-1252');

/** SMF text permits extended local character sets; keep legacy single bytes readable. */
export function decodeMidiFileText(bytes: Uint8Array): string {
	try { return utf8.decode(bytes); }
	catch { return legacy.decode(bytes); }
}
