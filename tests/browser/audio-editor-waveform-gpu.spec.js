/* SPDX-License-Identifier: AGPL-3.0-only */
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

async function installGpuHarness(page) {
	const rendererModule = './src/common/editor/ui/timeline/waveform-canvas-renderer.js';
	const gpuModule = './src/common/editor/controller/source/waveform-gpu-renderer.ts';
	const displayModule = './src/common/editor/design-system-adapters/waveform-gpu-display.ts';
	const bundled = await build({
		stdin: { contents: `
			export { drawAudacityClipCanvas } from '${rendererModule}';
			export { acquireWaveformGpuRenderer } from '${gpuModule}';
			export { createWaveformGpuDisplay } from '${displayModule}';
		`, resolveDir: fileURLToPath(new URL('../..', import.meta.url)) },
		bundle: true, write: false, format: 'iife', globalName: 'gpuWaveform', target: 'es2022',
		external: ['./pffft.js'], loader: { '.css': 'empty' },
	});
	await page.addScriptTag({ content: bundled.outputFiles[0].text });
}

test('GPU summaries preserve waveform geometry and reuse uploads while selection moves', async ({ page }, testInfo) => {
	await installGpuHarness(page);
	const result = await page.evaluate(() => {
		const surfaces = [];
		let uploads = 0;
		const lease = globalThis.gpuWaveform.acquireWaveformGpuRenderer(document, () => {
			const canvas = document.createElement('canvas'); surfaces.push(canvas);
			const getContext = canvas.getContext.bind(canvas);
			canvas.getContext = (kind, options) => {
				const context = getContext(kind, options);
				if (kind === 'webgl2' && context && !context.__counted) {
					const bufferData = context.bufferData.bind(context);
					context.bufferData = (...args) => { uploads++; return bufferData(...args); };
					context.__counted = true;
				}
				return context;
			};
			return canvas;
		}, () => {});
		const failures = [];
		let gpuDraws = 0;
		let available;
		const palette = { '--clip-blue-waveform': '#123456', '--clip-blue-time-selection-waveform': '#345612',
			'--clip-blue-waveform-rms': '#6789ab', '--clip-blue-time-selection-waveform-rms': '#89ab67',
			'--clip-blue-divider': '#101010', '--clip-blue-time-selection-body': 'rgba(240,230,220,0.15)' };
		const style = { getPropertyValue: property => palette[property] || '' };
		const channels = [{ minimum: Float32Array.from({ length: 163 }, (_, x) => x < 16 ? 0 : -0.1 - (x % 7) / 10),
			maximum: Float32Array.from({ length: 163 }, (_, x) => x < 16 ? 0 : 0.1 + (x % 5) / 8),
			rms: Float32Array.from({ length: 163 }, (_, x) => x < 16 ? 0 : 0.2) }];
		let warmUploads = 0;
		try {
			for (const density of [1, 1.25, 1.5, 2]) for (const width of [163, 163.5]) {
				Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: density });
				for (const halfWave of [false, true]) for (const showRms of [false, true]) for (const waveformRulerFormat of ['linear-db', 'logarithmic-db']) {
					const clip = { start: 0, duration: width, audacityWaveform: { mode: 'summary', pixelWidth: width,
						channels: width === 163 ? channels : [...channels, ...channels],
						envelope: [{ frame: 0, value: 0.5 }, { frame: 163, value: 1 }], durationFrames: 163, startFrame: 0, frameCount: 163 } };
					const direct = document.createElement('canvas'); const gpu = document.createElement('canvas');
					const options = { bounds: { width, height: 80 }, displayMode: 'waveform', pixelsPerSecond: 1,
						style, halfWave, showRms, waveformRulerFormat, cacheSelectionLayers: false, verticalZoom: 1, channelHeightRatio: 0.7 };
					let before = 0;
					for (const [startTime, endTime] of [[0, width], [2.25, 81.5], [0.25, 1.5], [0, 0]]) {
						const selection = { ...options, timeSelection: { startTime, endTime } };
						globalThis.gpuWaveform.drawAudacityClipCanvas(direct, clip, selection);
						globalThis.gpuWaveform.drawAudacityClipCanvas(gpu, clip, { ...selection, waveformGpuRenderer: lease });
						gpuDraws += Number(gpu.dataset.waveformAcceleration === 'webgl2');
						const expected = direct.getContext('2d').getImageData(0, 0, direct.width, direct.height).data;
						const actual = gpu.getContext('2d').getImageData(0, 0, gpu.width, gpu.height).data;
						let maximumError = 0;
						let worstPixel = null;
						for (let byte = 0; byte < expected.length; byte++) {
							// Compare visible premultiplied color; unpremultiplication amplifies
							// one-byte native rounding at partially covered boundary pixels.
							const alpha = byte - byte % 4 + 3;
							const reference = byte % 4 === 3 ? expected[byte] : expected[byte] * expected[alpha] / 255;
							const value = byte % 4 === 3 ? actual[byte] : actual[byte] * actual[alpha] / 255;
							if (Math.abs(reference - value) > maximumError) {
								maximumError = Math.abs(reference - value);
								const offset = byte - byte % 4;
								worstPixel = { x: offset / 4 % direct.width, y: Math.floor(offset / 4 / direct.width),
									expected: Array.from(expected.slice(offset, offset + 4)), actual: Array.from(actual.slice(offset, offset + 4)) };
							}
						}
						// Selection, peak and RMS each cross an eight-bit native blend.
						if (maximumError > 3) failures.push({ density, width, halfWave, showRms, waveformRulerFormat, startTime, maximumError, worstPixel });
						if (startTime === 0 && endTime === width) before = uploads;
					}
					warmUploads += uploads - before;
				}
			}
			available = Boolean(surfaces[0].getContext('webgl2'));
		} finally { lease.release(); }
		return { failures, available, gpuDraws, warmUploads, released: surfaces.every(canvas => canvas.width === 0 && canvas.height === 0) };
	});
	await testInfo.attach('gpu-waveform-parity.json', { body: JSON.stringify(result), contentType: 'application/json' });
	expect(result.failures).toEqual([]);
	if (result.available || testInfo.project.name === 'chromium') expect(result.gpuDraws).toBe(256);
	expect(result.warmUploads).toBe(0);
	expect(result.released).toBe(true);
});

