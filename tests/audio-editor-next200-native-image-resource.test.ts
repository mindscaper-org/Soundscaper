/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFramescaperBrowserNativeImageV1 } from '../src/common/editor/timeline-image-native-decode-v1.ts';
import { ordinaryImageResourceFixture } from './helpers/ordinary-image-resource-fixture.ts';

for (const format of ['png', 'jpeg', 'gif', 'webp', 'bmp'] as const) test(`ordinary ${format} is refused before opening an allocating decoder`, async () => {
	let opened = false;
	await assert.rejects(decodeFramescaperBrowserNativeImageV1({
		bytes: ordinaryImageResourceFixture(format === 'png' ? 'png-large' : `${format}-wide`), fileName: `ordinary.${format}`, mimeTypeHint: null,
		open: async () => {
			opened = true;
			return { metadata: { width: format === 'png' ? 8192 : 8193, height: format === 'png' ? 8192 : 16, frameCount: 1, topology: 'single', runtimeVersion: 'test' },
				async decodeFrame() { throw new Error('Must not decode.'); }, close() {} };
		},
	}), /pixels exceed the per-frame limit|width.*8192/iu);
	assert.equal(opened, false);
});

test('ordinary admitted PNG retains its decoder and exact published original', async () => {
	let opened = false;
	const bytes = ordinaryImageResourceFixture('png-small');
	const result = await decodeFramescaperBrowserNativeImageV1({ bytes, fileName: 'ordinary.png', mimeTypeHint: null,
		open: async () => {
			opened = true;
			return { metadata: { width: 16, height: 16, frameCount: 1, topology: 'single', runtimeVersion: 'test' },
				async decodeFrame() { return { rgba: new Uint8Array(16 * 16 * 4), durationMicroseconds: null }; }, close() {} };
		},
	});
	assert.equal(opened, true); assert.equal(result.publication.width, 16); assert.equal(result.publication.height, 16);
	assert.equal(result.publication.originalByteLength, bytes.byteLength);
});

test('encoded admission retains the authoritative native output extent check', async () => {
	let closed = false, extracted = false;
	await assert.rejects(decodeFramescaperBrowserNativeImageV1({ bytes: ordinaryImageResourceFixture('png-small'),
		fileName: 'ordinary.png', mimeTypeHint: null,
		open: async () => ({ metadata: { width: 8192, height: 8192, frameCount: 1, topology: 'single', runtimeVersion: 'test' },
			async decodeFrame() { extracted = true; throw new Error('Must not extract.'); }, close() { closed = true; } }),
	}), /pixels exceed the per-frame limit/u);
	assert.equal(closed, true); assert.equal(extracted, false);
});

test('ImageDecoder track admission happens before its first native raster decode', async context => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'ImageDecoder');
	let decoded = false, closed = false;
	class Decoder {
		static async isTypeSupported(): Promise<boolean> { return true; }
		readonly tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: 4097 } };
		async decode(): Promise<never> { decoded = true; throw new Error('Must not allocate.'); }
		close(): void { closed = true; }
	}
	Object.defineProperty(globalThis, 'ImageDecoder', { configurable: true, value: Decoder });
	context.after(() => {
		if (descriptor) Object.defineProperty(globalThis, 'ImageDecoder', descriptor);
		else Reflect.deleteProperty(globalThis, 'ImageDecoder');
	});
	const { openFramescaperBrowserNativeImageV1 } = await import('../src/common/editor/timeline-image-browser-native-port.ts');
	await assert.rejects(openFramescaperBrowserNativeImageV1({ bytes: ordinaryImageResourceFixture('gif-small'),
		format: 'gif', mimeType: 'image/gif' }), /frame count.*4096/iu);
	assert.equal(decoded, false); assert.equal(closed, true);
});
