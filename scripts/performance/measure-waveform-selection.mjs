/* SPDX-License-Identifier: AGPL-3.0-only */
// Browser draw submission plus readback timings; run on an otherwise idle host.
// node scripts/performance/measure-waveform-selection.mjs
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const bundled = await build({
	stdin: { contents: `
		export { drawAudacityClipCanvas } from './src/common/editor/ui/timeline/waveform-canvas-renderer.js';
		export { releaseWaveformSelectionLayers } from './src/common/editor/ui/timeline/waveform-selection-layers.ts';
	`, resolveDir: fileURLToPath(new URL('../..', import.meta.url)) },
	bundle: true, write: false, format: 'iife', globalName: 'waveform', target: 'es2022',
	external: ['./pffft.js'], loader: { '.css': 'empty' },
});
const browser = await chromium.launch();
try {
	const page = await browser.newPage();
	await page.addScriptTag({ content: bundled.outputFiles[0].text });
	const samples = await page.evaluate(() => {
		const results = [];
		const width = 1_920.25;
		const height = 160;
		const updates = 100;
		const channels = Array.from({ length: 2 }, () => ({
			minimum: Float32Array.from({ length: 1_921 }, (_, x) => -0.2 - Math.abs(Math.sin(x)) * 0.6),
			maximum: Float32Array.from({ length: 1_921 }, (_, x) => 0.2 + Math.abs(Math.cos(x)) * 0.6),
			rms: new Float32Array(1_921).fill(0.2),
		}));
		const clip = { start: 0, duration: width, audacityWaveform: { mode: 'summary', pixelWidth: width, channels } };
		const style = { getPropertyValue: () => '' };
		for (const density of [1, 1.25, 1.5, 2]) {
			Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: density });
			const canvases = [document.createElement('canvas'), document.createElement('canvas')];
			const batches = [[], []];
			const draw = (index, update) => globalThis.waveform.drawAudacityClipCanvas(canvases[index], clip, {
				bounds: { width, height }, style, displayMode: 'waveform', showRms: true, pixelsPerSecond: 1,
				cacheSelectionLayers: index === 1, timeSelection: { startTime: 10.25 + update, endTime: 1_800.75 - update },
			});
			// Exclude cold layer creation and alternate ordering to reduce warmup bias.
			for (let index = 0; index < 2; index++) draw(index, 0);
			for (let batch = 0; batch < 7; batch++) for (const index of batch % 2 ? [1, 0] : [0, 1]) {
				const start = performance.now();
				for (let update = 0; update < updates; update++) draw(index, update);
				canvases[index].getContext('2d').getImageData(0, 0, canvases[index].width, canvases[index].height);
				batches[index].push(performance.now() - start);
			}
			const median = values => [...values].sort((a, b) => a - b)[3];
			results.push({ density, width, height, updates, directMs: median(batches[0]), cachedMs: median(batches[1]), batchesMs: batches });
			for (const canvas of canvases) {
				globalThis.waveform.releaseWaveformSelectionLayers(canvas);
				canvas.width = 0; canvas.height = 0;
			}
		}
		return results;
	});
	console.log(JSON.stringify({ browser: browser.version(), measurement: 'warm selection updates, draw submission plus readback', samples }, null, 2));
} finally { await browser.close(); }