test('GPU selection backgrounds cover narrow physical spans consistently', async ({ page }) => {
	await installGpuHarness(page);
	const failures = await page.evaluate(() => {
		const lease = globalThis.gpuWaveform.acquireWaveformGpuRenderer(document, () => document.createElement('canvas'), () => {});
		const failures = [];
		const channel = { minimum: new Float32Array(10), maximum: new Float32Array(10), rms: null };
		const clip = { start: 0, duration: 10, audacityWaveform: { mode: 'summary', pixelWidth: 10, channels: [channel] } };
		try {
			for (const density of [1, 1.25, 1.5, 2]) {
				Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: density });
				const canvas = document.createElement('canvas');
				globalThis.gpuWaveform.drawAudacityClipCanvas(canvas, clip, { bounds: { width: 10, height: 80 },
					displayMode: 'waveform', pixelsPerSecond: 1, waveformGpuRenderer: lease,
					style: { getPropertyValue: key => key.endsWith('time-selection-body') ? 'rgba(240,230,220,0.15)' : '' },
					timeSelection: { startTime: 0.25, endTime: 0.5 } });
				if (canvas.dataset.waveformAcceleration !== 'webgl2') continue;
				const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, 1).data;
				const ratio = canvas.width / 10;
				for (let x = 0; x < canvas.width; x++) {
					const coverage = Math.max(0, Math.min(x + 1, 0.5 * ratio) - Math.max(x, 0.25 * ratio));
					if (Math.abs(pixels[x * 4 + 3] - coverage * 0.15 * 255) > 1) failures.push({ density, x, coverage });
				}
			}
		} finally { lease.release(); }
		return failures;
	});
	expect(failures).toEqual([]);
});

