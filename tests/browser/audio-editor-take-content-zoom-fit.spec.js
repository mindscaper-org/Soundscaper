/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { createTakeFitProject } from '../helpers/take-fit-project.ts';
import { exportScapeProject, SCAPE_MIME_TYPE } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';

registerAudioEditorHooks();

test('Fit project retains the complete extent of unflattened take groups', async ({ page }) => {
	const project = createTakeFitProject();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'take-fit-browser-fixture' });
	let buffer;
	try {
		for (const source of project.sources) {
			const writer = await store.beginSourceWrite(source.storageKey, { name: source.name, mimeType: source.mimeType,
				sampleRate: source.sampleRate, channelCount: source.channelCount, chunkFrames: source.chunkFrames });
			for (let offset = 0; offset < source.frameCount; offset += source.chunkFrames) {
				await writer.write([new Float32Array(Math.min(source.chunkFrames, source.frameCount - offset)).fill(.2)]);
			}
			await writer.commit();
		}
		const archive = await exportScapeProject(project, store);
		buffer = Buffer.from(await archive.blob.arrayBuffer());
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'take-fit.scape', mimeType: SCAPE_MIME_TYPE, buffer });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	const clip = clipByName(editor, 'Bed.wav');
	await expect(clip).toBeVisible();
	await clip.click();
	await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Fit project to width']);
	const width = (await clip.boundingBox()).width;
	const laneWidth = (await editor.locator('[data-track-lane]').first().boundingBox()).width;
	// The small clip keeps its minimum painted width while the later takes fit.
	expect(width).toBeLessThan(laneWidth / 5);
});
