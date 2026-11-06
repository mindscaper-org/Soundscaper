/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

for (const [fixture, comment] of [
	['sox-comt-comment', 'Harbour take 7'],
	['libsndfile-comment-whitespace', 'Scene one'],
]) test(`native AIFF ${fixture} comment populates the prepared sharing description`, async ({ page }) => {
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
	const encoded = readFileSync(new URL(`../fixtures/${fixture}.aiff.base64`, import.meta.url), 'utf8');
	await importFiles(editor, [{ name: 'Harbour.aiff', mimeType: 'audio/aiff', buffer: Buffer.from(encoded.trim(), 'base64') }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseCommandAction(page, editor, 'Window', 'Freesound');
	const panel = editor.locator('[data-workspace-panel="freesound"]');
	await expect(panel.getByText('Connected as browser-tester', { exact: true })).toBeVisible();
	const clip = editor.locator('[data-clip-id]').first();
	await clip.focus();
	await page.keyboard.press('Shift+F10');
	await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: 'Upload clip to Freesound', exact: true }).press('Enter');
	const ready = panel.locator('[data-freesound-uploads]').getByRole('button', { name: /^Ready to publish\s*:/u });
	await expect(ready).toHaveCount(1);
	await ready.click();
	const dialog = page.locator('[data-freesound-publish-dialog="true"]');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(new RegExp(`Comment: ${comment}`, 'u'));
});
