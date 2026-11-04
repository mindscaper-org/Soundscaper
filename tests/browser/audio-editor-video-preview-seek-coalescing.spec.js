/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

import { expect, test } from './audio-editor-test-fixtures.js';
import { videoRetimePreviewMedia } from './fixtures/video-retime-preview-media.js';

const ROOT = '/__video-preview-seek-coalescing__';
const mediaTest = test.extend({ browserCoverage: false });

mediaTest('rapid preview seeks decode only the first and latest targets and preserve the final picture', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'The ordinal H264 fixture has focused Chromium decoder qualification.');
	const bundle = await build({
		stdin: {
			contents: "export { synchronizeVideoPreviewMedia } from './src/common/editor/ui/workspace/video-preview-retime.ts';",
			resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
		},
		bundle: true, write: false, format: 'esm', target: 'es2022',
	});
	await page.route(`**${ROOT}/**`, async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith('/seek.js')) {
			await route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
		} else if (path.endsWith('/ordinal.mp4')) {
			await route.fulfill({ contentType: 'video/mp4', body: videoRetimePreviewMedia.file.buffer });
		} else {
			await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Preview seeking</title>' });
		}
	});
	await page.goto(`${ROOT}/index.html`);
	const result = await page.evaluate(async (root) => {
		const { synchronizeVideoPreviewMedia } = await import(`${root}/seek.js`);
		const video = document.createElement('video');
		video.muted = true;
		video.playsInline = true;
		document.body.append(video);
		const sourceUrl = URL.createObjectURL(await (await fetch(`${root}/ordinal.mp4`)).blob());
		await new Promise((resolve, reject) => {
			video.addEventListener('loadeddata', resolve, { once: true });
			video.addEventListener('error', () => reject(new Error('Ordinal fixture failed to load.')), { once: true });
			video.src = sourceUrl;
		});
		const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
		const assignments = [];
		Object.defineProperty(video, 'currentTime', {
			get() { return descriptor.get.call(this); },
			set(value) { assignments.push(value); descriptor.set.call(this, value); },
		});
		try {
			const finalTarget = 0.165;
			const started = performance.now();
			await new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					video.removeEventListener('seeked', complete);
					reject(new Error(`Latest preview seek did not complete: ${JSON.stringify({ time: video.currentTime, seeking: video.seeking, assignments })}`));
				}, 5_000);
				function complete() {
					if (video.seeking || Math.abs(video.currentTime - finalTarget) > 0.000001) return;
					clearTimeout(timeout);
					video.removeEventListener('seeked', complete);
					resolve();
				}
				video.addEventListener('seeked', complete);
				for (let index = 0; index < 100; index += 1) {
					synchronizeVideoPreviewMedia(video, {
						sourceTimeSeconds: index === 99 ? finalTarget : index % 2 === 0 ? 0.085 : 0.235,
					}, 1, 'stopped');
				}
			});
			const canvas = document.createElement('canvas');
			canvas.width = video.videoWidth;
			canvas.height = video.videoHeight;
			const context = canvas.getContext('2d');
			context.drawImage(video, 0, 0);
			return {
				assignments, finalTime: video.currentTime, elapsedMs: performance.now() - started,
				pixel: [...context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data],
			};
		} finally {
			video.pause();
			video.removeAttribute('src');
			video.load();
			video.remove();
			URL.revokeObjectURL(sourceUrl);
		}
	}, ROOT);
	expect(result.assignments).toEqual([0.085, 0.165]);
	expect(result.finalTime).toBeCloseTo(0.165, 6);
	expect(result.pixel[0]).toBeLessThan(50);
	expect(result.pixel[1]).toBeLessThan(50);
	expect(result.pixel[2]).toBeGreaterThan(200);
	expect(result.pixel[3]).toBe(255);
});
