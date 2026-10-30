/* SPDX-License-Identifier: AGPL-3.0-only */
import { raceAbortableRead } from '../foundation/abort-race.ts';
import { oggPageCrc } from './ogg-page-crc.ts';

export interface VorbisPacketGeometry { readonly duration: number; readonly byteLength: number }

/** Vorbis I A.2 allows a broadcast recording to retain an absolute positive clock. */
export async function inspectVorbisAbsoluteOrigin(file: Blob, serial: number, sampleRate: number,
	packets: AsyncIterable<VorbisPacketGeometry>, signal?: AbortSignal): Promise<number> {
	let offset = 0, metadataPackets = 3, decodedFrames = 0, audioPackets = 0;
	const iterator = packets[Symbol.asyncIterator]();
	const read = async (start: number, length: number): Promise<Uint8Array<ArrayBuffer>> => {
		signal?.throwIfAborted();
		if (start < 0 || length < 0 || length > file.size - start) throw new RangeError('The initial Vorbis page is truncated.');
		const bytes = new Uint8Array(await raceAbortableRead(() => file.slice(start, start + length).arrayBuffer(), signal));
		signal?.throwIfAborted();
		if (bytes.length !== length) throw new RangeError('The initial Vorbis page is truncated.');
		return bytes;
	};
	try {
		for (let pageIndex = 0; offset < file.size && pageIndex < 4096; pageIndex++) {
			const header = await read(offset, 27), view = new DataView(header.buffer);
			if (String.fromCharCode(...header.subarray(0, 4)) !== 'OggS' || header[4] !== 0 || header[5]! & ~7) {
				throw new RangeError('Invalid Ogg page while inspecting the Vorbis clock.');
			}
			const laces = await read(offset + 27, header[26]!);
			const size = 27 + laces.length + laces.reduce((sum, length) => sum + length, 0);
			if (size > file.size - offset) throw new RangeError('The initial Vorbis page is truncated.');
			if (view.getUint32(14, true) === serial) {
				const endings = laces.filter(length => length < 255).length;
				if (metadataPackets) {
					if (endings > metadataPackets) throw new RangeError('Vorbis headers must end before the audio page.');
					metadataPackets -= endings;
				} else if (endings) {
					const page = await read(offset, size);
					if (view.getUint32(22, true) !== oggPageCrc(page)) throw new Error('The Ogg source page checksum failed.');
					for (let index = 0; index < endings; index++) {
						const next = await raceAbortableRead(() => iterator.next(), signal); signal?.throwIfAborted();
						if (next.done || ++audioPackets > 4096) throw new RangeError('The initial Vorbis packet inventory is incomplete.');
						const frames = Math.round(next.value.duration * sampleRate);
						if (!Number.isFinite(next.value.duration) || frames < 0 || frames > 8192
							|| audioPackets > 1 && frames === 0 || next.value.byteLength < 1 || next.value.byteLength > 1024 ** 2
							|| Math.abs(next.value.duration * sampleRate - frames) > 1e-5) throw new RangeError('The initial Vorbis packet duration is unsupported.');
						decodedFrames += frames;
					}
					// A final granule also contains trailing trim and cannot prove an absolute origin.
					if (header[5]! & 4) return 0;
					const granule = view.getBigInt64(6, true);
					if (granule < 0n || granule > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('The initial Vorbis granule is unsupported.');
					return Math.max(0, Number(granule) - decodedFrames);
				}
			}
			offset += size;
		}
		throw new RangeError('The Vorbis recording has no bounded initial audio granule.');
	} finally { void iterator.return?.().catch(() => undefined); }
}
