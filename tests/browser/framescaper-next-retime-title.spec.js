/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

test('Video retime identifies the imported and renamed video by its timeline title', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(createDeterministicSilentVideoFixture('Camera.webm'));
	const card = editor.locator('[data-project-bin-item]').first(); await expect(card).toBeVisible();
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	const clip = editor.getByRole('group', { name: /^Video clip:/u }); await expect(clip).toHaveCount(1);
	await clip.press('Enter'); await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	await clip.locator('.clip-header__name').dblclick();
	const name = clip.getByRole('textbox'); await name.fill('Interview closeup'); await name.press('Enter');
	await expect(editor.getByRole('group', { name: 'Video clip: Interview closeup', exact: true })).toBeVisible();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Video retime']);
	await expect(page.getByRole('dialog', { name: 'Video retime', exact: true }).getByRole('heading', { level: 3 }))
		.toHaveText('Interview closeup');
});