test('unavailable GPU keeps the retained Canvas selection fast path', async ({ page }) => {
	await installGpuHarness(page);
	const result = await page.evaluate(() => {
		let reads = 0;
		const values = new Proxy(new Float32Array(1_000).fill(0.5), { get(target, key) {
			if (typeof key === 'string' && /^\d+$/u.test(key)) reads++;
			return Reflect.get(target, key, target);
		} });
		const canvas = document.createElement('canvas');
		const clip = { start: 0, duration: 1_000, audacityWaveform: { mode: 'summary', pixelWidth: 1_000, channels: [{ minimum: values, maximum: values }] } };
		const options = { bounds: { width: 1_000, height: 80 }, displayMode: 'waveform', pixelsPerSecond: 1,
			style: { getPropertyValue: () => '' }, waveformGpuRenderer: { drawFrame: () => false } };
		globalThis.gpuWaveform.drawAudacityClipCanvas(canvas, clip, { ...options, timeSelection: { startTime: 1, endTime: 900 } });
		reads = 0;
		globalThis.gpuWaveform.drawAudacityClipCanvas(canvas, clip, { ...options, timeSelection: { startTime: 2.25, endTime: 899.75 } });
		return { reads, mode: canvas.dataset.waveformAcceleration };
	});
	expect(result.mode).toBe('canvas');
	expect(result.reads).toBeLessThanOrEqual(24);
});

test('GPU context loss falls back to Canvas and restoration rebuilds geometry', async ({ page }) => {
	await installGpuHarness(page);
	const result = await page.evaluate(async () => {
		const surfaces = [];
		let invalidations = 0;
		const lease = globalThis.gpuWaveform.acquireWaveformGpuRenderer(document, () => {
			const canvas = document.createElement('canvas'); surfaces.push(canvas); return canvas;
		}, () => { invalidations++; });
		const owner = document.createElement('canvas');
		const clip = { start: 0, duration: 100, audacityWaveform: { mode: 'summary', pixelWidth: 100,
			channels: [{ minimum: new Float32Array(100).fill(-0.5), maximum: new Float32Array(100).fill(0.5), rms: null }] } };
		const options = { bounds: { width: 100, height: 80 }, style: { getPropertyValue: () => '' },
			displayMode: 'waveform', pixelsPerSecond: 1, waveformGpuRenderer: lease };
		try {
			globalThis.gpuWaveform.drawAudacityClipCanvas(owner, clip, options);
			const gl = surfaces[0].getContext('webgl2');
			const extension = gl?.getExtension('WEBGL_lose_context');
			if (!extension) return { unavailable: true };
			const lost = new Promise(resolve => surfaces[0].addEventListener('webglcontextlost', resolve, { once: true }));
			extension.loseContext(); await lost;
			await new Promise(requestAnimationFrame);
			globalThis.gpuWaveform.drawAudacityClipCanvas(owner, clip, options);
			const fallback = owner.dataset.waveformAcceleration;
			const visible = owner.getContext('2d').getImageData(50, 40, 1, 1).data[3] > 0;
			const restored = new Promise(resolve => surfaces[0].addEventListener('webglcontextrestored', resolve, { once: true }));
			extension.restoreContext(); await restored;
			globalThis.gpuWaveform.drawAudacityClipCanvas(owner, clip, options);
			return { fallback, visible, restored: owner.dataset.waveformAcceleration, invalidations };
		} finally { lease.release(); }
	});
	if (!result.unavailable) expect(result).toEqual({ fallback: 'canvas', visible: true, restored: 'webgl2', invalidations: 2 });
});

