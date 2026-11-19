/* SPDX-License-Identifier: AGPL-3.0-only */

export interface IsoBox { readonly type: string; readonly offset: number; readonly start: number; readonly end: number }
const MAXIMUM_HEADERS = 8192;

export function createIsoBoxReader(file: Blob, signal?: AbortSignal) {
	let headers = 0;
	const read = async (start: number, length: number, end: number): Promise<DataView<ArrayBuffer>> => {
		signal?.throwIfAborted();
		if (start < 0 || length < 1 || length > 32 || start + length > end || end > file.size) invalid();
		const bytes = await file.slice(start, start + length).arrayBuffer();
		signal?.throwIfAborted();
		if (bytes.byteLength !== length) invalid();
		return new DataView(bytes);
	};
	const boxes = async (start: number, end: number): Promise<readonly IsoBox[]> => {
		const result: IsoBox[] = [];
		for (let offset = start; offset < end;) {
			if (++headers > MAXIMUM_HEADERS) invalid();
			const view = await read(offset, 8, end);
			const type = String.fromCharCode(...Array.from({ length: 4 }, (_, index) => view.getUint8(index + 4)));
			let size = view.getUint32(0), width = 8;
			if (size === 1) { size = safeInteger((await read(offset + 8, 8, end)).getBigUint64(0)); width = 16; }
			else if (size === 0) size = end - offset;
			if (!Number.isSafeInteger(size) || size < width || offset + size > end) invalid();
			result.push({ type, offset, start: offset + width, end: offset + size });
			offset += size;
		}
		return result;
	};
	const trackId = async (header: IsoBox): Promise<number> => {
		const version = (await read(header.start, 1, header.end)).getUint8(0);
		if (version > 1) invalid();
		return (await read(header.start + (version === 1 ? 20 : 12), 4, header.end)).getUint32(0);
	};
	const trackSampleTable = async (track: IsoBox): Promise<readonly IsoBox[]> => {
		let table = track;
		for (const type of ['mdia', 'minf', 'stbl']) {
			const part = (await boxes(table.start, table.end)).find(box => box.type === type);
			if (!part) return [];
			table = part;
		}
		return boxes(table.start, table.end);
	};
	const fragmentSampleView = async (sizes: IsoBox): Promise<Readonly<{ initialCount: number; tail: Blob | null }>> => {
		const offset = sizes.start + 8;
		const initialCount = (await read(offset, 4, sizes.end)).getUint32(0);
		// A nonempty static table masks fragments in the packet demuxer. Expose
		// its fragment iterator through a view of the same byte positions.
		const tail = initialCount ? new Blob([
			file.slice(0, offset), new Uint8Array(4), file.slice(offset + 4),
		], { type: file.type }) : null;
		return { initialCount, tail };
	};
	const singleVisualSampleEntry = async (description: IsoBox, type: 'avc1' | 'av01'): Promise<number | null> => {
		const stsd = await read(description.start, 16, description.end);
		const extensionStart = description.start + 16 + 78;
		const tag = type === 'avc1' ? 0x61766331 : 0x61763031;
		return stsd.getUint32(4) === 1 && stsd.getUint32(12) === tag
			&& stsd.getUint32(8) === description.end - description.start - 8 && extensionStart <= description.end
			? extensionStart : null;
	};
	return { read, boxes, trackId, trackSampleTable, fragmentSampleView, singleVisualSampleEntry };
}

function safeInteger(value: bigint): number {
	const result = Number(value);
	if (!Number.isSafeInteger(result)) invalid();
	return result;
}

function invalid(): never { throw new RangeError('The ISO media box geometry is invalid or exceeds its bounded inspection limit.'); }
