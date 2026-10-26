/* SPDX-License-Identifier: AGPL-3.0-only */

import { metadataBlobBytes } from './audio-metadata-values.ts';

/** Keep APEv2 trailers outside the reviewed WavPack audio-block decoder. */
export async function wavPackAudioBlob(file: Blob, signal?: AbortSignal): Promise<Blob> {
	if (file.size < 32) return file;
	const tagEnd = await apeTagEnd(file, signal);
	const footer = await metadataBlobBytes(file, tagEnd - 32, tagEnd, signal);
	const info = apeFooter(footer, false);
	if (!info) return file.slice(0, await wavPackZeroPaddingStart(file, tagEnd, signal), file.type);
	const start = tagEnd - info.size - (info.header ? 32 : 0);
	if (start < 32) throw new RangeError('The APEv2 trailer exceeds its WavPack file.');
	if (info.header) {
		const header = await metadataBlobBytes(file, start, start + 32, signal);
		const declared = apeFooter(header, false);
		const view = new DataView(header.buffer);
		if (!declared || declared.size !== info.size || view.getUint32(16, true) !== new DataView(footer.buffer).getUint32(16, true)
			|| !(view.getUint32(20, true) & 0x2000_0000)) throw new RangeError('The APEv2 header is missing or inconsistent.');
	}
	return file.slice(0, await wavPackZeroPaddingStart(file, start, signal), file.type);
}

