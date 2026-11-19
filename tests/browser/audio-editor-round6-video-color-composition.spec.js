/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('video color exact-value editing preserves native composition before completed color commits', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	await importFiles(editor, [createDeterministicAvFixture('composition-color.webm')]);
	const clip = editor.locator('[data-clip-kind="video"]').first();
	await clip.click({ button: 'right' });
	await page.locator('.audio-editor-clip-context-menu [data-action-id="clip-properties"]').click();
	const panel = editor.locator('[data-workspace-panel="clip-properties"]');
	const rack = panel.locator('[data-video-effect-rack]');
	await rack.locator('[data-video-effect-picker]').getByRole('button').click();
	await page.getByRole('option', { name: 'Chroma Key', exact: true }).click();
	await rack.getByRole('button', { name: 'Add effect', exact: true }).click();
	const color = rack.getByRole('textbox', { name: 'Exact value: Key color', exact: true });
	await typeColor(color, '#123456');
	await color.press('Enter');
	await expect(color).not.toBeFocused();
	await expect(color).toHaveValue('#123456');
	await typeColor(color, '#１２');
	const prevented = await color.evaluate(element => {
		const event = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true,
			bubbles: true, cancelable: true });
		element.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(color).toBeFocused();
	await expect(color).toHaveValue('#１２');
	await expect(panel.getByRole('alert')).toHaveCount(0);
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
