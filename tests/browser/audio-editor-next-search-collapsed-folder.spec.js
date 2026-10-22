/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, waitForEditor } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

for (const readOnly of [false, true]) test(`Search reveals an imported recording inside a collapsed folder; read-only=${readOnly}`, async ({ page, context }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const clip = clipByName(editor, monoTone.name);
	await expect(clip).toBeVisible();
	const track = editor.locator('[data-track-row]').filter({ has: clipByName(page, monoTone.name) });
	await chooseTrackMenuAction(page, editor, track, 'Move selection into new folder');
	const folder = editor.locator('[data-track-folder-row]');
	await expect(folder).toHaveAttribute('aria-expanded', 'true');
	await folder.focus(); await page.keyboard.press('ArrowLeft');
	await expect(folder).toHaveAttribute('aria-expanded', 'false');
	await expect(clip).toHaveCount(0);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	let other = null;
	if (readOnly) {
		other = await context.newPage(); await other.goto('/embed/en/');
		await waitForEditor(other);
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
	}
	const search = editor.getByRole('combobox', { name: 'Search commands and media', exact: true });
	await search.fill(monoTone.name);
	const result = editor.getByRole('group', { name: 'Timeline clips', exact: true })
		.getByRole('option').filter({ hasText: monoTone.name });
	await expect(result).toHaveCount(1); await result.click();
	await expect(folder).toHaveAttribute('aria-expanded', 'true');
	await expect(clip).toBeFocused();
	await folder.focus(); await page.keyboard.press('ArrowLeft');
	await expect(folder).toHaveAttribute('aria-expanded', 'false');
	await expect(clip).toHaveCount(0);
	if (!other) { other = await context.newPage(); await other.goto('/embed/en/'); }
	const stored = await waitForEditor(other);
	await expect(stored.locator('[data-track-folder-row]')).toHaveAttribute('aria-expanded', 'false');
	await other.close();
});
