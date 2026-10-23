/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { videoPreviewBenchmarkMedia } from './fixtures/video-preview-benchmark-media.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';
import { hasDurableMediaStorageCapability } from './helpers/durable-media-storage-capability.js';
import { createVideoSource } from '../../src/common/editor/project-media-factory.ts';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';

test('Freeze Video retains the selected secondary camera sequence', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	test.skip(!await page.evaluate(hasWebGl2Capability), 'Exact composited Freeze requires WebGL2.');
	test.skip(!await page.evaluate(hasDurableMediaStorageCapability, 'indexeddb-only'), 'Freeze requires durable IndexedDB Blob storage.');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Secondary camera.scape', mimeType: 'application/zip', buffer: await archive() });
	await expect(editor).toHaveAttribute('data-project-id', 'secondary-freeze'); await waitForProjectActivation(editor);
	const camera = editor.getByRole('group', { name: 'Video clip: Camera', exact: true }); await camera.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Freeze Video']);
	const dialog = page.getByRole('dialog', { name: 'Freeze Selected Video', exact: true });
	await dialog.locator('[data-framescaper-authoring-freeze]').click();
	await expect(dialog.getByRole('status')).toHaveText('Exact playhead freeze created.', { timeout: 15_000 });
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	const frozen = editor.getByRole('group', { name: 'Video clip: Camera Freeze', exact: true });
	await expect(frozen).toBeVisible(); await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expect(frozen).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo'); await expect(frozen).toBeVisible();
});

async function archive() {
	const file = videoPreviewBenchmarkMedia.file;
	const sourceId = `camera-${randomUUID()}`;
	const source = createVideoSource({ id: sourceId, storageKey: sourceId, name: 'Camera', mimeType: file.mimeType,
		contentSha256: createHash('sha256').update(file.buffer).digest('hex'), frameRate: { num: 30, den: 1 },
		sampleRate: 48_000, sourceFrameCount: 180, sampleFrameCount: 288_000, width: 1280, height: 720 });
	const project = createFramescaperProject(PROFILE, { id: 'secondary-freeze', sources: [source],
		clips: [{ kind: 'video', id: 'camera', sourceId, title: 'Camera', sequenceId: 'cut', sequenceStartFrame: 0,
			sequenceFrameCount: 180, sourceInFrame: 0, sourceFrameCount: 180, retimeMap: null }],
		tracks: [{ id: 'primary-pictures', type: 'video', clipIds: [] }, { id: 'cut-pictures', type: 'video', clipIds: ['camera'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['primary-pictures'] },
			{ id: 'cut', rate: { num: 30, den: 1 }, trackIds: ['cut-pictures'] }], primarySequenceId: 'main' });
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
	try {
		await store.writeMediaAsset(sourceId, new Blob([file.buffer], { type: file.mimeType }), { name: file.name, mimeType: file.mimeType });
		const result = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store);
		return Buffer.from(await result.blob.arrayBuffer());
	} finally { await store.close(); }
}
