/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createDesktopAudioCodecResult } from '../desktop/desktop-audio-codec-operation-contract.ts';
import type { DesktopAudioStreamCommand } from '../desktop/desktop-audio-stream-contract.ts';
import { createDesktopAudioCodecRuntime, type DesktopAudioCodecRendererBridge } from '../src/common/editor/desktop-audio-codec-runtime.ts';
import { encodeDesktopAudioStreamFile, encodeDesktopAudioStreamToSink } from '../src/common/editor/desktop-audio-stream-encoder.ts';
import { openDedicatedAudioEncodeSession } from '../src/common/editor/dedicated-audio-encode-session.ts';
import { isFileBackedAudioExport, registerRangeBackedAudioExport } from '../src/common/editor/file-backed-audio-export.ts';
import { embedAudioChapters } from '../src/common/editor/audio-embedded-chapter-container.ts';
import type { FileSizeWarning } from '../src/common/editor/controller/shared/file-size-warning.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const sampleRate = 48_000;
const frameCount = 50_123;
const chapters = [{ startFrame: 12_000, endFrame: 24_000, title: 'Überblick 日本語' }];
const wav = new Blob([Uint8Array.from(encodeWav([new Float32Array(frameCount)], { sampleRate, bitDepth: 32, float: true }))]);
const settings = { sampleRate, bitRate: 192, embeddedChapters: chapters };

for (const format of ['mp3', 'aac-m4a'] as const) test(`desktop ${format} buffered and sink exports embed opted-in chapters after encoding`, async () => {
	const encoded = format === 'mp3' ? await mp3Fixture() : Buffer.concat([atom('ftyp'), atom('moov'), atom('mdat', Uint8Array.of(1, 2, 3))]);
	const requests: unknown[] = [];
	const runtime = createDesktopAudioCodecRuntime({ capabilities,
		execute(request) { requests.push(request); return createDesktopAudioCodecResult(request, encoded); }, cancel() {},
	});
	try {
		const plain = await runtime.encodeFile(wav, format, { sampleRate, bitRate: 192 });
		assert.deepEqual(plain.bytes, Uint8Array.from(encoded));
		for (const input of [wav, await wav.arrayBuffer()]) {
			const result = await runtime.encode(input, format, settings);
			assert.ok(result.bytes);
			assertChapters(result.bytes, format);
			if (format === 'mp3') assert.deepEqual(Buffer.from(result.bytes).subarray(-encoded.length), encoded);
			else assert.ok(Buffer.from(result.bytes).includes(Buffer.from([1, 2, 3])));
		}
		const chunks: Uint8Array[] = [];
		const streamed = await runtime.encodeFileToSink(wav, format, {
			async open(length) { assert.ok(length > encoded.length); },
			async write(chunk) { assert.ok(chunk.length <= 127); chunks.push(Uint8Array.from(chunk)); },
			async close() { return 'saved'; }, async abort() { assert.fail('valid chapters must publish'); },
		}, { ...settings, maximumOutputChunkBytes: 127 });
		assert.equal(streamed.output, 'saved');
		assertChapters(Buffer.concat(chunks), format);
		assert.ok(requests.every(request => !Object.hasOwn(request as object, 'embeddedChapters')));
	} finally { runtime.dispose(); }
});

test('desktop refuses unsupported chapter containers before executing a codec', async () => {
	const runtime = createDesktopAudioCodecRuntime({ capabilities, execute() { assert.fail('must reject before encoding'); }, cancel() {} });
	try { await assert.rejects(runtime.encodeFile(wav, 'opus', settings), /Embedded chapters support MP3 and M4A/u); }
	finally { runtime.dispose(); }
});

test('desktop chapters keep the validated label snapshot while the native encoder runs', async () => {
	const authored = chapters.map(chapter => ({ ...chapter }));
	const encoded = await mp3Fixture();
	const runtime = createDesktopAudioCodecRuntime({ capabilities,
		execute(request) { authored[0]!.title = 'Edited during encoding'; return createDesktopAudioCodecResult(request, encoded); }, cancel() {},
	});
	try {
		const result = await runtime.encodeFile(wav, 'mp3', { ...settings, embeddedChapters: authored });
		assert.ok(result.bytes);
		assertChapters(result.bytes, 'mp3');
	} finally { runtime.dispose(); }
});

