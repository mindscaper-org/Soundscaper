/* SPDX-License-Identifier: AGPL-3.0-only */

interface Box { readonly type: string; readonly start: number; readonly end: number }
const MAXIMUM_HEADERS = 8192;
const MAXIMUM_EDITS = 1024;

/** A contiguous presentation edit bounds the imported programme, not its retained media. */
export async function readIsoAudioPresentationEnd(file: Blob, trackId: number, signal?: AbortSignal): Promise<number | null> {
	let headers = 0;
	const read = async (start: number, length: number, end: number): Promise<DataView<ArrayBuffer>> => {
		signal?.throwIfAborted();
		if (start < 0 || length < 1 || length > 32 || start + length > end || end > file.size) invalid();
		const bytes = await file.slice(start, start + length).arrayBuffer();
		signal?.throwIfAborted();
		if (bytes.byteLength !== length) invalid();
		return new DataView(bytes);
	};
	const boxes = async (start: number, end: number): Promise<readonly Box[]> => {
		const result: Box[] = [];
		for (let offset = start; offset < end;) {
			if (++headers > MAXIMUM_HEADERS) invalid();
			const view = await read(offset, 8, end);
			const type = String.fromCharCode(...Array.from({ length: 4 }, (_, index) => view.getUint8(index + 4)));
			let size = view.getUint32(0), width = 8;
			if (size === 1) { size = safeInteger((await read(offset + 8, 8, end)).getBigUint64(0)); width = 16; }
			else if (size === 0) size = end - offset;
			if (!Number.isSafeInteger(size) || size < width || offset + size > end) invalid();
			result.push({ type, start: offset + width, end: offset + size });
			offset += size;
		}
		return result;
	};
	const movie = (await boxes(0, file.size)).find(box => box.type === 'moov');
	if (!movie) return null;
	const children = await boxes(movie.start, movie.end);
	let selected: Box | undefined;
	for (const track of children.filter(box => box.type === 'trak')) {
		const fields = await boxes(track.start, track.end);
		const header = fields.find(box => box.type === 'tkhd');
		if (!header) continue;
		const version = (await read(header.start, 1, header.end)).getUint8(0);
		if (version > 1) invalid();
		const id = (await read(header.start + (version === 1 ? 20 : 12), 4, header.end)).getUint32(0);
		if (id !== trackId) continue;
		const edits = fields.find(box => box.type === 'edts');
		if (edits) selected = (await boxes(edits.start, edits.end)).find(box => box.type === 'elst');
		break;
	}
	if (!selected) return null;
	const movieHeader = children.find(box => box.type === 'mvhd');
	if (!movieHeader) invalid();
	const movieVersion = (await read(movieHeader.start, 1, movieHeader.end)).getUint8(0);
	if (movieVersion > 1) invalid();
	const timescale = (await read(movieHeader.start + (movieVersion === 1 ? 20 : 12), 4, movieHeader.end)).getUint32(0);
	if (timescale === 0) invalid();
	const header = await read(selected.start, 8, selected.end);
	const version = header.getUint8(0), count = header.getUint32(4);
	if (version > 1 || count > MAXIMUM_EDITS) invalid();
	const width = version === 1 ? 20 : 12;
	let duration = 0, body = false;
	for (let index = 0; index < count; index++) {
		const entry = await read(selected.start + 8 + index * width, width, selected.end);
		const length = version === 1 ? safeInteger(entry.getBigUint64(0)) : entry.getUint32(0);
		if (length === 0) continue;
		const mediaTime = version === 1 ? safeInteger(entry.getBigInt64(8)) : entry.getInt32(4);
		if (body || mediaTime < -1 || entry.getInt32(width - 4) !== 65536) unsupported();
		duration += length;
		if (!Number.isSafeInteger(duration)) invalid();
		if (mediaTime !== -1) body = true;
	}
	if (!body && duration > 0) throw new RangeError('This MP4 audio edit list contains no presented audio. Flatten or render its programme before importing.');
	if (!body) return null;
	return duration / timescale;
}

function safeInteger(value: bigint): number {
	const result = Number(value);
	if (!Number.isSafeInteger(result)) invalid();
	return result;
}
function invalid(): never { throw new RangeError('The MP4 audio presentation edit geometry is invalid or exceeds its bounded inspection limit.'); }
function unsupported(): never { throw new RangeError('This MP4 audio edit list requires multiple segments or a playback-rate edit. Flatten or render its audio before importing to preserve the programme.'); }
