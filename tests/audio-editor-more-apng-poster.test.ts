/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { openFramescaperBrowserNativeImageV1 as open } from '../src/common/editor/timeline-image-browser-native-port.ts';
import { singleFramePosterApng, twoFramePosterApng } from './helpers/single-frame-poster-apng.ts';

test('a static bitmap fallback cannot substitute the poster for a one-frame APNG animation', async context => {
	const saved = ['ImageDecoder', 'createImageBitmap'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
	context.after(() => { for (const [key, descriptor] of saved) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
	} });
	Reflect.deleteProperty(globalThis, 'ImageDecoder');
	let opened = 0;
	Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => {
		opened += 1; return { width: 1, height: 1, close() {} };
	} });
	await assert.rejects(open({ bytes: singleFramePosterApng(), format: 'png', mimeType: 'image/png' }), /animated.*decoder/iu);
	assert.equal(opened, 0);
});

for (const [frameCount, nativeFrameCount] of [[1, 1], [1, 2], [2, 3]] as const) test(`APNG retains ${frameCount} authored frames with ${nativeFrameCount} reported native frames`, async context => {
	const saved = ['ImageDecoder', 'OffscreenCanvas'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
	context.after(() => { for (const [key, descriptor] of saved) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
	} });
	class Decoder {
		static async isTypeSupported() { return true; }
		readonly tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: nativeFrameCount } };
		async decode() { return { complete: true, image: { displayWidth: 1, displayHeight: 1, duration: frameCount === 1 ? null : 500_000, close() {} } }; }
		close() {}
	}
	class Canvas {
		getContext() { return { clearRect() {}, drawImage() {}, getImageData: () => ({ data: Uint8ClampedArray.of(0, 0, 255, 255) }) }; }
	}
	Object.defineProperty(globalThis, 'ImageDecoder', { configurable: true, value: Decoder });
	Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: Canvas });
	const session = await open({ bytes: frameCount === 1 ? singleFramePosterApng() : twoFramePosterApng(), format: 'png', mimeType: 'image/png' });
	try {
		assert.equal(session.metadata.frameCount, frameCount);
		assert.equal((await session.decodeFrame(0)).durationMicroseconds, 500_000);
	}
	finally { session.close(); }
});
