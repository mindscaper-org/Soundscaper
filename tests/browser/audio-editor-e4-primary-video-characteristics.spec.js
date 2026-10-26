/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors } from './audio-editor-test-helpers.js';
import { openFramescaperSourcePropertiesFromBin } from './helpers/framescaper-source-properties.js';
import { primaryVideoTrackFixture } from './fixtures/primary-video-track-fixture.ts';

for (const variant of ['first', 'second', 'single']) {
	test(`source facts disclose ${variant === 'single' ? 'exact single-video facts' : `ambiguous ${variant}-default video`}`, async ({ page }, testInfo) => {
		const file = primaryVideoTrackFixture(variant);
		const buffer = Buffer.from(await file.arrayBuffer());
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		const errors = collectClientErrors(page);
		// Native decoders select different video tracks. Observe the actual presented
		// picture independently before inspecting the application's source facts.
		const native = await page.evaluate(async base64 => {
			const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
			const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
			const video = document.createElement('video');
			video.muted = true;
			video.preload = 'auto';
			video.style.cssText = 'position:fixed;top:0;left:0;width:64px;height:64px;opacity:0;pointer-events:none';
			document.body.append(video);
			try {
				const ready = new Promise((resolve, reject) => {
					video.onloadeddata = resolve;
					video.onerror = () => reject(new Error('Native video decode failed'));
				});
				video.src = url;
				await ready;
				const presented = new Promise(resolve => video.requestVideoFrameCallback(resolve));
				await video.play();
				await presented;
				video.pause();
				const canvas = document.createElement('canvas');
				canvas.width = video.videoWidth;
				canvas.height = video.videoHeight;
				const context = canvas.getContext('2d');
				context.drawImage(video, 0, 0);
				return { width: video.videoWidth, height: video.videoHeight, pixel: [...context.getImageData(0, 0, 1, 1).data] };
			} finally {
				video.pause();
				video.removeAttribute('src');
				video.load();
				video.remove();
				URL.revokeObjectURL(url);
			}
		}, buffer.toString('base64'));
		const blue = native.width === 64 && native.height === 32;
		const red = native.width === 32 && native.height === 64;
		expect(blue || (variant === 'second' && red)).toBe(true);
		await testInfo.attach('native-video-track', { body: JSON.stringify(native), contentType: 'application/json' });
		// Untagged H264 colour conversion differs by decoder. Retain the original
		// decisive blue/red pixel bounds without claiming lossless RGB encoding.
		expect(native.pixel[blue ? 2 : 0]).toBeGreaterThan(180);
		expect(native.pixel[blue ? 0 : 2]).toBeLessThan(40);
		expect(native.pixel[3]).toBe(255);
		await editor.locator('[data-project-bin-input]').setInputFiles({ name: `Video ${variant}.mp4`, mimeType: 'video/mp4', buffer });
		await expect(editor.getByRole('listitem', { name: `Project bin: Video ${variant}`, exact: true })).toBeVisible({ timeout: 30_000 });
		const properties = await openFramescaperSourcePropertiesFromBin(page, editor, `Video ${variant}`);
		await expect(properties.locator('[data-source-property="Display size"] dd')).toHaveText(`${native.width} × ${native.height}`);
		await expect(properties.locator('[data-source-property="Coded size"] dd')).toHaveText(variant === 'single' ? '64 × 32' : 'Unknown');
		if (variant === 'single') {
			await expect(properties.locator('[data-source-property="Video codec"] dd')).toHaveText('h264');
			await expect(properties.locator('[data-source-property="Pixel aspect ratio"] dd')).toHaveText('1:1');
		} else {
			for (const label of ['Coded size', 'Video codec', 'Rotation', 'Pixel aspect ratio', 'Field order', 'Alpha channel', 'Colour']) {
				const value = properties.locator(`[data-source-property="${label}"] dd`);
				await expect(value).toHaveText('Unknown');
				await expect(value).toHaveAttribute('data-reported', 'false');
			}
			await expect(properties.locator('[data-source-reconciliation]')).toHaveText('unreported');
		}
		expect(errors).toEqual([]);
	});
}