/** Inspect APE text and cover art without asking a codec to decode the trailer. */
export async function readApeMetadataTags(file: Blob, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>> {
	if (file.size < 32) return {};
	const tagEnd = await apeTagEnd(file, signal);
	const footer = await metadataBlobBytes(file, tagEnd - 32, tagEnd, signal);
	const info = apeFooter(footer);
	if (!info) return tagEnd < file.size ? readLegacyId3Tags(await metadataBlobBytes(file, tagEnd, file.size, signal)) : {};
	await wavPackAudioBlob(file, signal);
	const bytes = await metadataBlobBytes(file, tagEnd - info.size, tagEnd - 32, signal);
	const view = new DataView(bytes.buffer);
	const count = new DataView(footer.buffer).getUint32(16, true);
	const entries: [string, string | Uint8Array][] = [];
	const externalKeys = new Set<string>();
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
		else if ((flags & 6) === 4) {
			entries.push([key, new TextDecoder('utf-8', { fatal: true }).decode(value)]);
			externalKeys.add(key);
		} else {
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
	const explicitDate = entries.some(([key, value]) => !externalKeys.has(key) && key.toUpperCase().replace(/[ _-]/gu, '') === 'DATE' && typeof value === 'string' && value !== '');
	for (const [key, encoded] of entries) {
		if (externalKeys.has(key)) continue;
		const normalizedKey = key.toUpperCase().replace(/[ _-]/gu, '');
		if (normalizedKey === 'YEAR' && explicitDate) continue;
		const name = names[normalizedKey];
		if (!name || typeof encoded !== 'string') continue;
		const values = encoded.split('\0');
		const value = name === 'date' || ['trackNumber', 'tracksTotal', 'discNumber', 'discsTotal'].includes(name)
			? values[0]! : values.join('; ');
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

/** Older native tag writers zero the released tag extent instead of truncating it. */
async function wavPackZeroPaddingStart(file: Blob, end: number, signal?: AbortSignal): Promise<number> {
	let offset = 0; let complete = false;
	for (let blocks = 0; offset < end && blocks < 1_000_000; blocks++) {
		const header = await metadataBlobBytes(file, offset, Math.min(offset + 32, end), signal);
		if (header.length === 32 && new TextDecoder().decode(header.subarray(0, 4)) === 'wvpk') {
			const view = new DataView(header.buffer); const size = view.getUint32(4, true) + 8;
			if (size < 32 || size > end - offset) return end;
			if (view.getUint32(20, true) > 0) complete = Boolean(view.getUint32(24, true) & 0x1000);
			offset += size; continue;
		}
		if (!complete || end - offset > 16 * 1024 ** 2 || header.some(byte => byte !== 0)) return end;
		for (let position = offset + header.length; position < end; position += 65_536) {
			const bytes = await metadataBlobBytes(file, position, Math.min(position + 65_536, end), signal);
			if (bytes.some(byte => byte !== 0)) return end;
		}
		return offset;
	}
	return end;
}

function apeFooter(bytes: Uint8Array, inspectItems = true): Readonly<{ size: number; header: boolean }> | null {
	if (new TextDecoder().decode(bytes.subarray(0, 8)) !== 'APETAGEX') return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const size = view.getUint32(12, true);
	if (bytes.length !== 32 || view.getUint32(8, true) !== 2000 || size < 32) throw new RangeError('Invalid APEv2 trailer.');
	if (inspectItems && (size > 16 * 1024 ** 2 || view.getUint32(16, true) > 256)) throw new RangeError('APEv2 metadata exceeds its bounded inspection limit.');
	return { size, header: Boolean(view.getUint32(20, true) & 0x8000_0000) };
}

/** ID3v1 may follow APEv2 for compatibility with older tagging programs. */
async function apeTagEnd(file: Blob, signal?: AbortSignal): Promise<number> {
	if (file.size >= 160) {
		const marker = await metadataBlobBytes(file, file.size - 128, file.size - 125, signal);
		if (new TextDecoder().decode(marker) === 'TAG' && await isExternalWavPackTrailer(file, file.size - 128, signal)) return file.size - 128;
	}
	return file.size;
}

/** Wrapper bytes inside a WavPack block may contain any tag-looking prefix. */
async function isExternalWavPackTrailer(file: Blob, position: number, signal?: AbortSignal): Promise<boolean> {
	let offset = 0;
	while (offset < position) {
		const header = await metadataBlobBytes(file, offset, offset + 32, signal);
		if (new TextDecoder().decode(header.subarray(0, 4)) !== 'wvpk') return true;
		const size = new DataView(header.buffer).getUint32(4, true) + 8;
		if (size < 32 || size > file.size - offset) return true;
		offset += size;
		if (offset > position) return false;
	}
	return true;
}

/** ID3v1 is an admitted WavPack trailer even when no APEv2 tag accompanies it. */
function readLegacyId3Tags(bytes: Uint8Array): Readonly<Record<string, unknown>> {
	const tags: Record<string, unknown> = { raw: { TAG: bytes.slice(3) } };
	const decoder = new TextDecoder('windows-1252');
	const text = (start: number, length: number): string => {
		const value = bytes.subarray(start, start + length);
		const end = value.indexOf(0);
		return decoder.decode(end < 0 ? value : value.subarray(0, end)).trimEnd();
	};
	const track = bytes[125] === 0 && bytes[126] !== 0 ? bytes[126] : undefined;
	for (const [key, start, length] of [['title', 3, 30], ['artist', 33, 30], ['album', 63, 30],
		['date', 93, 4], ['comment', 97, track === undefined ? 30 : 28]] as const) {
		const value = text(start, length);
		if (value) tags[key] = value;
	}
	if (track !== undefined) tags.trackNumber = track;
	const genre = ID3V1_GENRES[bytes[127]!];
	if (genre !== undefined) tags.genre = genre;
	return tags;
}

// The fixed ID3v1 genre index and its conventional Winamp extensions.
const ID3V1_GENRES = [
	'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal',
	'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial',
	'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk',
	'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise',
	'AlternRock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic',
	'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta',
	'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave', 'Psychedelic', 'Rave', 'Showtunes',
	'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', "Rock 'n' Roll", 'Hard Rock',
	'Folk', 'Folk-Rock', 'National Folk', 'Swing', 'Fast Fusion', 'Bebop', 'Latin', 'Revival', 'Celtic', 'Bluegrass',
	'Avantgarde', 'Gothic Rock', 'Progressive Rock', 'Psychedelic Rock', 'Symphonic Rock', 'Slow Rock', 'Big Band', 'Chorus', 'Easy Listening', 'Acoustic',
	'Humour', 'Speech', 'Chanson', 'Opera', 'Chamber Music', 'Sonata', 'Symphony', 'Booty Bass', 'Primus', 'Porn Groove',
	'Satire', 'Slow Jam', 'Club', 'Tango', 'Samba', 'Folklore', 'Ballad', 'Power Ballad', 'Rhythmic Soul', 'Freestyle',
	'Duet', 'Punk Rock', 'Drum Solo', 'A Cappella', 'Euro-House', 'Dance Hall', 'Goa', 'Drum & Bass', 'Club-House', 'Hardcore',
	'Terror', 'Indie', 'Britpop', 'Negerpunk', 'Polsk Punk', 'Beat', 'Christian Gangsta Rap', 'Heavy Metal', 'Black Metal', 'Crossover',
	'Contemporary Christian', 'Christian Rock', 'Merengue', 'Salsa', 'Thrash Metal', 'Anime', 'JPop', 'Synthpop', 'Christmas', 'Art Rock',
	'Baroque', 'Bhangra', 'Big Beat', 'Breakbeat', 'Chillout', 'Downtempo', 'Dub', 'EBM', 'Eclectic', 'Electro',
	'Electroclash', 'Emo', 'Experimental', 'Garage', 'Global', 'IDM', 'Illbient', 'Industro-Goth', 'Jam Band', 'Krautrock',
	'Leftfield', 'Lounge', 'Math Rock', 'New Romantic', 'Nu-Breakz', 'Post-Punk', 'Post-Rock', 'Psytrance', 'Shoegaze', 'Space Rock',
	'Trop Rock', 'World Music', 'Neoclassical', 'Audiobook', 'Audio Theatre', 'Neue Deutsche Welle', 'Podcast', 'Indie Rock', 'G-Funk', 'Dubstep',
	'Garage Rock', 'Psybient',
] as const;
