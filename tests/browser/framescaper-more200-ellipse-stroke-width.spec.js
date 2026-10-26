/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';

test('File Open retains a uniform ellipse outline against the native Canvas stroke oracle', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__ellipseWidths = [];
		const put = CanvasRenderingContext2D.prototype.putImageData;
		CanvasRenderingContext2D.prototype.putImageData = function (...args) {
			const result = Reflect.apply(put, this, args), image = args[0];
			if (image.width < 320 || image.height < 180 || image.width % 2 || image.height % 2) return result;
			const { width, height, data } = image;
			if (data[((height / 2) * width + width / 2) * 4 + 1] !== 255) return result;
			const axes = pixels => [
				Array.from({ length: width / 2 }, (_, x) => x).filter(x => pixels[((height / 2) * width + x) * 4] === 255).length,
				Array.from({ length: height / 2 }, (_, y) => y).filter(y => pixels[(y * width + width / 2) * 4] === 255).length,
			];
			const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
			const context = canvas.getContext('2d'), mx = Math.round(width / 8), my = Math.round(height / 8);
			context.beginPath(); context.ellipse(width / 2, height / 2, (width - 2 * mx) / 2, (height - 2 * my) / 2, 0, 0, 2 * Math.PI);
			context.clip(); context.lineWidth = 2 * Math.round(120 * width / 1920); context.strokeStyle = 'white'; context.stroke();
			globalThis.__ellipseWidths.push({ actual: axes(data), oracle: axes(context.getImageData(0, 0, width, height).data) });
			return result;
		};
	});
	const project = createFramescaperProject(PROFILE, { id: 'ellipse-outline-width', primarySequenceId: 'main',
		visualModel: { generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'source', name: 'Ellipse outline',
			width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, frameCount: 30,
			generator: { kind: 'shape', shape: 'ellipse', fillColor: '#00ff00ff', strokeColor: '#ffffffff', strokeWidth: 120 } }] },
		clips: [{ schemaVersion: 1, kind: 'generator', id: 'shape', sourceId: 'source', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 }],
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['shape'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }],
	});
	const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project,
		createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false }));
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Ellipse outline.fscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id, { timeout: 30_000 }); await waitForProjectActivation(editor);
	await expect.poll(() => page.evaluate(() => globalThis.__ellipseWidths.length)).toBeGreaterThan(0);
	const widths = await page.evaluate(() => globalThis.__ellipseWidths.at(-1));
	for (let axis = 0; axis < 2; axis++) expect(Math.abs(widths.actual[axis] - widths.oracle[axis])).toBeLessThanOrEqual(1);
});
