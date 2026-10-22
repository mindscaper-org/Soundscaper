/* SPDX-License-Identifier: AGPL-3.0-only */

/** Audacity's native cloud wire format, reviewed against fd6aaecb54d7c8d625897b45fadecd20495cfb09. */
export function nativeCloudMetadata(dictionary: Uint8Array, document: Uint8Array): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(8 + dictionary.length + document.length);
	new DataView(bytes.buffer).setBigUint64(0, BigInt(dictionary.length), true);
	bytes.set(dictionary, 8); bytes.set(document, 8 + dictionary.length);
	return bytes;
}

export async function nativeCloudHash(id: number, pcm: Uint8Array<ArrayBuffer>): Promise<string> {
	if (!Number.isSafeInteger(id) || id < 1 || id > 0xffffffff || !pcm.length || pcm.length % 4) throw new Error('Invalid cloud sample block.');
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', pcm));
	return id.toString(16).padStart(8, '0').toUpperCase()
		+ [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(8).toUpperCase();
}

/** APEv2 text tags let Audacity restore the sample format and SQLite block id. */
export function tagNativeCloudBlock(wavpack: Uint8Array, id: number, hash: string): Uint8Array<ArrayBuffer> {
	const encoder = new TextEncoder();
	const items = Object.entries({ FORMAT: '262159', BLOCK_ID: String(id), HASH: hash }).map(([key, value]) => {
		const name = encoder.encode(`${key}\0`), text = encoder.encode(value);
		const item = new Uint8Array(8 + name.length + text.length);
		new DataView(item.buffer).setUint32(0, text.length, true); item.set(name, 8); item.set(text, 8 + name.length);
		return item;
	});
	const size = items.reduce((sum, item) => sum + item.length, 32);
	const bytes = new Uint8Array(wavpack.length + size); bytes.set(wavpack);
	let offset = wavpack.length;
	for (const item of items) { bytes.set(item, offset); offset += item.length; }
	bytes.set(encoder.encode('APETAGEX'), offset);
	const footer = new DataView(bytes.buffer, offset, 32);
	footer.setUint32(8, 2000, true); footer.setUint32(12, size, true); footer.setUint32(16, items.length, true);
	return bytes;
}
