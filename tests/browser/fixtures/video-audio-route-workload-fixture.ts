/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Untouched pinned FFmpeg5.1.4: blue64x32/30fps/2s baseline H264 and
// two48k mono AAC-LC silence programmes. FIRST is900s; default is900s/2s.
// Streaming encoding never materializes900s PCM. Decoder tests use sentinels.
const HASHES = {
	'shared-long': '1eab53fec6cfe94486e4b10e3a698cb0407c6320b51bac22d90eade115a7d50e',
	'first-long': '348efb75cdd55ec9ae244187190f07957aa2f343d652c2245b64e84a6b513a92',
} as const;

export function videoAudioRouteWorkloadFixture(
	variant: keyof typeof HASHES,
	authoredEnds?: readonly [number, number],
): File {
	const bytes = Uint8Array.from(Buffer.from(readFileSync(new URL(`./video-audio-${variant}.mp4.base64`, import.meta.url), 'utf8'), 'base64'));
	assert.equal(createHash('sha256').update(bytes).digest('hex'), HASHES[variant]);
	if (authoredEnds) shortenAuthoredProgrammes(bytes, authoredEnds);
	return new File([bytes.buffer], 'Multiple workload.mp4', { type: 'video/mp4' });
}

// Explicit synthetic parser-boundary variants, not additional ordinary files:
// change movie/track/edit presentation ends while retaining all coded AAC bytes.
function shortenAuthoredProgrammes(bytes: Uint8Array, ends: readonly [number, number]): void {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	type Box = Readonly<{ type: string; body: number; end: number }>;
	const children = (body: number, end: number): Box[] => {
		const result: Box[] = [];
		for (let offset = body; offset < end;) {
			assert.ok(offset + 8 <= end);
			const size = view.getUint32(offset); assert.ok(size >= 8 && offset + size <= end);
			result.push({ type: Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString('latin1'), body: offset + 8, end: offset + size });
			offset += size;
		}
		return result;
	};
	const movie = children(0, bytes.length).find(box => box.type === 'moov'); assert.ok(movie);
	const fields = children(movie.body, movie.end), header = fields.find(box => box.type === 'mvhd'); assert.ok(header);
	assert.equal(view.getUint8(header.body), 0);
	const scale = view.getUint32(header.body + 12), movieEnd = Math.max(2, ...ends) * scale;
	assert.ok(Number.isSafeInteger(movieEnd) && movieEnd > 0 && movieEnd <= 0xffff_ffff);
	view.setUint32(header.body + 16, movieEnd);
	let changed = 0;
	for (const track of fields.filter(box => box.type === 'trak')) {
		const parts = children(track.body, track.end), media = parts.find(box => box.type === 'mdia'); assert.ok(media);
		const handler = children(media.body, media.end).find(box => box.type === 'hdlr'); assert.ok(handler);
		if (view.getUint32(handler.body + 8) !== 0x736f756e) continue;
		const trackHeader = parts.find(box => box.type === 'tkhd'), edits = parts.find(box => box.type === 'edts'); assert.ok(trackHeader && edits);
		const list = children(edits.body, edits.end).find(box => box.type === 'elst'); assert.ok(list);
		assert.equal(view.getUint8(trackHeader.body), 0); assert.equal(view.getUint8(list.body), 0); assert.equal(view.getUint32(list.body + 4), 1);
		const duration = ends[changed++]! * scale;
		assert.ok(Number.isSafeInteger(duration) && duration > 0 && duration <= 0xffff_ffff);
		view.setUint32(trackHeader.body + 20, duration); view.setUint32(list.body + 8, duration);
	}
	assert.equal(changed, 2);
}
