/* SPDX-License-Identifier: AGPL-3.0-only */

/** Common modern AIFF writers emit UTF-8; retain legacy single-byte text too. */
export function decodeAiffMetadataText(bytes: Uint8Array, trim = true): string {
	let text: string;
	try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
	catch { text = new TextDecoder('iso-8859-1').decode(bytes); }
	const decoded = text.replace(/\0+$/u, '');
	return trim ? decoded.trim() : decoded;
}