test('disposing desktop export during chapter-size confirmation prevents output publication', async () => {
	const encoded = await mp3Fixture();
	const runtime = createDesktopAudioCodecRuntime({ capabilities,
		execute: request => createDesktopAudioCodecResult(request, encoded), cancel() {},
	});
	await assert.rejects(runtime.encodeFile(wav, 'mp3', { ...settings, maximumOutputBytes: encoded.length,
		async confirmFileSizeWarning() { runtime.dispose(); return true; },
	}), /disposed/u);
});

test('streamed desktop chapters retain all encoded bytes, bounded reads, and native scratch ownership', async () => {
	const encoded = await mp3Fixture();
	const native = streamBridge(encoded);
	const result = await encodeDesktopAudioStreamFile(streamRequest(), native.stream);
	assert.equal(isFileBackedAudioExport(result.blob), true);
	assert.ok(result.blob.size > encoded.length);
	const output = Buffer.from(await result.blob.arrayBuffer());
	assertChapters(output, 'mp3');
	assert.deepEqual(output.subarray(output.length - encoded.length), encoded);
	assert.deepEqual(Buffer.from(await result.blob.slice(-encoded.length).arrayBuffer()), encoded);
	assert.deepEqual(Buffer.from(await result.blob.slice(3, -3).arrayBuffer()), output.subarray(3, -3));
	assert.deepEqual(Buffer.from(await new Response(result.blob.stream()).arrayBuffer()), output);
	assert.equal(native.deletes, 0);
	await result.cleanup(); await result.cleanup();
	assert.equal(native.deletes, 1);
	await assert.rejects(result.blob.slice(-4).arrayBuffer(), /released/u);
});

test('streamed desktop chapters publish through the existing sink and release scratch', async () => {
	const encoded = await mp3Fixture();
	const native = streamBridge(encoded);
	const chunks: Uint8Array[] = [];
	const result = await encodeDesktopAudioStreamToSink(streamRequest(), native.stream, {
		async open(length) { assert.ok(length > encoded.length); },
		async write(chunk) { chunks.push(Uint8Array.from(chunk)); },
		async close() { return 'saved'; }, async abort() { assert.fail('valid export must publish'); },
	});
	assert.equal(result.output, 'saved');
	assertChapters(Buffer.concat(chunks), 'mp3');
	assert.deepEqual(Buffer.concat(chunks).subarray(-encoded.length), encoded);
	assert.equal(native.deletes, 1);
});

test('chapter bytes count toward the desktop file warning and refusal cleans native scratch', async () => {
	const encoded = await mp3Fixture();
	const native = streamBridge(encoded);
	let warnings = 0;
	await assert.rejects(encodeDesktopAudioStreamFile({ ...streamRequest(), settings: {
		...settings, maximumOutputBytes: encoded.length,
		async confirmFileSizeWarning(warning: FileSizeWarning) { warnings++; assert.ok(warning.byteLength > encoded.length); return false; },
	} }, native.stream), /canceled/u);
	assert.equal(warnings, 1);
	assert.equal(native.deletes, 1);
});

test('chaptered native output keeps large audio virtual and reads it in at most 1 MiB ranges', async () => {
	const audio = new Uint8Array(2 * 1024 ** 2 + 17).fill(7);
	const reads: number[] = [];
	class VirtualAudio extends Blob {
		override get size(): number { return audio.length; }
		override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('whole-file native reads are forbidden'); }
		override slice(start = 0, end = this.size): Blob {
			reads.push(end - start);
			assert.ok(end - start <= 1024 ** 2);
			return new Blob([audio.subarray(start, end)]);
		}
	}
	const output = await embedAudioChapters(registerRangeBackedAudioExport(new VirtualAudio()), 'mp3', chapters, sampleRate);
	assert.equal(reads.length, 0, 'adding chapters does not read native audio');
	await assert.rejects(output.arrayBuffer(), /bounded/u);
	const bytes = Buffer.from(await new Response(output.stream()).arrayBuffer());
	assertChapters(bytes, 'mp3');
	assert.deepEqual(bytes.subarray(-audio.length), Buffer.from(audio));
	const boundary = output.size - audio.length;
	assert.deepEqual(Buffer.from(await output.slice(boundary - 3, boundary + 3).arrayBuffer()), bytes.subarray(boundary - 3, boundary + 3));
	assert.deepEqual(Buffer.from(await output.slice(-7).slice(2).arrayBuffer()), bytes.subarray(-5));
	assert.equal((await output.slice(4, 2).arrayBuffer()).byteLength, 0);
	assert.equal(reads.filter(length => length === 1024 ** 2).length, 1);
});

