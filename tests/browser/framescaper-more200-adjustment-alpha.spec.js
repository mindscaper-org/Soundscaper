/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';

test('File Open neutral adjustment retains the coverage of a translucent PNG', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__adjustmentFrames = [];
		const put = CanvasRenderingContext2D.prototype.putImageData;
		CanvasRenderingContext2D.prototype.putImageData = function (...args) {
			const result = Reflect.apply(put, this, args), image = args[0];
			if (image.width >= 100 && image.width <= 3840 && image.height >= 50 && image.height <= 2160 && image.data[3] === 255) {
				globalThis.__adjustmentFrames.push({ projectId: document.querySelector('[data-project-id]')?.getAttribute('data-project-id'), width: image.width, height: image.height, pixels: Array.from(image.data.slice(0, 256)) });
			}
			return result;
		};
	});
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	test.skip(!await page.evaluate(hasWebGl2Capability), 'The exact frozen image preview requires WebGL2.');
	const png = await page.evaluate(() => {
		const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
		const context = canvas.getContext('2d'); context.fillStyle = 'rgba(255,0,0,0.5)'; context.fillRect(0, 0, 1280, 720);
		return canvas.toDataURL('image/png').split(',')[1];
	});
	const pixels = [];
	for (const adjusted of [false, true]) {
		const bytes = Buffer.from(png, 'base64'), storageKey = randomUUID();
		const mask = { schemaVersion: 1, id: 'full-mask', kind: 'mask', inputs: [],
			nodes: [{ id: 'rectangle', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }], outputNodeId: 'rectangle' };
		const project = createFramescaperProject(PROFILE, { id: adjusted ? 'adjustment-on' : 'adjustment-off', primarySequenceId: 'main',
			visualModel: { adjustmentLayers: adjusted ? [{ schemaVersion: 1, kind: 'adjustment-layer', id: 'neutral', sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 30, targetTrackIds: ['pictures'], effectIds: [] }] : [], maskMattes: [mask], stillSources: [{ schemaVersion: 1, kind: 'still', id: 'plate', name: 'Frozen detail',
				mimeType: 'image/png', storageKey, contentSha256: createHash('sha256').update(bytes).digest('hex'), width: 1280, height: 720, hasAlpha: true }] },
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
		// Replacing the first project can still be retiring its preview caches;
		// use the same activation budget as waitForProjectActivation below.
		await expect(editor).toHaveAttribute('data-project-id', project.id, { timeout: 30_000 });
		await waitForProjectActivation(editor);
		await expect(editor.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-renderer', 'ready', { timeout: 30_000 });
		await expect.poll(() => page.evaluate(id => globalThis.__adjustmentFrames.filter(frame => frame.projectId === id).length, project.id)).toBeGreaterThan(0);
		pixels.push(await page.evaluate(id => globalThis.__adjustmentFrames.filter(frame => frame.projectId === id).at(-1).pixels.slice(0, 4), project.id));
	}
	expect(pixels[0]).toEqual([188, 0, 0, 255]);
	expect(pixels[1]).toEqual(pixels[0]);
});
