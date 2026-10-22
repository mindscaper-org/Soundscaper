/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';

test('File Open preserves a shape zero-width outline in the programme preview', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__shapePaints = [];
		const put = CanvasRenderingContext2D.prototype.putImageData;
		CanvasRenderingContext2D.prototype.putImageData = function (...args) {
			const result = Reflect.apply(put, this, args), image = args[0];
			if (image.width < 320 || image.height < 180) return result;
			let white = 0, green = 0;
			for (let offset = 0; offset < image.data.length; offset += 4) {
				if (image.data[offset + 3] !== 255) continue;
				if (image.data[offset] === 255 && image.data[offset + 1] === 255 && image.data[offset + 2] === 255) white++;
				if (image.data[offset] === 0 && image.data[offset + 1] === 255 && image.data[offset + 2] === 0) green++;
			}
			if (green) globalThis.__shapePaints.push({ white, green });
			return result;
		};
	});
	const project = createFramescaperProject(PROFILE, { id: 'zero-width-shape', primarySequenceId: 'main',
		visualModel: { generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'source', name: 'Green rectangle',
			width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, frameCount: 30,
			generator: { kind: 'shape', shape: 'rectangle', fillColor: '#00ff00ff', strokeColor: '#ffffffff', strokeWidth: 0 } }] },
		clips: [{ schemaVersion: 1, kind: 'generator', id: 'shape', sourceId: 'source', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 }],
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['shape'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }],
	});
	const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project,
		createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false }));
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Green shape.fscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	await expect.poll(() => page.evaluate(() => globalThis.__shapePaints.at(-1)?.green ?? 0)).toBeGreaterThan(0);
	expect(await page.evaluate(() => globalThis.__shapePaints.at(-1).white)).toBe(0);
});
