/* SPDX-License-Identifier: AGPL-3.0-only */

import { consumeDs64TableSize, readDs64Directory } from './wav-ds64.js';
import { ascii, dataView, readBlobBytes } from './wav-import-io.ts';
import { createRiffStreamingSizeResolver } from './riff-streaming-size.ts';

const MAXIMUM_CHUNKS = 4096;
const MAXIMUM_METADATA_BYTES = 16 * 1024 ** 2;
interface Directory {
	readonly name: string;
	readonly riffEnd: number;
	readonly nextOffset: number;
	readonly dataByteLength: number;
	readonly table: Map<string, { readonly values: number[]; index: number }>;
}

/** The tag demuxer rejects some natively decoded WAVE codecs and BW64.
 * Present its bounded INFO/ID3 chunks in a small RIFF view without reading PCM.
 * The original container remains the authority for CSET and audio validation.
 */
export async function riffMetadataReadView(file: Blob, header: Uint8Array, signal?: AbortSignal): Promise<Blob | null> {
	const kind = ascii(header, 0, 4);
	if (header.length < 12 || !['RIFF', 'RF64', 'BW64'].includes(kind) || ascii(header, 8, 4) !== 'WAVE') return null;
	const declaredSize = dataView(header).getUint32(4, true);
	const streamingSize = kind === 'RIFF' ? createRiffStreamingSizeResolver(declaredSize, file.size) : null;
	const directory = kind === 'RF64' || kind === 'BW64' ? await readDs64Directory(file, signal, MAXIMUM_CHUNKS,
		declaredSize, kind.toLowerCase(), readBlobBytes) as Directory : null;
	const riffEnd = directory?.riffEnd ?? streamingSize?.riffEnd ?? declaredSize + 8;
	if (!Number.isSafeInteger(riffEnd) || riffEnd < 12 || riffEnd > file.size) throw new RangeError('The RIFF metadata container size is invalid.');
	let offset = directory?.nextOffset ?? 12;
	let count = 0;
	let dataSeen = false;
	let metadataBytes = 0;
	const parts: BlobPart[] = [];
	while (offset < riffEnd) {
		if (++count > MAXIMUM_CHUNKS || offset + 8 > riffEnd) throw new RangeError('The RIFF64 metadata chunk directory is invalid.');
		const chunk = await readBlobBytes(file, offset, offset + 8, signal);
		const id = ascii(chunk, 0, 4);
		let size = dataView(chunk).getUint32(4, true);
		if (directory && size === 0xffff_ffff) size = id === 'data' && !dataSeen
			? directory.dataByteLength : consumeDs64TableSize(directory, id) as number;
		if (id === 'data') dataSeen = true;
		const start = offset + 8;
		const terminalData = streamingSize?.resolveChunk(id, size, start);
		if (terminalData) size = terminalData.byteLength;
		const next = terminalData?.paddedEnd ?? start + size + size % 2;
		if (!Number.isSafeInteger(next) || next > riffEnd) throw new RangeError('The RIFF64 metadata chunk is incomplete.');
		const info = id === 'LIST' && size >= 4 && ['INFO', 'INF0'].includes(ascii(await readBlobBytes(file, start, start + 4, signal), 0, 4));
		if (info || id === 'ID3 ' || id === 'id3 ') {
			metadataBytes += 8 + size + size % 2;
			if (metadataBytes > MAXIMUM_METADATA_BYTES) throw new RangeError('The RIFF64 metadata exceeds its inspection limit.');
			dataView(chunk).setUint32(4, size, true);
			// Selected desktop ranges are virtual Blobs. Own only the bounded
			// metadata bytes before native Blob composition; never materialize audio.
			parts.push(Uint8Array.from(chunk), Uint8Array.from(await readBlobBytes(file, start, next, signal)));
		}
		offset = next;
	}
	streamingSize?.assertComplete();
	const carrier = new Uint8Array(36);
	const view = dataView(carrier);
	carrier.set(new TextEncoder().encode('RIFF'));
	view.setUint32(4, 38 + metadataBytes, true);
	carrier.set(new TextEncoder().encode('WAVEfmt '), 8);
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, 8000, true);
	view.setUint32(28, 16000, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	const data = new Uint8Array(10);
	data.set(new TextEncoder().encode('data'));
	dataView(data).setUint32(4, 2, true);
	signal?.throwIfAborted();
	return new Blob([carrier, ...parts, data], { type: 'audio/wav' });
}
