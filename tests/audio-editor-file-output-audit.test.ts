/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeExportName } from '../src/common/editor/export.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { resolveDesktopOriginalExportSettings } from '../src/common/editor/desktop-original-export-settings.ts';
import { createAudioEditorVideoFrameExtractor } from '../src/common/editor/video-media.js';

test('export title truncation preserves supplementary Unicode letters', () => {
	const name = sanitizeExportName(`${'a'.repeat(95)}𐐀`);
	assert.equal(new TextDecoder().decode(new TextEncoder().encode(name)), name);
	assert.match(name, /𐐀$/u);
});

test('overwrite-original supports maintained WAVE and RF64 filename aliases', async () => {
	const bytes = Uint8Array.from(encodeWav([new Float32Array(100)], { sampleRate: 48_000, bitDepth: 24 }));
	for (const name of ['recording.wave', 'recording.rf64']) {
		const settings = await resolveDesktopOriginalExportSettings(new File([bytes], name), [{
			kind: 'audio', channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000, frameCount: 100,
		}]);
		assert.equal(settings?.format, 'wav');
	}
});

class PreviewVideo extends EventTarget {
	duration = 0.5;
	videoWidth = 320;
	videoHeight = 180;
	current = 0;
	loads = 0;
	set src(_value: string) { queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata'))); }
	get currentTime() { return this.current; }
	set currentTime(value: number) { this.current = value; queueMicrotask(() => this.dispatchEvent(new Event('seeked'))); }
	removeAttribute() {}
	load() { this.loads++; }
	pause() {}
}

function previewFixture(video: PreviewVideo) {
	const revoked: string[] = [];
	return { revoked, options: {
		timeoutMs: 100,
		urlApi: { createObjectURL() { return 'blob:preview'; }, revokeObjectURL(url: string) { revoked.push(url); } },
		document: { createElement(type: string) {
			if (type === 'video') return video;
			return { width: 0, height: 0,
				getContext() { return { drawImage() { assert.ok(video.currentTime > 0, 'the first frame must be decoded'); } }; },
				toBlob(callback: (blob: Blob) => void) { callback(new Blob(['frame'])); },
			};
		} },
	} };
}

test('sub-two-second videos seek before their first poster capture', async () => {
	const video = new PreviewVideo(); const fixture = previewFixture(video);
	const extractor = await createAudioEditorVideoFrameExtractor(new Blob(['video']), fixture.options);
	try { await extractor.capture(0); }
	finally { extractor.dispose(); }
});

test('invalid video metadata retires its encoded file and decoder', async () => {
	const video = new PreviewVideo(); video.videoWidth = 0;
	const fixture = previewFixture(video);
	await assert.rejects(createAudioEditorVideoFrameExtractor(new Blob(['video']), fixture.options), /width/u);
	assert.deepEqual(fixture.revoked, ['blob:preview']);
	assert.equal(video.loads, 1);
});
