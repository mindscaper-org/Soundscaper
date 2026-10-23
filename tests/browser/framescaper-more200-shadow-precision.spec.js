/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';

test('File Open frozen PNG retains dark source pixels through an identity exact presentation', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__shadowFrames = [];
		const put = CanvasRenderingContext2D.prototype.putImageData;
		CanvasRenderingContext2D.prototype.putImageData = function (...args) {
			const result = Reflect.apply(put, this, args), image = args[0];
			if (image.width >= 100 && image.width <= 3840 && image.height >= 50 && image.height <= 2160 && image.data[3] === 255) {
				globalThis.__shadowFrames.push({ width: image.width, height: image.height, pixels: Array.from(image.data.slice(0, 256)) });
			}
			return result;
		};
	});
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	test.skip(!await page.evaluate(hasWebGl2Capability), 'The exact frozen image preview requires WebGL2.');
	const png = await page.evaluate(() => {
		const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
		const context = canvas.getContext('2d'); context.fillStyle = 'rgb(4 4 4)'; context.fillRect(0, 0, 1280, 720);
		return canvas.toDataURL('image/png').split(',')[1];
	});
	const bytes = Buffer.from(png, 'base64'), storageKey = randomUUID();
	const mask = { schemaVersion: 1, id: 'full-mask', kind: 'mask', inputs: [],
		nodes: [{ id: 'rectangle', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }], outputNodeId: 'rectangle' };
	const project = createFramescaperProject(PROFILE, { id: 'frozen-sampling', primarySequenceId: 'main',
		visualModel: { maskMattes: [mask], stillSources: [{ schemaVersion: 1, kind: 'still', id: 'plate', name: 'Frozen detail',
			mimeType: 'image/png', storageKey, contentSha256: createHash('sha256').update(bytes).digest('hex'), width: 1280, height: 720, hasAlpha: false }] },
		clips: [{ schemaVersion: 1, kind: 'still', id: 'frozen', sourceId: 'plate', sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 30 }],
		finishing: { colorContexts: [{ schemaVersion: 1, sequenceId: 'main', workingSpace: 'linear-rec709-d65', outputSpace: 'srgb', alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none' }], visualPresentations: [{ schemaVersion: 1, id: 'view', owner: { kind: 'clip', id: 'frozen' }, enabled: true,
			opacity: 1, blendMode: 'normal', grade: null, processorStackId: null, maskMatteIds: [mask.id] }] },
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['frozen'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }] });
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
	let archive;
	try {
		await store.writeMediaAsset(storageKey, new Blob([bytes], { type: 'image/png' }), { name: 'Frozen.png', mimeType: 'image/png' });
		archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store);
	} finally { await store.close(); }
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Frozen.fscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	await expect(editor.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-renderer', 'ready', { timeout: 30_000 });
	await expect.poll(() => page.evaluate(() => globalThis.__shadowFrames.length)).toBeGreaterThan(0);
	const frame = await page.evaluate(() => globalThis.__shadowFrames.at(-1));
	const oracle = await page.evaluate(async ({ png, width, height }) => {
		const bytes = Uint8Array.from(atob(png), character => character.charCodeAt(0));
		const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
		try {
			const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
			const context = canvas.getContext('2d'); context.imageSmoothingEnabled = false;
			context.drawImage(bitmap, 0, 0, width, height); return Array.from(context.getImageData(0, 0, 64, 1).data);
		} finally { bitmap.close(); }
	}, { png, width: frame.width, height: frame.height });
	// An identity sRGB presentation must retain the original PNG's dark pixels.
	expect(oracle.slice(0, 4)).toEqual([4, 4, 4, 255]); expect(frame.pixels).toEqual(oracle);
});
