/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';

test('File Open renders retained cubic mask handles rather than their control polygon', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__curveMaskPaint = null;
		const put = CanvasRenderingContext2D.prototype.putImageData;
		CanvasRenderingContext2D.prototype.putImageData = function (...args) {
			const result = Reflect.apply(put, this, args), image = args[0];
			if (image.width < 320 || image.height < 180) return result;
			const pixel = (x, y) => Array.from(image.data.slice((Math.floor(y * image.height) * image.width + Math.floor(x * image.width)) * 4,
				(Math.floor(y * image.height) * image.width + Math.floor(x * image.width)) * 4 + 4));
			if (pixel(0.5, 0.55)[1] > 240) globalThis.__curveMaskPaint = { upper: pixel(0.5, 0.3), lower: pixel(0.5, 0.55) };
			return result;
		};
	});
	const point = (x, y) => ({ position: { x, y }, inHandle: null, outHandle: null });
	const mask = { schemaVersion: 1, id: 'curve-mask', kind: 'mask', inputs: [], outputNodeId: 'curve', nodes: [{
		id: 'curve', kind: 'vector-path', fillRule: 'nonzero', paths: [{ id: 'outline', closed: true, points: [
			{ ...point(0.25, 0.5), outHandle: { x: 0.25, y: 0 } },
			{ ...point(0.75, 0.5), inHandle: { x: 0.75, y: 0 } }, point(0.5, 0.75),
		] }],
	}] };
	const project = createFramescaperProject(PROFILE, { id: 'curved-mask', primarySequenceId: 'main',
		visualModel: { generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'source', name: 'Curved matte',
			width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, frameCount: 30,
			generator: { kind: 'solid', color: '#00ff00ff' } }], maskMattes: [mask] },
		clips: [{ schemaVersion: 1, kind: 'generator', id: 'solid', sourceId: 'source', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 }],
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['solid'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }],
		finishing: { visualPresentations: [{ schemaVersion: 1, id: 'view', owner: { kind: 'clip', id: 'solid' }, enabled: true,
			opacity: 1, blendMode: 'normal', grade: null, processorStackId: null, maskMatteIds: ['curve-mask'] }] },
	});
	const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project,
		createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false }));
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Curved mask.fscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id, { timeout: 30_000 }); await waitForProjectActivation(editor);
	await expect.poll(() => page.evaluate(() => globalThis.__curveMaskPaint?.lower[1] ?? 0)).toBeGreaterThan(240);
	const oracle = await page.evaluate(() => {
		const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
		const context = canvas.getContext('2d'); context.fillStyle = '#00ff00';
		context.beginPath(); context.moveTo(80, 90); context.bezierCurveTo(80, 0, 240, 0, 240, 90);
		context.lineTo(160, 135); context.closePath(); context.fill();
		return Array.from(context.getImageData(160, 54, 1, 1).data);
	});
	expect(oracle).toEqual([0, 255, 0, 255]);
	expect(await page.evaluate(() => globalThis.__curveMaskPaint.upper)).toEqual(oracle);
});
