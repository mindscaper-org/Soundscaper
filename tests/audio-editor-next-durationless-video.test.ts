/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorVideoFrameExtractor } from '../src/common/editor/video-media.js';
import { demuxVideoDuration } from '../src/common/editor/video-timing-demux.ts';

// Native Chromium MediaRecorder VP8 WebM:23pictures,end771ms,no Duration element.
// The maintained browser regression independently creates fresh recorder output.
const RECORDED_WEBM =
	'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';
function recording(): Blob { return new Blob([Buffer.from(RECORDED_WEBM, 'base64')], { type: 'video/webm' }); }

function fixture(duration: number, decoderFails = false) {
	const listeners = new Map<string, () => void>();
	const revoked: string[] = [];
	let cleared = 0, loaded = 0;
	const video = {
		preload: '', muted: false, playsInline: false, duration, videoWidth: 192, videoHeight: 108,
		set src(_value: string) { queueMicrotask(() => listeners.get(decoderFails ? 'error' : 'loadedmetadata')?.()); },
		addEventListener(type: string, listener: () => void) { listeners.set(type, listener); },
		removeEventListener(type: string) { listeners.delete(type); },
		removeAttribute() { cleared++; }, load() { loaded++; }, pause() {},
	};
	return { video, listeners, revoked, clears: () => cleared, loads: () => loaded,
		document: { createElement: () => video },
		urlApi: { createObjectURL: () => 'blob:recording', revokeObjectURL: (url: string) => { revoked.push(url); } },
	};
}

test('a browser-durationless MediaRecorder WebM obtains its finite end from bounded container timing', async () => {
	const ports = fixture(Infinity);
	const extractor = await createAudioEditorVideoFrameExtractor(recording(), ports);
	try {
		assert.equal(extractor.metadata.durationSeconds, .771);
		assert.equal(extractor.metadata.width, 192); assert.equal(extractor.metadata.height, 108);
		assert.equal(ports.video.duration, Infinity, 'do not mutate the native media duration');
		assert.deepEqual(ports.revoked, []);
	} finally { extractor.dispose(); }
	assert.deepEqual(ports.revoked, ['blob:recording']); assert.equal(ports.listeners.size, 0);
});

test('a finite native duration keeps its existing no-container-read path', async () => {
	class NativeOnly extends Blob { override slice(): Blob { throw new Error('Unexpected fallback read'); } }
	const ports = fixture(1.25);
	const extractor = await createAudioEditorVideoFrameExtractor(new NativeOnly(['native media']), ports);
	assert.equal(extractor.metadata.durationSeconds, 1.25); extractor.dispose();
	assert.deepEqual(ports.revoked, ['blob:recording']);
});

test('the duration fallback retains its bounded metadata read budget', async () => {
	await assert.rejects(demuxVideoDuration(recording(), { maximumTotalBytes: 8 }), /bounded.*budget/u);
});

test('container timing does not bypass a native decoder failure', async () => {
	const ports = fixture(Infinity, true);
	await assert.rejects(createAudioEditorVideoFrameExtractor(recording(), ports), /browser could not read this video/u);
	assert.deepEqual(ports.revoked, ['blob:recording']); assert.equal(ports.clears(), 1); assert.equal(ports.listeners.size, 0);
});

test('cancellation during fallback parsing aborts and releases the native media resource', async () => {
	const controller = new AbortController();
	class Aborting extends Blob {
		override slice(start?: number, end?: number, type?: string): Blob {
			controller.abort(new DOMException('Cancelled fallback', 'AbortError'));
			return super.slice(start, end, type);
		}
	}
	const ports = fixture(Infinity);
	await assert.rejects(createAudioEditorVideoFrameExtractor(new Aborting([await recording().arrayBuffer()]),
		{ ...ports, signal: controller.signal }), { name: 'AbortError' });
	assert.deepEqual(ports.revoked, ['blob:recording']); assert.equal(ports.clears(), 1); assert.equal(ports.loads(), 1);
});

for (const duration of [NaN, -1, -Infinity, Infinity]) test(`unreadable duration${duration} still refuses malformed media and releases its URL`, async () => {
	const ports = fixture(duration);
	await assert.rejects(createAudioEditorVideoFrameExtractor(new Blob(['not a video']), ports));
	assert.deepEqual(ports.revoked, ['blob:recording']); assert.equal(ports.clears(), 1); assert.equal(ports.listeners.size, 0);
});
