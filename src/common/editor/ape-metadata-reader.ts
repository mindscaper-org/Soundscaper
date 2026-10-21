/* SPDX-License-Identifier: AGPL-3.0-only */

import { metadataBlobBytes } from './audio-metadata-values.ts';

/** Keep APEv2 trailers outside the reviewed WavPack audio-block decoder. */
export async function wavPackAudioBlob(file: Blob, signal?: AbortSignal): Promise<Blob> {
	if (file.size < 32) return file;
	const tagEnd = await apeTagEnd(file, signal);
	const footer = await metadataBlobBytes(file, tagEnd - 32, tagEnd, signal);
	const info = apeFooter(footer);
	if (!info) return tagEnd === file.size ? file : file.slice(0, tagEnd, file.type);
	const start = tagEnd - info.size - (info.header ? 32 : 0);
	if (start < 32) throw new RangeError('The APEv2 trailer exceeds its WavPack file.');
	if (info.header) {
		const header = await metadataBlobBytes(file, start, start + 32, signal);
		const declared = apeFooter(header);
		const view = new DataView(header.buffer);
		if (!declared || declared.size !== info.size || view.getUint32(16, true) !== new DataView(footer.buffer).getUint32(16, true)
			|| !(view.getUint32(20, true) & 0x2000_0000)) throw new RangeError('The APEv2 header is missing or inconsistent.');
	}
	return file.slice(0, start, file.type);
}

/** Inspect APE text and cover art without asking a codec to decode the trailer. */
export async function readApeMetadataTags(file: Blob, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>> {
	if (file.size < 32) return {};
	const tagEnd = await apeTagEnd(file, signal);
	const footer = await metadataBlobBytes(file, tagEnd - 32, tagEnd, signal);
	const info = apeFooter(footer);
	if (!info) return {};
	await wavPackAudioBlob(file, signal);
	const bytes = await metadataBlobBytes(file, tagEnd - info.size, tagEnd - 32, signal);
	const view = new DataView(bytes.buffer);
	const count = new DataView(footer.buffer).getUint32(16, true);
	const entries: [string, string | Uint8Array][] = [];
	const images: Record<string, unknown>[] = [];
	let offset = 0;
	for (let index = 0; index < count; index++) {
		if (offset + 8 > bytes.length) throw new RangeError('The APE item header is truncated.');
		const length = view.getUint32(offset, true);
		const flags = view.getUint32(offset + 4, true);
		offset += 8;
		const separator = bytes.indexOf(0, offset);
		if (separator < offset + 2 || separator - offset > 255) throw new RangeError('The APE item key is invalid.');
		const key = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, separator));
		offset = separator + 1;
		if (offset + length > bytes.length || flags & ~7) throw new RangeError('The APE item is truncated or invalid.');
		const value = bytes.subarray(offset, offset + length);
		offset += length;
		if ((flags & 6) === 0) entries.push([key, new TextDecoder('utf-8', { fatal: true }).decode(value)]);
		else {
			entries.push([key, value]);
			if (key.toLowerCase().startsWith('cover art (')) {
				const end = value.indexOf(0);
				if (end >= 0 && end + 1 < value.length) {
					const data = value.subarray(end + 1);
					images.push({ data, description: new TextDecoder().decode(value.subarray(0, end)), mimeType: data[0] === 137 ? 'image/png' : 'image/jpeg',
						kind: /\(front\)/iu.test(key) ? 'coverFront' : /\(back\)/iu.test(key) ? 'coverBack' : 'unknown' });
				}
			}
		}
	}
	if (offset !== bytes.length) throw new RangeError('The APE tag contains trailing item bytes.');
	const raw = Object.fromEntries(entries);
	const tags: Record<string, unknown> = { raw, ...(images.length ? { images } : {}) };
	const names: Readonly<Record<string, string>> = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', ALBUMARTIST: 'albumArtist', GENRE: 'genre',
		TRACK: 'trackNumber', DISC: 'discNumber', YEAR: 'date', TOTALTRACKS: 'tracksTotal', TOTALDISCS: 'discsTotal',
		COMMENT: 'comment', DATE: 'date', LYRICS: 'lyrics', TRACKNUMBER: 'trackNumber', TRACKTOTAL: 'tracksTotal', DISCNUMBER: 'discNumber', DISCTOTAL: 'discsTotal' };
	const explicitDate = entries.some(([key, value]) => key.toUpperCase().replace(/[ _-]/gu, '') === 'DATE' && typeof value === 'string' && value !== '');
	for (const [key, value] of entries) {
		const normalizedKey = key.toUpperCase().replace(/[ _-]/gu, '');
		if (normalizedKey === 'YEAR' && explicitDate) continue;
		const name = names[normalizedKey];
		if (!name || typeof value !== 'string') continue;
		if (['trackNumber', 'tracksTotal', 'discNumber', 'discsTotal'].includes(name)) {
			const pair = /^(\d+)\/(\d+)$/u.exec(value);
			const number = Number(pair ? pair[1] : value);
			if (Number.isSafeInteger(number) && number >= 0) tags[name] = number;
			if (pair && (name === 'trackNumber' || name === 'discNumber')) {
				const total = Number(pair[2]);
				const totalName = name === 'trackNumber' ? 'tracksTotal' : 'discsTotal';
				if (Number.isSafeInteger(total) && tags[totalName] === undefined) tags[totalName] = total;
			}
		} else tags[name] = value;
	}
	return tags;
}

function apeFooter(bytes: Uint8Array): Readonly<{ size: number; header: boolean }> | null {
	if (new TextDecoder().decode(bytes.subarray(0, 8)) !== 'APETAGEX') return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const size = view.getUint32(12, true);
	if (bytes.length !== 32 || view.getUint32(8, true) !== 2000 || size < 32 || size > 16 * 1024 ** 2 || view.getUint32(16, true) > 256) throw new RangeError('Invalid APEv2 trailer.');
	return { size, header: Boolean(view.getUint32(20, true) & 0x8000_0000) };
}

/** ID3v1 may follow APEv2 for compatibility with older tagging programs. */
async function apeTagEnd(file: Blob, signal?: AbortSignal): Promise<number> {
	if (file.size >= 160) {
		const marker = await metadataBlobBytes(file, file.size - 128, file.size - 125, signal);
		if (new TextDecoder().decode(marker) === 'TAG') return file.size - 128;
	}
	return file.size;
}
