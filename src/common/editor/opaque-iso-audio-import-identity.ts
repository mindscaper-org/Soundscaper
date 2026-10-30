/* SPDX-License-Identifier: AGPL-3.0-only */
import { raceAbortableRead } from '../foundation/abort-race.ts';

const MAXIMUM_MOVIE_BYTES = 1024 ** 2;
const MAXIMUM_BOXES = 1024;
interface Box { readonly type: string; readonly size: number; readonly headerSize: number }

/** Identify only a bounded, complete, ordinary audio-only AAC movie. Decode remains the named AAC route's job. */
export async function hasOpaqueIsoAacIdentity(file: Blob, signal?: AbortSignal): Promise<boolean> {
	signal?.throwIfAborted();
	let boxes = 0;
	const read = async (offset: number, count: number): Promise<Uint8Array<ArrayBuffer>> => {
		const bytes = await raceAbortableRead(() => file.slice(offset, offset + count).arrayBuffer(), signal);
		signal?.throwIfAborted(); return new Uint8Array(bytes);
	};
	const boxAt = async (offset: number, end: number): Promise<Box | null> => {
		if (++boxes > MAXIMUM_BOXES || end - offset < 8) return null;
		const header = await read(offset, 8); if (header.length !== 8) return null;
		const view = new DataView(header.buffer), declared = view.getUint32(0), headerSize = declared === 1 ? 16 : 8;
		let size = declared || end - offset;
		if (declared === 1) {
			if (end - offset < 16) return null;
			const extended = await read(offset + 8, 8); if (extended.length !== 8) return null;
			size = Number(new DataView(extended.buffer).getBigUint64(0));
		}
		if (!Number.isSafeInteger(size) || size < headerSize || size > end - offset) return null;
		return { type: String.fromCharCode(...header.subarray(4, 8)), size, headerSize };
	};
	try {
		let movie = false, media = false, type = false;
		for (let offset = 0; offset < file.size;) {
			const box = await boxAt(offset, file.size);
			if (!box || offset === 0 && box.type !== 'ftyp' || box.type === 'moof') return false;
			if (box.type === 'ftyp') {
				if (type || box.size < box.headerSize + 8 || box.size > 1024) return false;
				type = true;
			} else if (box.type === 'mdat') {
				if (media || box.size === box.headerSize) return false;
				media = true;
			} else if (box.type === 'moov') {
				if (movie || box.size > MAXIMUM_MOVIE_BYTES) return false;
				movie = true;
				let tracks = 0;
				for (let childOffset = offset + box.headerSize; childOffset < offset + box.size;) {
					const child = await boxAt(childOffset, offset + box.size);
					if (!child || child.type === 'mvex' || child.type === 'trak' && ++tracks > 1) return false;
					childOffset += child.size;
				}
				if (tracks !== 1) return false;
			}
			offset += box.size;
			if (boxes % 64 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
		}
		if (!type || !movie || !media) return false;
		const { BlobSource, Input, MP4 } = await raceAbortableRead(() => import('mediabunny'), signal); signal?.throwIfAborted();
		const input = new Input({ source: new BlobSource(file, { maxCacheSize: MAXIMUM_MOVIE_BYTES, useStreamReader: false }), formats: [MP4] });
		const onAbort = (): void => input.dispose(); signal?.addEventListener('abort', onAbort, { once: true });
		try {
			const tracks = await raceAbortableRead(() => input.getTracks(), signal); signal?.throwIfAborted();
			const track = tracks[0];
			if (tracks.length !== 1 || !track?.isAudioTrack()) return false;
			const codec = await raceAbortableRead(() => track.getCodec(), signal); signal?.throwIfAborted();
			return codec === 'aac';
		} finally { signal?.removeEventListener('abort', onAbort); input.dispose(); }
	} catch { signal?.throwIfAborted(); return false; }
}
