/* SPDX-License-Identifier: AGPL-3.0-only */

import { createIsoBoxReader } from './iso-box-reader.ts';

const MAXIMUM_CHUNK_MAP_ENTRIES = 8_192;

/** Verify the original classic track has one out-of-band AVC description for every coded picture. */
export async function hasClassicAvcDecoderConfiguration(blob: Blob, expectedTrackId: number, signal: AbortSignal): Promise<boolean> {
	const { read, boxes, trackId, trackSampleTable, singleAvcSampleEntry } = createIsoBoxReader(blob, signal);
	const roots = await boxes(0, blob.size);
	const movies = roots.filter(box => box.type === 'moov');
	if (movies.length !== 1 || roots.some(box => box.type === 'moof')) return false;
	const movie = movies[0]!;
	const children = await boxes(movie.start, movie.end);
	if (children.some(box => box.type === 'mvex')) return false;
	const tracks = [];
	for (const track of children.filter(box => box.type === 'trak')) {
		const headers = (await boxes(track.start, track.end)).filter(box => box.type === 'tkhd');
		if (headers.length !== 1) return false;
		if (await trackId(headers[0]!) === expectedTrackId) tracks.push(track);
	}
	if (tracks.length !== 1) return false;
	const table = await trackSampleTable(tracks[0]!);
	const descriptions = table.filter(box => box.type === 'stsd');
	const chunkMaps = table.filter(box => box.type === 'stsc');
	if (descriptions.length !== 1 || chunkMaps.length !== 1) return false;
	const description = descriptions[0]!;
	const extensionStart = await singleAvcSampleEntry(description);
	if (extensionStart === null || extensionStart > description.end) return false;
	const sampleEntryLength = (await read(description.start + 8, 4, description.end)).getUint32(0);
	if (sampleEntryLength !== description.end - description.start - 8) return false;
	const extensions = await boxes(extensionStart, description.end);
	if (extensions.filter(box => box.type === 'avcC').length !== 1
		|| extensions.some(box => !['avcC', 'pasp', 'btrt'].includes(box.type))) return false;
	const mapping = chunkMaps[0]!;
	const count = (await read(mapping.start + 4, 4, mapping.end)).getUint32(0);
	if (count < 1 || count > MAXIMUM_CHUNK_MAP_ENTRIES || mapping.end - mapping.start !== 8 + 12 * count) return false;
	signal.throwIfAborted();
	const entries = new DataView(await blob.slice(mapping.start + 8, mapping.end).arrayBuffer());
	signal.throwIfAborted();
	for (let position = 8; position < entries.byteLength; position += 12) {
		if (entries.getUint32(position) !== 1) return false;
	}
	return true;
}
