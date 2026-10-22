/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('a real large raw file retains literal substitution characters in its size warning', async ({ page }) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-literal-warning-'));
	const name = "$&-{size}-$`-$'.raw";
	const path = join(directory, name);
	try {
		const file = await open(path, 'wx');
		try { await file.truncate(256 * 1024 ** 2 + 2); } finally { await file.close(); }
		const editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'Tools', ['Import raw data']);
		const dialog = page.locator('[data-import-surface="raw-pcm"]');
		await dialog.locator('input[type="file"]').setInputFiles(path);
		await dialog.getByRole('button', { name: 'Import', exact: true }).click();
		const warning = page.getByRole('dialog', { name: 'Large file warning', exact: true });
		await expect(warning).toContainText(name);
		await warning.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(warning).toHaveCount(0);
		await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
		await expect(editor.locator('[data-clip-id][role="group"]')).toHaveCount(0);
	} finally { await rm(directory, { recursive: true, force: true }); }
});
