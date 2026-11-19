/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { createVideoSource, createVideoClip, createVideoTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { p3TrimPreviewVideo } from '../helpers/p3-trim-preview-video.ts';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';

async function openTrimVideoProject(page, editor, bytes, { title, sourceInFrame, sourceFrameCount, height }) {
	const core = new Map(await Promise.all(['ffmpeg-core.js', 'ffmpeg-core.wasm'].map(async name => [name, {
		body: await readFile(new URL(`../../node_modules/@ffmpeg/core/dist/esm/${name}`, import.meta.url)),
		contentType: name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
	}])));
	await page.context().route('https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/**', async route => {
		const descriptor = core.get(new URL(route.request().url()).pathname.split('/').at(-1));
		if (!descriptor) return route.abort();
		await route.fulfill({ ...descriptor, headers: { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' } });
	});
	const sequence = { id: 'main', rate: { num: 25, den: 1 } };
	const source = createVideoSource({ id: 'four-colours', storageKey: 'four-colours', mimeType: 'video/mp4', name: 'Four colours.mp4',
		frameCount: 192_000, sampleRate: 48_000, sourceFrameCount: 100, frameRate: sequence.rate, width: 64, height,
		videoCodec: 'h264', audioCodec: null, hasAudio: false,
		contentSha256: createHash('sha256').update(bytes).digest('hex'),
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: sequence.rate, reason: 'timing-probe-unavailable', failures: [] } });
	const clip = createVideoClip({ id: 'excerpt', title, sourceId: source.id, sequenceId: sequence.id, sequenceStartFrame: 0,
		sequenceFrameCount: sourceFrameCount, sourceInFrame, sourceFrameCount }, { projectSampleRate: 48_000, sequence, source });
	const project = createFramescaperProject(PROFILE, { id: 'p3-trim-blue', sequences: [sequence], primarySequenceId: sequence.id,
		sources: [source], clips: [clip], tracks: [createVideoTrack({ id: 'video-track', sequenceId: sequence.id, clipIds: [clip.id] })],
		projectBin: { clips: [{ ...clip, id: 'blue-bin', binItemId: 'blue-bin' }] } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let archive;
	try {
		await store.writeMediaAsset(source.storageKey, new Blob([bytes], { type: source.mimeType }), { mimeType: source.mimeType });
		archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store);
	} finally { await store.close(); }
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Excerpt.fscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
	const card = editor.getByRole('listitem', { name: `Project bin: ${title}`, exact: true });
	await card.locator('[data-bin-action="source-monitor"]').click();
	const monitor = editor.locator('[data-source-monitor]');
	const monitorVideo = monitor.locator('video');
	await expect.poll(() => monitorVideo.evaluate(video => video.readyState)).toBeGreaterThan(1);
	return { monitor, monitorVideo };
}

test('Trim media and its Undo keep the native blue recording picture unchanged', async ({ browserName, page }) => {
	test.skip(browserName === 'firefox', 'Playwright Firefox cannot import the routed cross-origin FFmpeg module worker.');
	test.setTimeout(180_000);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	test.skip(!await page.evaluate(hasWebGl2Capability), 'Exact programme preview requires native WebGL2.');
	const { bytes } = await p3TrimPreviewVideo();
	const { monitorVideo } = await openTrimVideoProject(page, editor, bytes, {
		title: 'Blue picture', sourceInFrame: 50, sourceFrameCount: 25, height: 32,
	});
	const originalUrl = await monitorVideo.getAttribute('src');
	expect(await monitorVideo.evaluate(video => video.duration)).toBeCloseTo(4, 2);
	const recording = editor.getByRole('group', { name: 'Video clip: Blue picture', exact: true });
	await recording.press('Enter');
	await seekFramescaperTimecode(page, editor, '00:00:00:05');
	await expectBlueFrame(editor);
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Trim media to what is used']);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 120_000 });
	await expect(editor.locator('[data-status]')).toContainText('Media trimmed', { timeout: 120_000 });
	await expect(monitorVideo).not.toHaveAttribute('src', originalUrl);
	await expect.poll(() => monitorVideo.evaluate(video => video.readyState > 1 && Math.abs(video.duration - 1) < .01)).toBe(true);
	await seekFramescaperTimecode(page, editor, '00:00:00:06');
	await expectBlueFrame(editor);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(() => monitorVideo.evaluate(video => video.readyState > 1 && Math.abs(video.duration - 4) < .01)).toBe(true);
	await seekFramescaperTimecode(page, editor, '00:00:00:07');
	await expectBlueFrame(editor);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(() => monitorVideo.evaluate(video => video.readyState > 1 && Math.abs(video.duration - 1) < .01)).toBe(true);
	await seekFramescaperTimecode(page, editor, '00:00:00:08');
	await expectBlueFrame(editor);
});

test('Trim media keeps the last requested picture with reordered H.264 frames', async ({ browserName, page }) => {
	test.skip(browserName !== 'chromium', 'The routed encoded-picture comparison runs in Chromium.');
	test.setTimeout(120_000);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const { bytes } = await p3TrimPreviewVideo('reordered');
	const { monitor, monitorVideo } = await openTrimVideoProject(page, editor, bytes, {
		title: 'Inter-frame excerpt', sourceInFrame: 25, sourceFrameCount: 7, height: 64,
	});
	const before = await sourcePicture(monitor, monitorVideo, 31, 1.25);
	const originalUrl = await monitorVideo.getAttribute('src');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Trim media to what is used']);
	await expect(editor.locator('[data-status]')).toContainText('Media trimmed', { timeout: 90_000 });
	await expect(monitorVideo).not.toHaveAttribute('src', originalUrl);
	expect(await sourcePicture(monitor, monitorVideo, 6, .25)).toBe(before);
	expect(await monitorVideo.evaluate(video => video.duration)).toBeCloseTo(1, 2);
});

async function sourcePicture(monitor, video, ordinal, seconds) {
	await monitor.getByRole('slider').fill(String(ordinal));
	await expect(monitor).toHaveAttribute('data-source-monitor-frame', String(ordinal));
	await expect.poll(() => video.evaluate((element, time) => (
		!element.seeking && element.readyState > 1 && Math.abs(element.currentTime - time) < .001
	), seconds)).toBe(true);
	return video.evaluate(async element => {
		const canvas = document.createElement('canvas');
		canvas.width = element.videoWidth;
		canvas.height = element.videoHeight;
		const context = canvas.getContext('2d');
		context.drawImage(element, 0, 0);
		const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
		const digest = await crypto.subtle.digest('SHA-256', pixels);
		return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
	});
}

async function expectBlueFrame(editor) {
	const canvas = editor.locator('[data-video-preview-canvas]');
	await expect(canvas).toBeVisible();
	await expect.poll(async () => {
		const png = (await canvas.screenshot()).toString('base64');
		return canvas.evaluate(async (_element, encoded) => {
			const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), character => character.charCodeAt(0))], { type: 'image/png' }));
			try {
				const sample = document.createElement('canvas'); sample.width = sample.height = 1;
				const context = sample.getContext('2d');
				context.drawImage(bitmap, Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1, 0, 0, 1, 1);
				const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
				return red < 40 && green < 40 && blue > 200 && alpha === 255;
			} finally { bitmap.close(); }
		}, png);
	}).toBe(true);
}
