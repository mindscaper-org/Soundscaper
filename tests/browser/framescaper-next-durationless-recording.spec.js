/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

// A real Chromium MediaRecorder VP8 recording with no container Duration element.
const RECORDED_WEBM =
	'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';

for (const fresh of [false, true]) test(`Project Bin imports a ${fresh ? 'fresh native' : 'captured'} screen recording with unknown native duration`, async ({ page, browserName }) => {
	test.skip(fresh && browserName !== 'chromium', 'Fresh VP8 MediaRecorder production is qualified in Chromium.');
	test.setTimeout(60_000);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const bytes = fresh ? Buffer.from(await recordScreen(page)) : Buffer.from(RECORDED_WEBM, 'base64');
	const duration = await nativeDuration(page, bytes);
	test.skip(duration !== 'Infinity', `This regression requires unknown native duration; ${browserName} reports ${duration}s. The pinned WebKit finite import also stalls with the original extractor; finite files have a separate control.`);
	await editor.locator('[data-project-bin-input]').setInputFiles({
		name: 'Screen recording.webm', mimeType: 'video/webm', buffer: bytes,
	});
	const card = editor.getByRole('listitem', { name: 'Project bin: Screen recording', exact: true });
	await expect(card).toBeVisible({ timeout: 30_000 });
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	await expect(editor.getByRole('group', { name: /^Video clip: Screen recording/u })).toBeVisible();
	await expect(editor.locator('[data-product-visual-thumbnail-canvas]').first()).toBeVisible();
	await expect(editor.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-visual-error', '');
});

test('Project Bin retains native finite-duration WebM import', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const file = createDeterministicSilentVideoFixture('Finite camera.webm');
	const duration = Number(await nativeDuration(page, file.buffer));
	expect(Number.isFinite(duration) && duration > 0).toBe(true);
	await editor.locator('[data-project-bin-input]').setInputFiles(file);
	const card = editor.getByRole('listitem', { name: 'Project bin: Finite camera', exact: true });
	await expect(card).toBeVisible();
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	await expect(editor.getByRole('group', { name: /^Video clip: Finite camera/u })).toBeVisible();
	await expect(editor.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-visual-error', '');
});

async function nativeDuration(page, bytes) {
	return page.evaluate(async data => {
		const video = document.createElement('video'); video.preload = 'metadata'; video.muted = true;
		const url = URL.createObjectURL(new Blob([Uint8Array.from(data)], { type: 'video/webm' }));
		try {
			await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; video.src = url; });
			return String(video.duration);
		} finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
	}, [...bytes]);
}

async function recordScreen(page) {
	return page.evaluate(async () => {
		const canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 108;
		const context = canvas.getContext('2d'), stream = canvas.captureStream(30), chunks = [];
		const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
		let frame = 0, animation = 0, timeout;
		const paint = () => {
			context.fillStyle = frame++ % 2 ? 'red' : 'blue'; context.fillRect(0, 0, 192, 108);
			animation = requestAnimationFrame(paint);
		};
		paint();
		try {
			await new Promise((resolve, reject) => {
				recorder.ondataavailable = event => {
					if (event.data.size) chunks.push(event.data);
					if (chunks.length === 6 && recorder.state === 'recording') recorder.stop();
				};
				recorder.onstop = resolve; recorder.onerror = reject;
				timeout = setTimeout(() => { reject(new Error('The fixture recorder did not produce six chunks.')); }, 10_000);
				recorder.start(100);
			});
		} finally {
			clearTimeout(timeout); cancelAnimationFrame(animation);
			if (recorder.state === 'recording') recorder.stop();
			stream.getTracks().forEach(track => track.stop());
		}
		const body = new Blob(chunks, { type: 'video/webm' }), url = URL.createObjectURL(body);
		const video = document.createElement('video'); video.preload = 'metadata'; video.muted = true;
		try {
			await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; video.src = url; });
			if (video.duration !== Infinity) throw new Error('The fresh MediaRecorder witness must have an unknown native duration.');
			return [...new Uint8Array(await body.arrayBuffer())];
		} finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
	});
}
