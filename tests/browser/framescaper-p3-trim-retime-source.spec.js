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
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test('File Trim rebases an exact reversed video curve and Undo restores its original source coordinates', async ({ browserName, page }) => {
	test.skip(browserName === 'firefox', 'Playwright Firefox cannot import the routed cross-origin FFmpeg module worker.');
	test.setTimeout(180_000);
	const { bytes } = await p3TrimPreviewVideo();
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
		frameCount: 192_000, sampleRate: 48_000, sourceFrameCount: 100, frameRate: sequence.rate, width: 64, height: 32,
		videoCodec: 'h264', audioCodec: null, hasAudio: false, contentSha256: createHash('sha256').update(bytes).digest('hex'),
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: sequence.rate, reason: 'timing-probe-unavailable', failures: [] } });
	const clip = createVideoClip({ id: 'blue', title: 'Reversed blue', sourceId: source.id, sequenceId: sequence.id, sequenceStartFrame: 0,
		sequenceFrameCount: 25, sourceInFrame: 50, sourceFrameCount: 25 }, { projectSampleRate: 48_000, sequence, source });
	const project = createFramescaperProject(PROFILE, { id: 'p3-trim-retimed-blue', sequences: [sequence], primarySequenceId: sequence.id,
		sources: [source], clips: [{ ...clip, retimeMap: { feature: 'video-retime', version: 2,
			points: [{ outerFrame: 0, sourceFrame: { num: 75, den: 1 } }, { outerFrame: 25, sourceFrame: { num: 50, den: 1 } }],
			segments: [{ mode: 'constant-reverse' }] } }],
		tracks: [createVideoTrack({ id: 'video-track', sequenceId: sequence.id, clipIds: [clip.id] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let archive;
	try {
		await store.writeMediaAsset(source.storageKey, new Blob([bytes], { type: source.mimeType }), { mimeType: source.mimeType });
		archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store);
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	test.skip(!await page.evaluate(hasWebGl2Capability), 'Exact programme preview requires native WebGL2.');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Reversed.fscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
	await editor.getByRole('group', { name: 'Video clip: Reversed blue', exact: true }).press('Enter');
	await seekFramescaperTimecode(page, editor, '00:00:00:05'); await expectBlueFrame(editor);
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Trim media to what is used']);
	const expected = { sourceStart: 0, sourceFrames: 25, sequenceFrames: 25, points: [25, 0], direction: 'constant-reverse' };
	await expect.poll(() => savedGeometry(page, project.id), { timeout: 120_000 }).toEqual(expected);
	await expect(editor.locator('[data-status]')).toContainText('Media trimmed');
	await seekFramescaperTimecode(page, editor, '00:00:00:06'); await expectBlueFrame(editor);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(() => savedGeometry(page, project.id)).toEqual({ ...expected, sourceStart: 50, points: [75, 50] });
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(() => savedGeometry(page, project.id)).toEqual(expected);
	await seekFramescaperTimecode(page, editor, '00:00:00:07'); await expectBlueFrame(editor);
});

async function savedGeometry(page, id) {
	return page.evaluate(async ({ name, id }) => {
		const request = operation => new Promise((resolve, reject) => {
			operation.onsuccess = () => resolve(operation.result); operation.onerror = () => reject(operation.error);
		});
		const database = await request(indexedDB.open(name));
		try {
			const project = await request(database.transaction('projects', 'readonly').objectStore('projects').get(id));
			const clip = project?.clips.find(clip => clip.id === 'blue');
			return clip ? { sourceStart: clip.sourceInFrame, sourceFrames: clip.sourceFrameCount, sequenceFrames: clip.sequenceFrameCount,
				points: clip.retimeMap.points.map(point => point.sourceFrame.num / point.sourceFrame.den), direction: clip.retimeMap.segments[0].mode } : null;
		} finally { database.close(); }
	}, { name: FRAMESCAPER_DATABASE_NAME, id });
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
