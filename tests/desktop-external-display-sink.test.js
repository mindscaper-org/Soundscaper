/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { waitFor } from './helpers/async-test-control.ts';
import { loadPreload } from './helpers/framescaper-native-services-preload-fixture.mjs';

test('the dedicated sandbox sink verifies and presents one exact SDR RGBA frame', async () => {
	const source = await readFile(new URL('../desktop/external-display-sink-preload.cjs', import.meta.url), 'utf8');
	const listeners = new Map();
	const sends = [];
	const events = new Map();
	const draws = [];
	const resizes = [];
	class Canvas {
		#width = 0;
		#height = 0;
		get width() { return this.#width; }
		get height() { return this.#height; }
		set width(width) { this.#width = width; resizes.push(['width', width]); }
		set height(height) { this.#height = height; resizes.push(['height', height]); }
		getContext() { return { putImageData: (image, x, y) => draws.push({ image, x, y }) }; }
	}
	class FrameImageData {
		constructor(bytes, width, height) { this.bytes = bytes; this.width = width; this.height = height; }
	}
	const canvas = new Canvas();
	vm.runInNewContext(source, {
		Array, ArrayBuffer, Error, Map, Number, Object, Promise, RangeError, Reflect, String,
		TypeError, Uint8Array, Uint8ClampedArray, crypto: webcrypto,
		HTMLCanvasElement: Canvas, ImageData: FrameImageData,
		document: { getElementById: () => canvas },
		window: { addEventListener: (name, listener) => events.set(name, listener) },
		require: () => ({
			ipcRenderer: {
				on: (channel, listener) => listeners.set(channel, listener),
				send: (channel, value) => sends.push({ channel, value }),
			},
		}),
	});
	events.get('DOMContentLoaded')();
	const acknowledgements = [];
	const port = {
		onmessage: null, onmessageerror: null, onclose: null,
		postMessage: (value) => acknowledgements.push(value), start: () => undefined,
		close: () => undefined,
	};
	listeners.get('framescaper:external-display:v1:connect')(
		{ ports: [port] }, { version: 1, pixelFormat: 'rgba8', colorSpace: 'srgb' },
	);
	const rgba = Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 255);
	const cropped = Uint8Array.of(99, 7, 8, 9, 255, 10, 11, 12, 255, 99).subarray(1, 9);
	const send = (sequence, width, height, pixels) => {
		const sha256 = createHash('sha256').update(pixels).digest('hex');
		port.onmessage({ data: {
			version: 1, type: 'frame', sequence, evaluationFingerprint: 'ab'.repeat(32),
			width, height, dynamicRange: 'sdr', rgbaSha256: sha256, rgba: pixels,
		} });
		return { version: 1, type: 'presented', sequence, sha256 };
	};
	const expected = [send(1, 2, 1, rgba), send(2, 2, 1, cropped), send(3, 1, 2, cropped)];
	await waitFor(() => acknowledgements.length === expected.length, 'the presented frames to be acknowledged', {
		turns: 20, delayMs: 5,
	});
	assert.deepEqual(draws.map(({ image }) => [image.width, image.height]), [[2, 1], [2, 1], [1, 2]]);
	assert.deepEqual([...draws[0].image.bytes], [...rgba]);
	assert.deepEqual([...draws[1].image.bytes], [...cropped]);
	assert.equal(draws[1].image.bytes.buffer, cropped.buffer);
	assert.deepEqual(resizes, [['width', 2], ['height', 1], ['width', 1], ['height', 2]]);
	assert.deepEqual(JSON.parse(JSON.stringify(acknowledgements)), expected);
	events.get('keydown')({ key: 'Escape', preventDefault: () => undefined });
	assert.deepEqual(JSON.parse(JSON.stringify(sends)), [{
		channel: 'framescaper:external-display:v1:close', value: { reason: 'escape-key' },
	}]);
	assert.doesNotMatch(source, /contextBridge|framescaperDesktop|soundscaperDesktop/u);
});

test('the dedicated sink admits a frame larger than one 16 MiB data-plane chunk', async () => {
	const source = await readFile(new URL('../desktop/external-display-sink-preload.cjs', import.meta.url), 'utf8');
	const listeners = new Map();
	const events = new Map();
	const draws = [];
	class Canvas {
		getContext() { return { putImageData: (image) => draws.push(image) }; }
	}
	class FrameImageData {
		constructor(bytes, width, height) { this.bytes = bytes; this.width = width; this.height = height; }
	}
	const canvas = new Canvas();
	vm.runInNewContext(source, {
		Array, ArrayBuffer, Error, Map, Number, Object, Promise, RangeError, Reflect, String,
		TypeError, Uint8Array, Uint8ClampedArray, crypto: webcrypto,
		HTMLCanvasElement: Canvas, ImageData: FrameImageData,
		document: { getElementById: () => canvas },
		window: { addEventListener: (name, listener) => events.set(name, listener) },
		require: () => ({ ipcRenderer: {
			on: (channel, listener) => listeners.set(channel, listener), send: () => undefined,
		} }),
	});
	events.get('DOMContentLoaded')();
	const acknowledgements = [];
	const port = { onmessage: null, onmessageerror: null, onclose: null,
		postMessage: (value) => acknowledgements.push(value), start: () => undefined,
		close: () => undefined };
	listeners.get('framescaper:external-display:v1:connect')(
		{ ports: [port] }, { version: 1, pixelFormat: 'rgba8', colorSpace: 'srgb' },
	);
	const width = 2_048;
	const height = 2_049;
	const rgba = new Uint8Array(width * height * 4);
	const chunkSeam = 16 * 1024 * 1024;
	rgba[0] = 0x12;
	rgba[chunkSeam - 1] = 0x34;
	rgba[chunkSeam] = 0x56;
	rgba[rgba.length - 1] = 0x78;
	const sha256 = createHash('sha256').update(rgba).digest('hex');
	port.onmessage({ data: {
		version: 1, type: 'frame', sequence: 2, evaluationFingerprint: 'cd'.repeat(32),
		width, height, dynamicRange: 'sdr', rgbaSha256: sha256, rgba,
	} });
	await waitFor(() => draws.length > 0, 'the presented frame to be drawn', {
		turns: 100, delayMs: 5,
	});
	assert.equal(draws.length, 1);
	assert.deepEqual([draws[0].width, draws[0].height], [width, height]);
	assert.equal(draws[0].bytes.byteLength, rgba.byteLength);
	assert.deepEqual([
		draws[0].bytes[0], draws[0].bytes[chunkSeam - 1],
		draws[0].bytes[chunkSeam], draws[0].bytes.at(-1),
	], [0x12, 0x34, 0x56, 0x78], 'frame bytes survive both sides of the 16 MiB chunk boundary');
	assert.equal(createHash('sha256').update(draws[0].bytes).digest('hex'), sha256);
	assert.equal(acknowledgements[0].sequence, 2);
});

test('Electron loads only the staged sink document and moves frames over a MessagePort', async () => {
	const source = await readFile(new URL('../desktop/framescaper-native-services-electron-ports.mjs', import.meta.url), 'utf8');
	assert.match(source, /external-display-sink\.html/u);
	assert.match(source, /external-display-sink-preload\.cjs/u);
	assert.match(source, /loadFile\(SINK_HTML\)/u);
	assert.match(source, /new MessageChannelMain\(\)/u);
	assert.match(source, /webContents\.postMessage\(SINK_CONNECT_CHANNEL/u);
	assert.doesNotMatch(source, /framescaper-external-display=1|loadURL\(|webContents\.send\(/u);
});

test('clean-display pixels stay off the main control channel even above 16 MiB', async () => {
	const display = { displays: [{ displayId: 'display-2', label: 'Client monitor', primary: false,
		width: 2_048, height: 2_049, hdrCapable: false, colorManaged: true }],
		activeDisplayId: 'display-2' };
	const fixture = await loadPreload([display]);
	const width = 2_048;
	const height = 2_049;
	const rgba = new Uint8Array(width * height * 4);
	rgba[rgba.length - 4] = 0xf3;
	const sha256 = createHash('sha256').update(rgba).digest('hex');
	const pending = fixture.bridge.nativeServices.presentExternalDisplay({ sequence: 1,
		evaluationFingerprint: '78'.repeat(32), width, height, dynamicRange: 'sdr',
		rgbaSha256: sha256, rgba });
	await assert.rejects(() => fixture.bridge.nativeServices.presentExternalDisplay({ sequence: 2,
		evaluationFingerprint: '78'.repeat(32), width: 1, height: 1, dynamicRange: 'sdr',
		rgbaSha256: sha256, rgba: Uint8Array.of(0, 0, 0, 255) }), /backpressure/iu);
	await pending;
	assert.deepEqual(fixture.displayFrames, [{ byteLength: width * height * 4, sha256 }]);
	assert.equal(rgba.byteLength, 0, 'the preload transfers its private pixel buffer');
});
