/* SPDX-License-Identifier: AGPL-3.0-only */

import { aiffCommentMetadataCases } from '../helpers/pcm-metadata-import-cases.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, closeDialog, importFiles } from './audio-editor-test-helpers.js';

// Node independently checks both native comment forms through Scape reopening.
test('native AIFF comments populate each clip’s prepared sharing description', async ({ page }) => {
	// Exercise the ordinary authenticated draft without sending anything externally.
	await page.route('**/api/freesound/**', async route => {
		const path = new URL(route.request().url()).pathname;
		if (path === '/api/freesound/oauth/session') return route.fulfill({ json: { data: {
			connected: true, user: { id: 7, username: 'browser-tester' },
		} } });
		if (path === '/api/freesound/uploads/pending') return route.fulfill({ json: { data: {
			pendingDescription: [], pendingProcessing: [], pendingModeration: [],
		} } });
		if (path === '/api/freesound/uploads') return route.fulfill({ status: 201, json: { data: { uploadFilename: 'remote-take.wav' } } });
		return route.fulfill({ status: 404, json: {} });
	});
	const editor = await bootEditor(page, '/embed/en/');
	const fixtures = aiffCommentMetadataCases();
	await importFiles(editor, await Promise.all(fixtures.map(async ({ file }) => ({
		name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()),
	}))));
	await expect(editor).toHaveAttribute('data-clip-count', String(fixtures.length));
	await chooseCommandAction(page, editor, 'Window', 'Freesound');
	const panel = editor.locator('[data-workspace-panel="freesound"]');
	await expect(panel.getByText('Connected as browser-tester', { exact: true })).toBeVisible();
	const ready = panel.locator('[data-freesound-uploads]').getByRole('button', { name: /^Ready to publish\s*:/u });
	for (const [index, { file, sharingComment }] of fixtures.entries()) {
		await clipByName(editor, file.name).focus();
		await page.keyboard.press('Shift+F10');
		await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: 'Upload clip to Freesound', exact: true }).press('Enter');
		await expect(ready).toHaveCount(index + 1);
		await ready.nth(index).click();
		const dialog = page.locator('[data-freesound-publish-dialog="true"]');
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(new RegExp(`Comment: ${sharingComment}`, 'u'));
		await closeDialog(dialog);
	}
});