test('direct desktop PCM export retains chapter settings through preparation', async () => {
	const encoded = await mp3Fixture();
	const native = streamBridge(encoded);
	const runtime = createDesktopAudioCodecRuntime({ ...native, capabilities, execute() { assert.fail('must stream PCM'); }, cancel() {} });
	try {
		const prepared = await runtime.preparePcmStream({ frameCount, channelCount: 1, sampleRate }, 'mp3', settings);
		assert.ok(prepared);
		const result = await prepared.encode(async write => { await write([new Float32Array(frameCount)]); });
		assertChapters(new Uint8Array(await result.blob.arrayBuffer()), 'mp3');
		await result.cleanup();
		assert.equal(native.deletes, 1);
	} finally { runtime.dispose(); }
});

function capabilities(query: Parameters<DesktopAudioCodecRendererBridge['capabilities']>[0]) {
	return { schemaVersion: 2, capabilities: query.operations.map(tuple => ({ ...tuple, available: true, provider: 'bundled', reason: null })) };
}

function streamRequest() {
	return { file: wav, plan: { schemaVersion: 1 as const, frameCount, maximumOutputBytes: 1024 ** 2,
		tuple: { operation: 'audio-encode' as const, format: 'mp3' as const, sampleRate, channelCount: 1, settings: { bitrateKbps: 192 } } },
		channelMapping: 'preserve', extension: '.mp3', mimeType: 'audio/mpeg', settings };
}

function streamBridge(encoded: Uint8Array) {
	let deletes = 0;
	return { get deletes() { return deletes; }, stream(command: DesktopAudioStreamCommand): unknown {
		if (command.type === 'begin') return { operationId: `desktop-audio-stream-${'c'.repeat(32)}` };
		if (command.type === 'write') return { offset: command.offset + command.bytes.length };
		if (command.type === 'execute') return { byteLength: encoded.length };
		if (command.type === 'read') { assert.ok(command.maximumBytes <= 1024 ** 2); return Uint8Array.from(encoded.subarray(command.offset, command.offset + command.maximumBytes)); }
		if (command.type === 'delete') { deletes++; return true; }
		assert.fail('unexpected native stream command');
	} };
}

async function mp3Fixture(): Promise<Buffer> {
	const session = await openDedicatedAudioEncodeSession({ format: 'mp3', sampleRate, channelCount: 1, frameCount, settings: { bitrateKbps: 192 } }, {
		loadPayload: async (_format, url) => new Uint8Array(await readFile(url)),
	});
	try {
		const parts: Uint8Array[] = [];
		for (let frame = 0; frame < frameCount; frame += 16_384) {
			const frames = Math.min(16_384, frameCount - frame);
			parts.push(session.write(new Uint8Array(frames * 4), frames));
		}
		const final = session.finish();
		const encoded = Buffer.concat([...parts, final.bytes]);
		encoded.set(final.prefixPatch);
		return encoded;
	} finally { session.close(); }
}

function atom(type: string, ...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(8 + parts.reduce((size, part) => size + part.length, 0));
	new DataView(bytes.buffer).setUint32(0, bytes.length);
	bytes.set(new TextEncoder().encode(type), 4);
	let offset = 8;
	for (const part of parts) { bytes.set(part, offset); offset += part.length; }
	return bytes;
}

function assertChapters(bytes: Uint8Array, format: string): void {
	const output = Buffer.from(bytes);
	assert.ok(output.includes(Buffer.from(chapters[0]!.title)));
	assert.ok(output.includes(Buffer.from(format === 'mp3' ? 'CHAP' : 'chpl')));
	if (format === 'mp3') {
		const chapter = output.indexOf(Buffer.from('CHAP'));
		const times = output.indexOf(0, chapter + 10) + 1;
		assert.equal(output.readUInt32BE(times), 250);
		assert.equal(output.readUInt32BE(times + 4), 500);
	} else {
		const chapter = output.indexOf(Buffer.from('chpl'));
		assert.equal(output[chapter + 12], 1);
		assert.equal(output.readBigUInt64BE(chapter + 13), 2_500_000n);
	}
}
