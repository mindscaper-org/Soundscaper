/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('Search finds a real imported filename by its emoji', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const recording = { ...monoTone, name: '🦊.wav' };
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await expect(clip).toBeVisible();
	const search = editor.getByRole('combobox', { name: 'Search commands and media', exact: true });
	await search.fill('🦊');
	const result = editor.locator('[data-editor-search-kind="timeline"]').filter({ hasText: recording.name });
	await expect(result).toHaveCount(1);
	await result.click(); await expect(clip).toBeFocused();
});
