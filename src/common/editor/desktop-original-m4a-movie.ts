/* SPDX-License-Identifier: AGPL-3.0-only */

interface ByteSource {
	readonly size: number;
	slice(start: number, end: number): Readonly<{ arrayBuffer(): PromiseLike<ArrayBuffer> }>;
}

interface MovieBox { readonly type: string; readonly size: number; readonly headerSize: number; }
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);

/** Read bounded sample descriptions while skipping encoded media and unrelated movie metadata. */
export async function readDesktopOriginalM4aMovie(file: ByteSource, maximumBytes: number): Promise<Uint8Array | null> {
	const descriptions: Uint8Array[] = [];
	let remaining = maximumBytes;
	let boxes = 0;
	async function bytes(start: number, length: number): Promise<Uint8Array | null> {
		if (length > remaining) return null;
		remaining -= length;
		const result = new Uint8Array(await file.slice(start, start + length).arrayBuffer());
		return result.length === length ? result : null;
	}
	async function boxAt(offset: number, end: number): Promise<MovieBox | null> {
		if (++boxes > 1024 || end - offset < 8) return null;
		const header = await bytes(offset, Math.min(16, end - offset));
		if (!header) return null;
		const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
		const declaredSize = view.getUint32(0, false);
		const headerSize = declaredSize === 1 ? 16 : 8;
		if (header.length < headerSize) return null;
		const size = declaredSize === 1 ? Number(view.getBigUint64(8, false)) : declaredSize || end - offset;
		if (!Number.isSafeInteger(size) || size < headerSize || size > end - offset) return null;
		return { type: String.fromCharCode(...header.subarray(4, 8)), size, headerSize };
	}
	async function collect(start: number, end: number, depth: number): Promise<boolean> {
		if (depth > 8) return false;
		for (let offset = start; offset < end;) {
			const box = await boxAt(offset, end);
			if (!box) return false;
			if (box.type === 'stsd') {
				const description = await bytes(offset, box.size);
				if (!description) return false;
				descriptions.push(description);
			} else if (CONTAINERS.has(box.type)
				&& !await collect(offset + box.headerSize, offset + box.size, depth + 1)) return false;
			offset += box.size;
		}
		return true;
	}
	let offset = 0;
	while (offset < file.size) {
		const box = await boxAt(offset, file.size);
		if (!box || offset === 0 && box.type !== 'ftyp') return null;
		if (box.type === 'moov') {
			if (!await collect(offset + box.headerSize, offset + box.size, 0)) return null;
			const result = new Uint8Array(descriptions.reduce((sum, description) => sum + description.length, 0));
			let cursor = 0;
			for (const description of descriptions) { result.set(description, cursor); cursor += description.length; }
			return result;
		}
		offset += box.size;
	}
	return null;
}
