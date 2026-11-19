/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, type Locator, type Page } from '@playwright/test';
import { chooseNestedCommandAction } from '../audio-editor-test-helpers.js';

/** Archive-copy workflows need a differing working copy; identical reopens now resume. */
export async function changeWorkingProjectAfterArchiveSave(page: Page, editor: Locator): Promise<void> {
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	const dialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
	await dialog.getByRole('textbox').fill('Working copy changed after archive save');
	await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
}
