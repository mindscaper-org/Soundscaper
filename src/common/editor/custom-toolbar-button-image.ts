/* SPDX-License-Identifier: AGPL-3.0-only */

/** Small embedded symbols travel with user preferences, without file-path dependencies. */
export const MAX_CUSTOM_TOOLBAR_IMAGE_BYTES = 256 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const DATA_PREFIX = /^data:image\/(png|svg\+xml);base64,/u;

export function createCustomToolbarButtonImage(bytes: Uint8Array): string {
	if (bytes.length === 0 || bytes.length > MAX_CUSTOM_TOOLBAR_IMAGE_BYTES) throw new RangeError('Invalid symbol size.');
	let mime: string;
	if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) mime = 'image/png';
	else {
		const svg = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
			.replace(/^\uFEFF/u, '').replace(/^\s*(?:<\?xml[^]*?\?>\s*)?(?:<!--[^]*?-->\s*)*/u, '');
		if (!/^<svg(?:\s|\/?>)/u.test(svg)) throw new RangeError('Unsupported symbol format.');
		mime = 'image/svg+xml';
	}
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return `data:${mime};base64,${btoa(binary)}`;
}

export function isCustomToolbarButtonImage(icon: string): boolean {
	const prefix = DATA_PREFIX.exec(icon)?.[0];
	if (!prefix || icon.length > prefix.length + 4 * Math.ceil(MAX_CUSTOM_TOOLBAR_IMAGE_BYTES / 3)) return false;
	const payload = icon.slice(prefix.length);
	if (payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(payload)) return false;
	try {
		const bytes = Uint8Array.from(atob(payload), (character) => character.charCodeAt(0));
		return createCustomToolbarButtonImage(bytes) === icon;
	} catch {
		return false;
	}
}
