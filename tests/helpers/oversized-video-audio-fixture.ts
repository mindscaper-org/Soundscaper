/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
// Untouched pinned FFmpeg5.1.4: 2s H26464x32 blue/30fps plus900s monoAAC-LC
// 440Hz/48k/64kbit programme, faststart, no-shortest. Encoded bytes only;
// tests MUST intercept the oversized native request before any PCM allocation.
export function oversizedVideoAudioFixture(presentedSeconds?: number): File {
	const encoded = readFileSync(new URL('../browser/fixtures/ffmpeg-oversized-av-audio.mp4.base64', import.meta.url), 'utf8');
	const bytes = Uint8Array.from(Buffer.from(encoded, 'base64'));
	assert.equal(createHash('sha256').update(bytes).digest('hex'), '2582574ab42da4992fe64bf5e3191d350a744c0763a34dae24c12cf41490d37b');
	if (presentedSeconds !== undefined) shortenAuthoredProgramme(bytes, presentedSeconds);
	return new File([bytes.buffer], 'Long programme.mp4', { type: 'video/mp4' });
}

// Parser-boundary compatibility fixture, not another ordinary producer or bug.
// Retain every coded AAC byte/table while changing the explicit movie/track/edit
// presentation durations together. The mediaTime priming offset stays unchanged.
function shortenAuthoredProgramme(bytes: Uint8Array, seconds: number): void {
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
	const fields = children(movie.body, movie.end), movieHeader = fields.find(box => box.type === 'mvhd'); assert.ok(movieHeader);
	assert.equal(view.getUint8(movieHeader.body), 0);
	const timescale = view.getUint32(movieHeader.body + 12), duration = seconds * timescale;
	assert.ok(Number.isSafeInteger(duration) && duration > 0 && duration <= 0xffff_ffff);
	view.setUint32(movieHeader.body + 16, duration);
	let changed = false;
	for (const track of fields.filter(box => box.type === 'trak')) {
		const parts = children(track.body, track.end), media = parts.find(box => box.type === 'mdia'); assert.ok(media);
		const handler = children(media.body, media.end).find(box => box.type === 'hdlr'); assert.ok(handler);
		if (view.getUint32(handler.body + 8) !== 0x736f756e) continue;
		const header = parts.find(box => box.type === 'tkhd'), edits = parts.find(box => box.type === 'edts'); assert.ok(header && edits);
		const list = children(edits.body, edits.end).find(box => box.type === 'elst'); assert.ok(list);
		assert.equal(view.getUint8(header.body), 0); assert.equal(view.getUint8(list.body), 0); assert.equal(view.getUint32(list.body + 4), 1);
		view.setUint32(header.body + 20, duration); view.setUint32(list.body + 8, duration); changed = true;
	}
	assert.equal(changed, true);
}
