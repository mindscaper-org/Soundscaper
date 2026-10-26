/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeDedicatedAudioPcm } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import type { BrowserDedicatedAudioFormat } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { resolveDesktopOriginalExportSettings } from '../src/common/editor/desktop-original-export-settings.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { embedAudioFileMetadata } from '../src/common/editor/audio-container-metadata.ts';

const dependencies = { loadPayload: async (_format: BrowserDedicatedAudioFormat, url: URL) => Uint8Array.from(await readFile(url)) };

function prependId3(bytes: Uint8Array): File {
	const padding = 1100 * 1024;
	const header = new Uint8Array(padding + 10);
	header.set([73, 68, 51, 4, 0, 0]);
	for (let index = 0; index < 4; index++) header[9 - index] = padding >>> (7 * index) & 0x7f;
	return new File([header, Uint8Array.from(bytes)], 'Orchestra.flac', { type: 'audio/flac' });
}

test('a successfully imported FLAC with a large leading ID3 tag retains Original export settings', async () => {
	const frameCount = 4608;
	const audio = Float32Array.from({ length: frameCount }, (_, index) => Math.sin(index / 30) / 4);
	const encoded = await encodeDedicatedAudioPcm({ format: 'flac', input: new Uint8Array(audio.buffer), frameCount,
		channelCount: 1, sampleRate: 48_000, settings: { compressionLevel: 5 }, maximumOutputBytes: 1024 ** 2 }, dependencies);
	const file = prependId3(encoded);
	const imported = await prepareStreamedAudioImport(file);
	assert.ok(imported);
	assert.equal(imported.descriptor.frameCount, frameCount);
	imported.dispose();
	const reads: [number, number][] = [];
	const settings = await resolveDesktopOriginalExportSettings({ name: file.name, size: file.size,
		slice(start: number, end: number) { reads.push([start, end]); return file.slice(start, end); },
	}, [{ kind: 'audio', ...imported.descriptor }]);
	assert.ok(settings, 'A valid imported source must retain the Original export shortcut.');
	assert.equal(settings.format, 'flac');
	assert.equal(settings.sampleRate, 48_000);
	assert.equal(settings.bitDepth, 24);
	assert.ok(reads.every(([start, end]) => end - start <= 1024 ** 2));
	assert.ok(reads.some(([start]) => start > 1024 ** 2), 'Seek over the metadata without reading its full payload.');
});

test('Original bitrate selection measures Opus audio rather than album metadata bytes', async () => {
	const frameCount = 48_000;
	const audio = Float32Array.from({ length: frameCount }, (_, index) => Math.sin(index / 30) / 4);
	const encoded = await encodeDedicatedAudioPcm({ format: 'opus', input: new Uint8Array(audio.buffer), frameCount,
		channelCount: 1, sampleRate: 48_000, settings: { bitrateKbps: 96, vbrMode: 1 }, maximumOutputBytes: 1024 ** 2 }, dependencies);
	const plain = new Blob([Uint8Array.from(encoded)], { type: 'audio/ogg' });
	const tagged = await embedAudioFileMetadata(plain, 'opus', { lyrics: 'A'.repeat(65_536) });
	const settings = [];
	for (const blob of [plain, tagged]) {
		const file = new File([blob], 'Orchestra.opus', { type: blob.type });
		const imported = await prepareStreamedAudioImport(file);
		try {
			assert.equal(imported.descriptor.frameCount, frameCount);
			settings.push(await resolveDesktopOriginalExportSettings(file, [{ kind: 'audio', ...imported.descriptor }]));
		} finally { imported.dispose(); }
	}
	assert.ok(settings[0]);
	assert.deepEqual(settings[1], settings[0], 'Metadata cannot change the bitrate selected for the same audio packets.');
});
