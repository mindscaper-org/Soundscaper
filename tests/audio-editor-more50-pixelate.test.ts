/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

interface PixelateRuntime {
	VideoPreviewCompositor: new (canvas: HTMLCanvasElement) => {
		render(layers: unknown, settings: unknown): unknown;
		gl: WebGL2RenderingContext;
		dispose(): void;
	};
	createVideoEffect(type: string, options: unknown): unknown;
}

test('GPU pixelation averages every source pixel, including partial edge blocks', async () => {
	const { outputFiles } = await build({ stdin: { contents: "export {VideoPreviewCompositor} from './src/common/editor/ui/video-preview-compositor.js';export {createVideoEffect} from './src/common/editor/video-effects.js';", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'pixelateRuntime', platform: 'browser' });
	assert.ok(outputFiles[0]);
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	try {
		const page = await browser.newPage();
		await page.addScriptTag({ content: outputFiles[0].text });
		for (const [width, height] of [[128, 128], [257, 131]] as const) {
			const blockSize = 128;
			const input = new Uint8Array(width * height * 4);
			for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
				const offset = (y * width + x) * 4;
				const white = [32, 96].some(center => Math.abs(x - center + 0.5) < 2) && [32, 96].some(center => Math.abs(y - center + 0.5) < 2);
				input[offset] = input[offset + 1] = input[offset + 2] = white ? 255 : x >= 128 ? (x + y) % 256 : 0;
				input[offset + 3] = 255;
			}
			const actual = await page.evaluate(({ base64, width, height, blockSize }) => {
				const runtime = Reflect.get(globalThis, 'pixelateRuntime') as PixelateRuntime;
				const source = document.createElement('canvas'); source.width = width; source.height = height;
				const context = source.getContext('2d'); if (!context) throw new Error('Canvas2D unavailable');
				context.putImageData(new ImageData(Uint8ClampedArray.from(atob(base64), char => char.charCodeAt(0)), width, height), 0, 0);
				const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
				const compositor = new runtime.VideoPreviewCompositor(canvas);
				try {
					compositor.render([{ trackId: 'v', entries: [{ video: { drawable: source, videoWidth: width, videoHeight: height, readyState: 4 }, opacity: 1, effects: [runtime.createVideoEffect('pixelate', { params: { blockSize } })] }] }], { outputWidth: width, outputHeight: height, referenceWidth: width, referenceHeight: height, outputColorModel: 'rgba' });
					const bytes = new Uint8Array(width * height * 4), gl = compositor.gl;
					gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
					return Array.from(bytes);
				} finally { compositor.dispose(); }
			}, { base64: Buffer.from(input).toString('base64'), width, height, blockSize });
			for (let top = 0; top < height; top += blockSize) for (let left = 0; left < width; left += blockSize) {
				const endX = Math.min(width, left + blockSize), endY = Math.min(height, top + blockSize);
				let sum = 0;
				for (let y = top; y < endY; y++) for (let x = left; x < endX; x++) sum += input[(y * width + x) * 4]!;
				const expected = Math.floor(sum / ((endX - left) * (endY - top)));
				for (let y = top; y < endY; y++) for (let x = left; x < endX; x++) {
					const value = actual[((height - 1 - y) * width + x) * 4]!;
					assert.ok(Math.abs(value - expected) <= 1, `${width}x${height} block${left},${top} pixel${x},${y}: ${value} vs average${expected}`);
				}
			}
		}
	} finally { await browser.close(); }
});
