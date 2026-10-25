/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { videoRetimePreviewMedia } from './fixtures/video-retime-preview-media.js';

// Repository-owned Chromium MediaRecorder VP8 screen recording: 192x108 blue,
// 23 pictures, final end 771ms, no container Duration element.
const RECORDED_WEBM =
	'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';


async function expectBluePoster(card) {
	const poster = card.locator('[data-project-bin-video] img');
	await expect(poster).toBeVisible();
	await expect.poll(async () => poster.evaluate(image => {
		if (!image.complete || !image.naturalWidth || !image.naturalHeight) return false;
		const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
		const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
		const [red, green, blue, alpha] = context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
		return red < 16 && green < 16 && blue > 230 && alpha === 255;
	})).toBe(true);
}

test('Project Bin finishes importing a recorded WebM and restores its native blue poster after reload', async ({ page }) => {
	test.setTimeout(90_000);
	let editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles({
		name: 'Blue screen recording.webm', mimeType: 'video/webm', buffer: Buffer.from(RECORDED_WEBM, 'base64'),
	});
	let card = editor.getByRole('listitem', { name: 'Project bin: Blue screen recording', exact: true });
	await expect(card).toBeVisible({ timeout: 20_000 });
	await expectBluePoster(card);
	const projectId = await editor.getAttribute('data-project-id');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload();
	editor = await waitForEditor(page);
	await expect(editor).toHaveAttribute('data-project-id', projectId);
	await waitForProjectActivation(editor);
	card = editor.getByRole('listitem', { name: 'Project bin: Blue screen recording', exact: true });
	await expectBluePoster(card);
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	await expect(editor.getByRole('group', { name: /^Video clip: Blue screen recording/u })).toBeVisible();
	await expect(editor.getByRole('alert')).toHaveCount(0);
});


const ROOT = '/__framescaper-webm-preview-stall__';
const syntheticRouteTest = test.extend({ browserCoverage: false });
for (const kind of ['recorded WebM', 'finite WebM', 'ordinal MP4']) {
	syntheticRouteTest(`native extractor presents first and later timestamp pixels for ${kind}`, async ({ page }) => {
		const file = kind === 'recorded WebM'
			? { mimeType: 'video/webm', buffer: Buffer.from(RECORDED_WEBM, 'base64') }
			: kind === 'finite WebM' ? createDeterministicSilentVideoFixture('Finite screen.webm') : videoRetimePreviewMedia.file;
		const bundle = await build({
			entryPoints: [fileURLToPath(new URL('../../src/common/editor/video-media.js', import.meta.url))],
			bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
		});
		await page.route(`**${ROOT}/**`, async route => {
			const script = route.request().url().endsWith('/extractor.js');
			await route.fulfill({ contentType: script ? 'text/javascript' : 'text/html',
				body: script ? bundle.outputFiles[0].text : '<!doctype html><title>Native video poster capture</title>' });
		});
		await page.goto(`${ROOT}/index.html`);
		// Keep the MP4 control inside its green interval, away from the .085s
		// equidistant seek where native decoders choose different adjacent frames.
		const targets = kind === 'ordinal MP4' ? [0, .06, .235, .02] : [0, .4, .4, .7, 0];
		const result = await page.evaluate(async ({ root, bytes, mimeType, targets }) => {
			const { createAudioEditorVideoFrameExtractor } = await import(`${root}/extractor.js`);
			let nativeVideo;
			const revoked = [];
			const extractor = await createAudioEditorVideoFrameExtractor(new Blob([Uint8Array.from(bytes)], { type: mimeType }), {
				timeoutMs: 3_000,
				document: { body: document.body, createElement(name) {
					const element = document.createElement(name);
					if (name === 'video') nativeVideo = element;
					return element;
				} },
				urlApi: { createObjectURL: body => URL.createObjectURL(body),
					revokeObjectURL: url => { revoked.push(url); URL.revokeObjectURL(url); } },
			});
			const samples = [];
			try {
				for (const target of targets) {
					const frame = await extractor.capture(target, { mimeType: 'image/png', alpha: true });
					const image = await createImageBitmap(frame.blob);
					try {
						const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
						const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
						samples.push({ timestamp: frame.timestampSeconds, nativeTime: nativeVideo.currentTime,
							pixel: [...context.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data] });
					} finally { image.close(); }
				}
			} finally { extractor.dispose(); }
			return { samples, revoked: revoked.length, source: nativeVideo.getAttribute('src'), paused: nativeVideo.paused,
				mounted: document.body.contains(nativeVideo),
				duration: extractor.metadata.durationSeconds };
		}, { root: ROOT, bytes: [...file.buffer], mimeType: file.mimeType, targets });
		expect(Number.isFinite(result.duration) && result.duration > 0).toBe(true);
		expect(result.revoked).toBe(1); expect(result.source).toBeNull(); expect(result.paused).toBe(true);
		expect(result.mounted).toBe(false);
		for (const [index, sample] of result.samples.entries()) {
			expect(sample.timestamp).toBe(targets[index]);
			if (targets[index] > 0) expect(sample.nativeTime).toBeCloseTo(targets[index], 5);
			expect(sample.pixel[3]).toBe(255);
			expect(Math.max(...sample.pixel.slice(0, 3))).toBeGreaterThan(150);
		}
		if (kind === 'recorded WebM') for (const sample of result.samples) {
			expect(sample.pixel[0]).toBeLessThan(16); expect(sample.pixel[1]).toBeLessThan(16);
			expect(sample.pixel[2]).toBeGreaterThan(230);
		}
		if (kind === 'ordinal MP4') for (const [index, sample] of result.samples.entries()) {
			const expected = [[true, false, false], [false, true, false], [true, true, false], [true, false, false]][index];
			// Native decoders differ in limited/full-range color conversion. These
			// bounds still distinguish every authored red/green/yellow frame.
			for (const [channel, bright] of expected.entries()) {
				if (bright) expect(sample.pixel[channel]).toBeGreaterThan(180);
				else expect(sample.pixel[channel]).toBeLessThan(80);
			}
		}
	});
}
