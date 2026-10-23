/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';

test('File Open frozen PNG samples source pixel centres while reducing resolution', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__stillSampleFrames = [];
		const put = CanvasRenderingContext2D.prototype.putImageData;
		CanvasRenderingContext2D.prototype.putImageData = function (...args) {
			const result = Reflect.apply(put, this, args), image = args[0];
			if (image.width >= 100 && image.width < 3840 && image.height >= 50 && image.height < 2160 && image.data[3] === 255) {
				globalThis.__stillSampleFrames.push({ width: image.width, height: image.height, pixels: Array.from(image.data.slice(0, 256)) });
			}
			return result;
		};
	});
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	test.skip(!await page.evaluate(hasWebGl2Capability), 'The exact frozen image preview requires WebGL2.');
	const png = await page.evaluate(() => {
		const canvas = document.createElement('canvas'); canvas.width = 3840; canvas.height = 2160;
		const context = canvas.getContext('2d'); context.fillStyle = 'black'; context.fillRect(0, 0, 3840, 2160);
		context.fillStyle = 'white'; for (let x = 1; x < 3840; x += 3) context.fillRect(x, 0, 1, 2160);
		return canvas.toDataURL('image/png').split(',')[1];
	});
	const bytes = Buffer.from(png, 'base64'), storageKey = randomUUID();
	const mask = { schemaVersion: 1, id: 'full-mask', kind: 'mask', inputs: [],
		nodes: [{ id: 'rectangle', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }], outputNodeId: 'rectangle' };
	const project = createFramescaperProject(PROFILE, { id: 'frozen-sampling', primarySequenceId: 'main',
		visualModel: { maskMattes: [mask], stillSources: [{ schemaVersion: 1, kind: 'still', id: 'plate', name: 'Frozen detail',
			mimeType: 'image/png', storageKey, contentSha256: createHash('sha256').update(bytes).digest('hex'), width: 3840, height: 2160, hasAlpha: false }] },
		clips: [{ schemaVersion: 1, kind: 'still', id: 'frozen', sourceId: 'plate', sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 30 }],
		finishing: { visualPresentations: [{ schemaVersion: 1, id: 'view', owner: { kind: 'clip', id: 'frozen' }, enabled: true,
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
	await expect.poll(() => page.evaluate(() => globalThis.__stillSampleFrames.length)).toBeGreaterThan(0);
	const frame = await page.evaluate(() => globalThis.__stillSampleFrames.at(-1));
	const oracle = await page.evaluate(async ({ png, width, height }) => {
		const bytes = Uint8Array.from(atob(png), character => character.charCodeAt(0));
		const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
		try {
			const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
			const context = canvas.getContext('2d'); context.imageSmoothingEnabled = false;
			context.drawImage(bitmap, 0, 0, width, height); return Array.from(context.getImageData(0, 0, 64, 1).data);
		} finally { bitmap.close(); }
	}, { png, width: frame.width, height: frame.height });
	// The platform nearest-neighbour oracle reads each three-pixel footprint's white centre.
	expect(oracle.slice(0, 4)).toEqual([255, 255, 255, 255]); expect(frame.pixels).toEqual(oracle);
});
