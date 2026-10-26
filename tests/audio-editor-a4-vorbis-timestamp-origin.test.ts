/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { inspectVorbisAbsoluteOrigin } from '../src/common/editor/vorbis-initial-granule.ts';
import { oggPageCrc } from '../src/common/editor/ogg-page-crc.ts';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import { vorbisTimestampFixture, vorbisTimestampReference } from './helpers/vorbis-timestamp-fixture.ts';

for (const absolute of [false, true]) test(`Vorbis File Import preserves recorded extent independently of broadcast timestamp=${String(absolute)}`, async () => {
	const previous = globalThis.fetch;
	globalThis.fetch = async url => { assert.ok(url instanceof URL); return new Response(Uint8Array.from(await readFile(url))); };
	try {
		const prepared = await prepareStreamedAudioImport(vorbisTimestampFixture(absolute));
		try {
			assert.equal(prepared.descriptor.frameCount, 4800);
			assert.equal(prepared.descriptor.sampleRate, 48_000); assert.equal(prepared.descriptor.channelCount, 2);
			const decoded: number[][] = [[], []];
			await prepared.stream({ chunkFrames: 1024, onChunk(channels) { channels.forEach((channel, index) => decoded[index]!.push(...channel)); } });
			const reference = vorbisTimestampReference();
			for (let channel = 0; channel < 2; channel++) {
				assert.equal(decoded[channel]!.length, 4800);
				let error = 0;
				for (let frame = 0; frame < 4800; frame++) error = Math.max(error, Math.abs(decoded[channel]![frame]! - reference[channel]![frame]!));
				assert.ok(error < 1e-6, `Independent FFmpeg PCM error ${String(error)}.`);
			}
		} finally { prepared.dispose(); }
	} finally { globalThis.fetch = previous; }
});


test('Vorbis clock inspection reads bounded headers and retires held reads or metadata iteration on Cancel', async () => {
	assert.equal(chunkGroupForModulePath('src/common/editor/vorbis-initial-granule.ts'), 'editor-optional-execution');
	const original = vorbisTimestampFixture(true), bytes = new Uint8Array(await original.arrayBuffer());
	const serial = new DataView(bytes.buffer).getUint32(14, true), requests: number[] = [];
	class Observed extends File { override slice(start = 0, end = this.size, type = ''): Blob {
		requests.push(end - start); return super.slice(start, end, type);
	} }
	const packets = { async *[Symbol.asyncIterator]() { yield { duration: 0, byteLength: 61 }; } };
	assert.equal(await inspectVorbisAbsoluteOrigin(new Observed([original], original.name), serial, 48_000, packets), 48_000);
	assert.ok(requests.length > 1 && Math.max(...requests) <= 65_307);
	for (const phase of ['read', 'packet']) {
		const abort = new AbortController(), reason = new DOMException('Cancel broadcast import', 'AbortError');
		let release: (() => void) | undefined, entered: (() => void) | undefined, retired = false;
		const started = new Promise<void>(resolve => { entered = resolve; });
		class Held extends File { override slice(start = 0, end = this.size, type = ''): Blob {
			const part = super.slice(start, end, type);
			if (phase === 'read' && !release) part.arrayBuffer = () => {
				entered?.(); return new Promise<ArrayBuffer>(resolve => { release = () => { resolve(new ArrayBuffer(end - start)); }; });
			};
			return part;
		} }
		const pendingPackets = { [Symbol.asyncIterator](): AsyncIterator<{ duration: number; byteLength: number }> {
			return { next: () => { entered?.(); return new Promise(resolve => { release = () => { resolve({ done: false, value: { duration: 0, byteLength: 61 } }); }; }); },
				return: () => { retired = true; return Promise.resolve({ done: true, value: undefined }); } };
		} };
		const pending = inspectVorbisAbsoluteOrigin(new Held([original], original.name), serial, 48_000,
			phase === 'packet' ? pendingPackets : packets, abort.signal);
		await started; abort.abort(reason); await assert.rejects(pending, error => error === reason); release?.();
		if (phase === 'packet') assert.equal(retired, true);
	}
});

test('Vorbis clock admission keeps first-page CRC, granule and packet duration checks before publication', async () => {
	const original = vorbisTimestampFixture(true), encoded = new Uint8Array(await original.arrayBuffer());
	const serial = new DataView(encoded.buffer).getUint32(14, true);
	let offset = 0;
	for (let page = 0; page < 2; page++) {
		const laces = encoded.subarray(offset + 27, offset + 27 + encoded[offset + 26]!);
		offset += 27 + laces.length + laces.reduce((sum, length) => sum + length, 0);
	}
	const laces = encoded.subarray(offset + 27, offset + 27 + encoded[offset + 26]!);
	const size = 27 + laces.length + laces.reduce((sum, length) => sum + length, 0);
	const packets = { async *[Symbol.asyncIterator]() { yield { duration: 0, byteLength: 61 }; } };
	const badCrc = encoded.slice(); badCrc[offset + 22]! ^= 1;
	await assert.rejects(inspectVorbisAbsoluteOrigin(new Blob([badCrc]), serial, 48_000, packets), /checksum/u);
	const unsafe = encoded.slice(), view = new DataView(unsafe.buffer);
	view.setBigInt64(offset + 6, 1n << 54n, true); view.setUint32(offset + 22, oggPageCrc(unsafe.subarray(offset, offset + size)), true);
	await assert.rejects(inspectVorbisAbsoluteOrigin(new Blob([unsafe]), serial, 48_000, packets), /granule/u);
	const wrongDuration = { async *[Symbol.asyncIterator]() { yield { duration: 1, byteLength: 61 }; } };
	await assert.rejects(inspectVorbisAbsoluteOrigin(original, serial, 48_000, wrongDuration), /duration/u);
});
