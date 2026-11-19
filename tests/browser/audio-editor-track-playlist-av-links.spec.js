/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, closeWorkspacePanel, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('camera audio can use an empty playlist and recall its original without removing picture', async ({ page }) => {
	test.setTimeout(90000);
	page.setDefaultTimeout(10000);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [createDeterministicAvFixture('playlist-camera.webm')]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await closeWorkspacePanel(editor, 'video-preview');
	await clipByName(editor, 'playlist-camera Audio').getByText('playlist-camera Audio', { exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Track playlists']);
	const dialog = page.getByRole('dialog', { name: 'Track playlists', exact: true });
	await dialog.getByRole('textbox', { name: 'Playlist name', exact: true }).fill('Replacement voice');
	await dialog.getByRole('button', { name: 'Create empty playlist', exact: true }).click();
	await expect(dialog.getByRole('alert')).toHaveCount(0);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-video-track] [data-clip-id]')).toHaveCount(1);
	await dialog.getByRole('listbox', { name: 'Playlists', exact: true }).selectOption({ label: 'Original' });
	await dialog.getByRole('button', { name: 'Activate playlist', exact: true }).click();
	await expect(dialog.getByRole('alert')).toHaveCount(0);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor.locator('[data-video-track] [data-clip-id]')).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: 'Close' }).click();
	await page.keyboard.press('ControlOrMeta+z');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
});
