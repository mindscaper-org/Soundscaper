/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, chooseNestedCommandAction, chooseFileAction, stubStorageEstimate } from './audio-editor-test-helpers.js';
import { videoPreviewBenchmarkMedia } from './fixtures/video-preview-benchmark-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test('composition edits preserve other authored values and unchanged Apply preserves Redo', async ({ page }) => {
	test.setTimeout(120_000);
	await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
	await page.addInitScript(() => {
		Object.defineProperty(navigator.storage, 'persisted', { configurable: true, value: async () => true });
	});
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [videoPreviewBenchmarkMedia.file]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u });
	await expect(clip).toHaveCount(1);
	await clip.focus();
	await clip.press('Enter');
	const open = async () => {
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Transform and compositing']);
		const dialog = page.getByRole('dialog', { name: 'Transform and compositing', exact: true });
		await expect(dialog).toBeVisible();
		return dialog;
	};
	const applyClose = async (dialog) => {
		await dialog.getByRole('button', { name: 'Apply', exact: true }).press('Enter');
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
	};
	let dialog = await open();
	const rotation = 0.123456789012345;
	await dialog.getByRole('spinbutton', { name: 'Rotation (degrees)', exact: true }).fill(String(rotation));
	await applyClose(dialog);
	await chooseFileAction(page, editor, 'Save project');
	await expect.poll(() => savedComposition(page, editor)).toMatchObject({ transform: { rotationDegrees: rotation } });
	dialog = await open();
	await dialog.getByRole('checkbox', { name: 'Flip horizontally', exact: true }).check();
	await applyClose(dialog);
	await chooseFileAction(page, editor, 'Save project');
	await expect.poll(() => savedComposition(page, editor)).toMatchObject({
		transform: { rotationDegrees: rotation, flipHorizontal: true },
	});
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	const redo = editor.getByRole('button', { name: 'Redo', exact: true });
	await expect(redo).toBeEnabled();
	dialog = await open();
	await applyClose(dialog);
	await expect(redo).toBeEnabled();
	await redo.click();
	dialog = await open();
	await expect(dialog.getByRole('checkbox', { name: 'Flip horizontally', exact: true })).toBeChecked();
});

async function savedComposition(page, editor) {
	const id = await editor.getAttribute('data-project-id');
	return page.evaluate(async ({ databaseName, id }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const db = await result(indexedDB.open(databaseName));
		try {
			const project = await result(db.transaction('projects').objectStore('projects').get(id));
			return project.clips.find(clip => clip.kind === 'video').videoComposition;
		} finally { db.close(); }
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id });
}
