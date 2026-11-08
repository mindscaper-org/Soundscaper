/* SPDX-License-Identifier: AGPL-3.0-only */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { expect, test } from './audio-editor-test-fixtures.js';
import { requireNativeGpuCapabilityCurrentV1 } from './helpers/lightscaper-native-gpu-capability-current.ts';

test.use({ browserCoverage: false });
const ROOT = '/__corridorkey_decode__';

test('normal-keyer hint mattes match the preview shader at native resolution', async ({ page }) => {
	await requireNativeGpuCapabilityCurrentV1(page, test.info(), 'webgl2');
	const bundle = await build({ stdin: { contents: `
		export { VideoPreviewCompositor } from './src/common/editor/ui/video-preview-compositor.js';
		export { createChromaKeyMatte } from './src/common/editor/video-chroma-key.ts';`,
		resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, write: false, format: 'esm', platform: 'browser' });
	await page.route(`${ROOT}/**`, async (route) => {
		await route.fulfill(route.request().url().endsWith('.html')
			? { contentType: 'text/html', body: '<!doctype html><title>Normal keyer matte parity</title>' }
			: { contentType: 'text/javascript', body: bundle.outputFiles[0].text });
	});
	await page.goto(`${ROOT}/index.html`);
	const metrics = await page.evaluate(async (root) => {
		const { VideoPreviewCompositor, createChromaKeyMatte } = await import(`${root}/entry.js`);
		const width = 32, height = 24; const rgba = new Uint8Array(width * height * 4);
		for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
			rgba.set(x < 8 ? [0, 255, 0, 255] : x >= 24 ? [0, 0, 255, 255]
				: [x * 8, y * 10, (x + y) % 3 * 100, 255], (y * width + x) * 4);
		}
		const source = document.createElement('canvas'); source.width = width; source.height = height;
		Object.defineProperties(source, { videoWidth: { value: width }, videoHeight: { value: height }, readyState: { value: 4 } });
		source.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
		const output = document.createElement('canvas'); output.style.width = `${width}px`; output.style.height = `${height}px`;
		document.body.append(output); const compositor = new VideoPreviewCompositor(output);
		const results = [];
		try {
			for (const params of [{ keyColor: 0x00ff00, similarity: 0.1, softness: 0.1 },
				{ keyColor: 0x0000ff, similarity: 0.2, softness: 0.3 },
				{ keyColor: 0x00ff00, similarity: 0.01, softness: 0 },
				{ keyColor: 0xff0000, similarity: 1, softness: 1 }]) {
				const report = compositor.render([{ entries: [{ video: source, effects: [{ id: 'normal-keyer', type: 'chroma-key', enabled: true, params }], opacity: 1 }] }],
					{ referenceWidth: width, referenceHeight: height, backgroundColor: '#00000000', outputColorModel: 'rgba' });
				if (report.renderedEntryCount !== 1 || output.width !== width || output.height !== height) throw new Error('Invalid native shader fixture');
				const gl = compositor.gl; const pixels = new Uint8Array(rgba.length);
				gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
				const matte = createChromaKeyMatte({ width, height, rgba }, params);
				let maximumError = 0;
				for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
					maximumError = Math.max(maximumError, Math.abs(pixels[((height - 1 - y) * width + x) * 4 + 3] - Math.round(matte[y * width + x] * 255)));
				}
				results.push(maximumError);
			}
		} finally { compositor.dispose(); }
		return results;
	}, ROOT);
	expect(metrics).toHaveLength(4);
	for (const maximumError of metrics) expect(maximumError, JSON.stringify(metrics)).toBeLessThanOrEqual(1);
});
