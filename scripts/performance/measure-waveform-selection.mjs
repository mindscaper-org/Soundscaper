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
		export { acquireWaveformGpuRenderer } from './src/common/editor/controller/source/waveform-gpu-renderer.ts';
		export { createWaveformGpuDisplay } from './src/common/editor/design-system-adapters/waveform-gpu-display.ts';
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
		const updates = 20;
		const channels = Array.from({ length: 2 }, () => ({
			minimum: Float32Array.from({ length: 1_921 }, (_, x) => -0.2 - Math.abs(Math.sin(x)) * 0.6),
			maximum: Float32Array.from({ length: 1_921 }, (_, x) => 0.2 + Math.abs(Math.cos(x)) * 0.6),
			rms: new Float32Array(1_921).fill(0.2),
		}));
		const clip = { start: 0, duration: width, audacityWaveform: { mode: 'summary', pixelWidth: width, channels } };
		const style = { getPropertyValue: () => '' };
		const lease = globalThis.waveform.acquireWaveformGpuRenderer(document, () => document.createElement('canvas'), () => {}, globalThis.waveform.createWaveformGpuDisplay);
		for (const density of [1, 1.25, 1.5, 2]) {
			Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: density });
			const canvases = Array.from({ length: 3 }, () => document.createElement('canvas'));
			for (const canvas of canvases) {
				const parent = document.createElement('div');
				parent.style.cssText = `position:relative;width:${width}px;height:${height}px`;
				canvas.style.cssText = 'position:relative;z-index:2;width:100%;height:100%';
				parent.append(canvas); document.body.append(parent);
			}
			const batches = [[], [], []];
			const submissionBatches = [[], [], []];
			const draw = (index, update) => globalThis.waveform.drawAudacityClipCanvas(canvases[index], clip, {
				bounds: { width, height }, style, displayMode: 'waveform', showRms: true, pixelsPerSecond: 1,
				cacheSelectionLayers: index === 1, timeSelection: { startTime: 10.25 + update, endTime: 1_800.75 - update },
				waveformGpuRenderer: index === 2 ? lease : null,
			});
			// Exclude cold layer creation and alternate ordering to reduce warmup bias.
			for (let index = 0; index < 3; index++) draw(index, 0);
			for (let batch = 0; batch < 5; batch++) for (const index of batch % 2 ? [2, 1, 0] : [0, 1, 2]) {
				const start = performance.now();
				for (let update = 0; update < updates; update++) draw(index, update);
				submissionBatches[index].push(performance.now() - start);
				// Read a copy so measuring does not switch the owner to CPU rasterization.
				const readback = document.createElement('canvas');
				readback.width = canvases[index].width; readback.height = canvases[index].height;
				const context = readback.getContext('2d', { willReadFrequently: true });
				const gpu = canvases[index].parentElement.querySelector('.clip-body__waveform-gpu');
				if (gpu) context.drawImage(gpu, 0, 0);
				context.drawImage(canvases[index], 0, 0);
				context.getImageData(0, 0, readback.width, readback.height);
				batches[index].push(performance.now() - start);
				readback.width = 0; readback.height = 0;
			}
			const median = values => [...values].sort((a, b) => a - b)[2];
			const gl = canvases[2].parentElement.querySelector('.clip-body__waveform-gpu')?.getContext('webgl2');
			const debug = gl?.getExtension('WEBGL_debug_renderer_info');
			results.push({ density, width, height, updates, directMs: median(batches[0]), cachedMs: median(batches[1]),
				gpuMs: median(batches[2]), submissionMs: submissionBatches.map(median),
				gpuDevice: gl ? String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)) : null,
				gpuRenderer: canvases[2].dataset.waveformAcceleration, batchesMs: batches });
			for (const canvas of canvases) {
				globalThis.waveform.releaseWaveformSelectionLayers(canvas);
				lease.releaseOwner(canvas); canvas.parentElement.remove();
				canvas.width = 0; canvas.height = 0;
			}
		}
		lease.release();
		return results;
	});
	console.log(JSON.stringify({ browser: browser.version(), measurement: 'warm selection updates, draw submission plus readback', samples }, null, 2));
} finally { await browser.close(); }
