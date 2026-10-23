/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioSource, createAudioTrack, createAudioClip } from '../../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';

test('an imported recording with a prototype-named identity supports Delete and leave gap', async ({ page }) => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `split-identity-${crypto.randomUUID()}` });
	let blob;
	try {
		const source = createAudioSource({ id: 'recording', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
		const project = createSoundscaperProject({ id: 'split-identity-browser', sources: [source],
			tracks: [createAudioTrack({ id: 'voice', clipIds: ['__proto__'] })],
			clips: [createAudioClip({ id: '__proto__', sourceId: source.id, title: 'Recorded voice',
				durationFrames: 48_000, sourceDurationFrames: 48_000 })] });
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
		blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Voice.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'split-identity-browser');
	await waitForProjectActivation(editor);
	await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Fit project to width']);
	const clip = editor.locator('[data-clip-id="__proto__"][role="group"]');
	const box = await clip.boundingBox(); expect(box).not.toBeNull();
	const y = box.y + box.height * .6;
	await page.mouse.move(box.x + box.width * .25, y); await page.mouse.down();
	await page.mouse.move(box.x + box.width * .5, y, { steps: 6 }); await page.mouse.up();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Delete', 'Delete and leave gap']);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
});
