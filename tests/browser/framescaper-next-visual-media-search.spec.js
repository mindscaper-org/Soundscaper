/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { createPngFixture } from '../helpers/png-fixture.mjs';

test('image search finds an imported image by its media type and reveals its timeline clip', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const choosing = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
	await (await choosing).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	const clip = editor.getByRole('group', { name: 'Image clip: poster', exact: true });
	await expect(clip).toBeVisible();
	await clip.press('Enter');
	await expect(clip.getByRole('button', { name: 'Trim left edge', exact: true })).toBeEnabled();
	const search = editor.locator('[data-editor-search-input]');
	await search.fill('image');
	const result = editor.locator('[data-editor-search-kind="timeline"]').filter({ hasText: 'poster' });
	await expect(result).toBeVisible();
	await expect(result).toContainText('image');
	await result.click();
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	await expect(editor.locator('[data-editor-search-popup]')).toBeHidden();
});

test('generator search finds an authored title by its media type', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	const clip = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	await expect(clip).toBeVisible();
	await editor.locator('[data-editor-search-input]').fill('generator');
	const result = editor.locator('[data-editor-search-kind="timeline"]').filter({ hasText: 'Title' });
	await expect(result).toBeVisible();
	await expect(result).toContainText('generator');
	await result.click();
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
});
