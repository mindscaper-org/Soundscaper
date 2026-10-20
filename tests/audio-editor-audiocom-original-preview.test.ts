/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeAiff } from '../src/common/editor/aiff.js';
import { encodeDedicatedAudioPcm, decodeDedicatedAudioFile } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { createWavBlobPcmChunkReader } from '../src/common/editor/wav-pcm-chunk-reader.ts';
import { prepareAudiocomPreview } from '../src/common/editor/controller/import/internal/audiocom-original-preview.ts';

const loadPayload = async (_format: unknown, url: URL) => new Uint8Array(await readFile(url));
const previewUrl = 'https://soundscaper.org/api/audiocom/preview?url=signed-original';

test('an Audiocity AIFF original becomes a temporary playable WAV with its actual duration and PCM', async () => {
	const pcm = Float32Array.from({ length: 800 }, (_value, frame) => Math.sin(frame * 0.1) * 0.25);
	const encoded = encodeAiff([pcm], { sampleRate: 8000, sampleFormat: 'int16', dither: 'none' });
	assert.ok(encoded instanceof Uint8Array);
	let playable: Blob | undefined;
	const revoked: string[] = [];
	const prepared = await prepareAudiocomPreview({ previewUrl, previewMime: 'audio/aiff' }, new AbortController().signal, {
		fetch: async (url, init) => {
			assert.equal(String(url), previewUrl); assert.equal(init?.credentials, 'include'); assert.equal(init.redirect, 'error');
			return new Response(encoded);
		},
		createObjectUrl: blob => { playable = blob; return 'blob:aiff-preview'; }, revokeObjectUrl: url => { revoked.push(url); },
	});
	assert.equal(prepared.url, 'blob:aiff-preview');
	assert.equal(prepared.durationSeconds, 0.1);
	const descriptor = await inspectWavBlobPcm(playable!);
	assert.equal(descriptor.frameCount, pcm.length);
	const decoded = await createWavBlobPcmChunkReader(playable!, { descriptor }).readChunk(0);
	for (let frame = 0; frame < pcm.length; frame++) assert.ok(Math.abs(decoded.channels[0]![frame]! - pcm[frame]!) < 1 / 32768);
	prepared.dispose(); prepared.dispose();
	assert.deepEqual(revoked, ['blob:aiff-preview']);
});

test('an Audiocity WavPack original uses the existing bounded decoder without losing float PCM', async () => {
	const pcm = Float32Array.from({ length: 4800 }, (_value, frame) => Math.sin(frame * 0.1) * 0.25);
	const encoded = await encodeDedicatedAudioPcm({ format: 'wavpack', input: new Uint8Array(pcm.buffer), frameCount: pcm.length,
		channelCount: 1, sampleRate: 48000, settings: { compressionLevel: 2 }, maximumOutputBytes: 1024 * 1024 }, { loadPayload });
	let playable: Blob | undefined;
	const prepared = await prepareAudiocomPreview({ previewUrl, previewMime: 'audio/x-wavpack' }, new AbortController().signal, {
		fetch: async () => new Response(encoded), createObjectUrl: blob => { playable = blob; return 'blob:wv-preview'; }, revokeObjectUrl() {},
		wavpackDecoder: { async decode(group) {
			assert.ok(group.size < 4 * 1024 * 1024);
			const decoded = await decodeDedicatedAudioFile({ format: 'wavpack', input: new Uint8Array(await group.arrayBuffer()), maximumOutputBytes: 2 * 1024 * 1024 }, { loadPayload });
			return { channels: [new Float32Array(decoded.interleaved.buffer)], sampleRate: decoded.sampleRate };
		} },
	});
	assert.equal(prepared.durationSeconds, 0.1);
	const descriptor = await inspectWavBlobPcm(playable!);
	const decoded = await createWavBlobPcmChunkReader(playable!, { descriptor }).readChunk(0);
	assert.deepEqual(decoded.channels[0], pcm);
	prepared.dispose();
});

test('native previews retain their URL and unsupported original downloads are bounded and abortable', async () => {
	let calls = 0;
	const native = await prepareAudiocomPreview({ previewUrl, previewMime: 'audio/mpeg' }, new AbortController().signal, { fetch: async () => { calls++; throw new Error('unused'); } });
	assert.equal(native.url, previewUrl); assert.equal(calls, 0); native.dispose();
	let cancelled = false;
	await assert.rejects(prepareAudiocomPreview({ previewUrl, previewMime: 'audio/aiff' }, new AbortController().signal, {
		fetch: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Length': String(64 * 1024 * 1024 + 1) } }),
	}), /64 MiB/u);
	assert.equal(cancelled, true);
	const abort = new AbortController();
	let started!: () => void;
	const reading = new Promise<void>(resolve => { started = resolve; });
	const preparing = prepareAudiocomPreview({ previewUrl, previewMime: 'audio/aiff' }, abort.signal, {
		fetch: async () => new Response(new ReadableStream({ pull() { started(); }, cancel() { cancelled = true; } })),
	});
	await reading; cancelled = false; abort.abort();
	await assert.rejects(preparing, { name: 'AbortError' });
	assert.equal(cancelled, true);
});
