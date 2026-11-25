/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('video color exact-value editing commits on Enter and cancels on Escape', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	await importFiles(editor, [createDeterministicAvFixture('composition-color.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip: composition-color/u });
	const panel = await openClipProperties(page, editor, clip);
	const rack = panel.locator('[data-video-effect-rack]');
	await rack.locator('[data-video-effect-picker]').getByRole('button').click();
	await page.getByRole('option', { name: 'Chroma Key', exact: true }).click();
	await rack.getByRole('button', { name: 'Add effect', exact: true }).click();
	const color = rack.getByRole('textbox', { name: 'Exact value: Key color', exact: true });
	await typeColor(color, '#ABCDEF');
	await color.press('Enter');
	await expect(color).not.toBeFocused();
	await expect(color).toHaveValue('#ABCDEF');
	await typeColor(color, '#654321');
	await color.press('Escape');
	await expect(color).toHaveValue('#ABCDEF');
});

async function typeColor(color, value) {
	await color.selectText();
	await color.pressSequentially(value);
	await expect(color).toHaveValue(value);
}