test('direct GPU displays keep both channels visible without copying into the 2D canvas', async ({ page }) => {
	await installGpuHarness(page);
	const result = await page.evaluate(() => {
		const parent = document.createElement('div'); parent.style.cssText = 'position:relative;width:100px;height:80px';
		const owner = document.createElement('canvas'); parent.append(owner); document.body.append(parent);
		const context = owner.getContext('2d');
		let copies = 0;
		const drawImage = context.drawImage.bind(context);
		context.drawImage = (...args) => { copies++; return drawImage(...args); };
		const lease = globalThis.gpuWaveform.acquireWaveformGpuRenderer(document, () => document.createElement('canvas'), () => {}, globalThis.gpuWaveform.createWaveformGpuDisplay);
		try {
			const channel = { minimum: new Float32Array(100).fill(-0.5), maximum: new Float32Array(100).fill(0.5), rms: null };
			const clip = { start: 0, duration: 100, audacityWaveform: { mode: 'summary', pixelWidth: 100, channels: [channel, channel] } };
			globalThis.gpuWaveform.drawAudacityClipCanvas(owner, clip, { bounds: { width: 100, height: 80 },
				displayMode: 'waveform', pixelsPerSecond: 1, waveformGpuRenderer: lease, style: { getPropertyValue: () => '' } });
			const display = parent.querySelector('.clip-body__waveform-gpu');
			const gl = display?.getContext('webgl2');
			if (!gl) return { unavailable: true };
			const alphas = [20, 60].map(y => {
				const pixel = new Uint8Array(4); gl.readPixels(50, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); return pixel[3];
			});
			const mode = owner.dataset.waveformAcceleration;
			lease.releaseOwner(owner);
			return { copies, alphas, mode, removed: parent.querySelector('.clip-body__waveform-gpu') === null };
		} finally { lease.release(); parent.remove(); }
	});
	if (!result.unavailable) expect(result).toEqual({ copies: 0, alphas: [255, 255], mode: 'webgl2', removed: true });
});

test('Advanced preferences enable GPU rendering and persist the menu choice', async ({ page }) => {
	test.setTimeout(60_000);
	const available = await page.evaluate(() => {
		const gl = document.createElement('canvas').getContext('webgl2');
		gl?.getExtension('WEBGL_lose_context')?.loseContext();
		return Boolean(gl);
	});
	const acceleration = available ? 'webgl2' : 'canvas';
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const waveform = clipByName(editor, toneA.name).locator('canvas.clip-body__waveform');
	await expect(waveform).toHaveAttribute('data-waveform-acceleration', 'canvas');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await dialog.getByRole('tab', { name: /Track display$/u }).click();
	await expect(dialog.getByRole('button', { name: /Waveform renderer/u })).toHaveCount(0);
	await dialog.getByRole('tab', { name: /Advanced$/u }).click();
	await dialog.getByRole('button', { name: /Waveform renderer/u }).click();
	await page.getByRole('option', { name: 'GPU (Canvas fallback)', exact: true }).click();
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(waveform).toHaveAttribute('data-waveform-acceleration', acceleration);
	if (available) await expect(clipByName(editor, toneA.name).locator('.clip-body__waveform-gpu')).toBeVisible();
	await page.reload();
	const reloaded = await bootEditor(page, '/embed/en/');
	await expect(clipByName(reloaded, toneA.name).locator('canvas.clip-body__waveform')).toHaveAttribute('data-waveform-acceleration', acceleration);
	await chooseCommandAction(page, reloaded, 'Edit', 'Preferences');
	await dialog.getByRole('tab', { name: /Advanced$/u }).click();
	await expect(dialog.getByRole('button', { name: /Waveform renderer/u })).toContainText('GPU (Canvas fallback)');
	await dialog.getByRole('button', { name: /Waveform renderer/u }).click();
	await page.getByRole('option', { name: 'Canvas', exact: true }).click();
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(clipByName(reloaded, toneA.name).locator('canvas.clip-body__waveform')).toHaveAttribute('data-waveform-acceleration', 'canvas');
	await expect(clipByName(reloaded, toneA.name).locator('.clip-body__waveform-gpu')).toHaveCount(0);
	await page.reload();
	const canvasEditor = await bootEditor(page, '/embed/en/');
	await expect(clipByName(canvasEditor, toneA.name).locator('canvas.clip-body__waveform')).toHaveAttribute('data-waveform-acceleration', 'canvas');
});
