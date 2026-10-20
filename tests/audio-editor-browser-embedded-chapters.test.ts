/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createBrowserAudioCodecRuntime } from '../src/common/editor/browser-audio-codec-runtime.ts';
import { encodeBrowserAudioFileStreamed, streamBrowserAudioEncodedResult } from '../src/common/editor/browser-audio-streamed-encode.ts';
import { openDedicatedAudioEncodeSession } from '../src/common/editor/dedicated-audio-encode-session.ts';
import { createMediaExportCapabilities } from '../src/common/editor/media-export.js';
import { registerFileBackedExport, isFileBackedAudioExport } from '../src/common/editor/file-backed-audio-export.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import type { TemporaryFileSink } from '../src/common/editor/controller/export/temporary-export.ts';

const SAMPLE_RATE = 48_000;
const CHAPTERS = Object.freeze([{ startFrame: 0, endFrame: 48_000, title: 'Opening chapter' }]);

test('the actual streamed MP3 encoder embeds chapters after validating its gapless audio', async () => {
	const sink = temporarySink();
	const result = await encodeBrowserAudioFileStreamed(wavFixture(50_123), 'mp3', {
		bitRate: 192, embeddedChapters: CHAPTERS, metadata: { title: 'Episode', genre: 'Ambient' },
	}, createMediaExportCapabilities(), {
		createSink: async () => sink,
		async openSession(request) {
			const session = await openDedicatedAudioEncodeSession(request, {
				loadPayload: async (_format, url) => new Uint8Array(await readFile(url)),
			});
			return {
				write: async (bytes, frames) => session.write(bytes, frames),
				finish: async () => session.finish(),
				close: () => session.close(),
			};
		},
	});
	const bytes = Buffer.from(await result.blob.arrayBuffer());
	assert.equal(bytes.subarray(0, 3).toString(), 'ID3');
	assert.ok(bytes.includes(Buffer.from('CHAP')));
	assert.ok(bytes.includes(Buffer.from('Opening chapter')));
	assert.ok(bytes.includes(Buffer.from('TCON')));
	assert.ok(bytes.includes(Buffer.from('Ambient')));
	assert.equal(bytes.indexOf(Buffer.from('ID3'), 3), -1);
	assert.equal(isFileBackedAudioExport(result.blob), true);
	assert.equal(sink.removed, false);
	const published: Uint8Array<ArrayBuffer>[] = [];
	const delivery = await streamBrowserAudioEncodedResult(result, {
		async open(length) { assert.equal(length, result.blob.size); },
		async write(chunk) { published.push(Uint8Array.from(chunk)); },
		async close() { return 'saved'; },
		async abort() { throw new Error('Publishing this valid output must not abort.'); },
	}, { maximumOutputChunkBytes: 127 });
	assert.equal(delivery.output, 'saved');
	assert.deepEqual(Buffer.concat(published), bytes);
	assert.equal(sink.removed, true);
});

test('browser preflight refuses embedded chapters for unsupported containers', async () => {
	const runtime = createBrowserAudioCodecRuntime();
	try {
		await assert.rejects(runtime.preflightEncodeFile('flac', {
			frameCount: 48_000, sampleRate: SAMPLE_RATE, sampleFormat: 'int24', embeddedChapters: CHAPTERS,
		}), /Embedded chapters support MP3 and M4A/u);
	} finally { runtime.dispose(); }
});

test('chapter metadata contributes to the streamed file-size warning and refusal removes staging', async () => {
	const sink = temporarySink();
	let warnings = 0;
	await assert.rejects(encodeBrowserAudioFileStreamed(wavFixture(16), 'mp3', {
		bitRate: 192, embeddedChapters: [{ startFrame: 0, endFrame: 16, title: 'Intro' }], maximumOutputBytes: 8,
		async confirmFileSizeWarning(warning) {
			warnings++;
			assert.ok(warning.byteLength > 8);
			return false;
		},
	}, createMediaExportCapabilities(), {
		createSink: async () => sink,
		validateOutput: async () => undefined,
		openSession: async () => ({
			async write() { return Uint8Array.of(0xff, 0xfb, 0x90, 0x00); },
			async finish() { return { bytes: new Uint8Array(), prefixPatch: new Uint8Array() }; },
			close() {},
		}),
	}), { name: 'AbortError' });
	assert.equal(warnings, 1);
	assert.equal(sink.aborted, true);
});

function wavFixture(frames: number): Blob {
	return new Blob([Uint8Array.from(encodeWav([new Float32Array(frames)], {
		sampleRate: SAMPLE_RATE, bitDepth: 32, float: true,
	}))]);
}

function temporarySink(): TemporaryFileSink & { removed: boolean; aborted: boolean } {
	const parts: Uint8Array<ArrayBuffer>[] = [];
	return {
		persistent: true, removed: false, aborted: false,
		async write(bytes) { parts.push(Uint8Array.from(bytes as Uint8Array)); },
		async writeAt(offset, bytes) { assert.equal(offset, 0); parts[0]!.set(bytes as Uint8Array); },
		async close(type) {
			const blob = registerFileBackedExport(new Blob(parts, { type }));
			blob.arrayBuffer = () => { throw new Error('Chapter packaging must keep staged audio in storage.'); };
			return blob;
		},
		async remove() { this.removed = true; },
		async abort() { this.aborted = true; },
	};
}
