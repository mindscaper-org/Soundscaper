/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBrowserNativeImageMetadata } from '../src/common/editor/browser-image-metadata-admission.ts';
import { deflateSync } from 'node:zlib';
import { decodeFramescaperBrowserNativeImageV1 } from '../src/common/editor/timeline-image-native-decode-v1.ts';
import { openFramescaperBrowserNativeImageV1 } from '../src/common/editor/timeline-image-browser-native-port.ts';
import { createPngFixture } from './helpers/png-fixture.mjs';

function pngChunk(type: string, body: Uint8Array): Uint8Array {
	const bytes = new Uint8Array(body.length + 12);
	new DataView(bytes.buffer).setUint32(0, body.length);
	bytes.set(new TextEncoder().encode(type), 4); bytes.set(body, 8);
	return bytes;
}
function withChunk(type: string, body: Uint8Array): Uint8Array {
	const png = createPngFixture(1);
	const chunk = pngChunk(type, body);
	return Uint8Array.from([...png.slice(0, 33), ...chunk, ...png.slice(33)]);
}
const open = async () => ({ metadata: { width: 1, height: 1, frameCount: 1,
	topology: 'single' as const, runtimeVersion: 'focused-image-port' },
	decodeFrame: async () => ({ rgba: new Uint8Array([0, 0, 0, 255]), durationMicroseconds: null }), close() {} });

test('image import rejects excess encoded ancillary metadata before opening a decoder', async () => {
	let opened = false;
	const png = createPngFixture(1), metadata = pngChunk('tEXt', new Uint8Array(8 * 1024 ** 2 + 1));
	const bytes = new Uint8Array(png.length + metadata.length);
	bytes.set(png.subarray(0, 33)); bytes.set(metadata, 33); bytes.set(png.subarray(33), 33 + metadata.length);
	await assert.rejects(decodeFramescaperBrowserNativeImageV1({ bytes, fileName: 'metadata.png', mimeTypeHint: 'image/png',
		open: async () => { opened = true; return open(); } }), /metadata.*8 MiB/iu);
	assert.equal(opened, false);
});

test('ICC and non-sRGB color metadata cannot claim the verified plain sRGB route', async () => {
	for (const [type, body] of [
		['iCCP', Uint8Array.from([...new TextEncoder().encode('Adobe RGB\0\0'), ...deflateSync(new Uint8Array([1, 2, 3]))])],
		['cICP', new Uint8Array([9, 16, 0, 1])],
		['gAMA', new Uint8Array([0, 1, 0x86, 0xa0])],
	] as const) {
		let opened = false;
		await assert.rejects(decodeFramescaperBrowserNativeImageV1({ bytes: withChunk(type, body), fileName: 'color.png',
			mimeTypeHint: 'image/png', open: async () => { opened = true; return open(); } }), /verified.*color|color.*verified/iu);
		assert.equal(opened, false);
	}
});

test('native decoder cancellation closes and rejects pending readiness promptly', async (context) => {
	const prior = Object.getOwnPropertyDescriptor(globalThis, 'ImageDecoder');
	context.after(() => { if (prior) Object.defineProperty(globalThis, 'ImageDecoder', prior); else Reflect.deleteProperty(globalThis, 'ImageDecoder'); });
	let closed = 0;
	class Decoder {
		static async isTypeSupported() { return true; }
		readonly tracks = { ready: new Promise<void>(() => {}), selectedTrack: { frameCount: 1 } };
		async decode() { throw new Error('Not reached'); }
		close() { closed += 1; }
	}
	Object.defineProperty(globalThis, 'ImageDecoder', { configurable: true, value: Decoder });
	const abort = new AbortController();
	const pending = openFramescaperBrowserNativeImageV1({ bytes: createPngFixture(1), format: 'png', mimeType: 'image/png', signal: abort.signal });
	await new Promise<void>(resolve => setImmediate(resolve)); abort.abort();
	const result = await Promise.race([pending.then(() => 'opened', (error: unknown) => error),
		new Promise<string>(resolve => setTimeout(() => resolve('still-pending'), 50))]);
	assert.ok(result instanceof Error && result.name === 'AbortError');
	assert.equal(closed, 1);
});

test('cancelling a pending frame closes the probe, decoder and any late decoded frame', async (context) => {
	const prior = Object.getOwnPropertyDescriptor(globalThis, 'ImageDecoder');
	context.after(() => { if (prior) Object.defineProperty(globalThis, 'ImageDecoder', prior); else Reflect.deleteProperty(globalThis, 'ImageDecoder'); });
	let probeClosed = 0, decoderClosed = 0, lateClosed = 0;
	type Result = { complete: boolean; image: { displayWidth: number; displayHeight: number; close(): void } };
	let finish: ((value: Result) => void) | null = null;
	class Decoder {
		static async isTypeSupported() { return true; }
		readonly tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: 2 } };
		decode({ frameIndex }: { frameIndex: number }): Promise<Result> {
			return frameIndex === 0 ? Promise.resolve({ complete: true,
				image: { displayWidth: 1, displayHeight: 1, close() { probeClosed += 1; } } })
				: new Promise(resolve => { finish = resolve; });
		}
		close() { decoderClosed += 1; }
	}
	Object.defineProperty(globalThis, 'ImageDecoder', { configurable: true, value: Decoder });
	const session = await openFramescaperBrowserNativeImageV1({ bytes: createPngFixture(1), format: 'png', mimeType: 'image/png' });
	const abort = new AbortController();
	const pending = session.decodeFrame(1, abort.signal);
	abort.abort(); await assert.rejects(pending, { name: 'AbortError' });
	assert.equal(probeClosed, 1); assert.equal(decoderClosed, 1);
	assert.ok(finish); (finish as (value: Result) => void)({ complete: true,
		image: { displayWidth: 1, displayHeight: 1, close() { lateClosed += 1; } } });
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(lateClosed, 1);
	session.close(); assert.equal(decoderClosed, 1);
});


test('embedded BMP color spaces and metadata between JPEG scans are inspected', () => {
	const bmp = new Uint8Array(142), dib = new DataView(bmp.buffer);
	dib.setUint32(14, 124, true); dib.setUint32(70, 0x4d424544, true);
	assert.throws(() => assertBrowserNativeImageMetadata(bmp, 'bmp'), /verified.*color|color.*verified/iu);
	dib.setUint32(70, 0x73524742, true);
	assert.doesNotThrow(() => assertBrowserNativeImageMetadata(bmp, 'bmp'));
	const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 1, 2, 0xff, 0, 3, 0xff, 0xe2, 0, 16,
		...new TextEncoder().encode('ICC_PROFILE\0'), 1, 1, 0xff, 0xd9]);
	assert.throws(() => assertBrowserNativeImageMetadata(jpeg, 'jpeg'), /verified.*color|color.*verified/iu);
});
