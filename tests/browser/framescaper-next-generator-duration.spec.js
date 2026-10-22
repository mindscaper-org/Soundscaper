/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { showClipTimingFields } from './audio-editor-inspector-test-helpers.js';

test('a generated title duration remains bounded by its authored source', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	const clip = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	await clip.press('Enter'); await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	await chooseNestedCommandAction(page, editor, 'Window', ['Clip properties']);
	const panel = editor.locator('[data-workspace-panel="clip-properties"]'); await showClipTimingFields(panel);
	const duration = panel.getByRole('group', { name: 'Duration', exact: true });
	const originalWidth = await clip.evaluate(node => node.getBoundingClientRect().width);
	await expect(duration.locator('.timecode-digit')).toHaveText([...'000005000']);
	await duration.locator('.timecode-digit').nth(5).click(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
	await expect(duration.locator('.timecode-digit')).toHaveText([...'000005000']);
	await expect.poll(() => clip.evaluate(node => node.getBoundingClientRect().width)).toBe(originalWidth);
	await duration.locator('.timecode-digit').nth(5).click(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
	await expect(duration.locator('.timecode-digit')).toHaveText([...'000004000']);
	await expect.poll(() => clip.evaluate(node => node.getBoundingClientRect().width)).toBeLessThan(originalWidth);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
	await expect(duration.locator('.timecode-digit')).toHaveText([...'000005000']);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Redo']);
	await expect(duration.locator('.timecode-digit')).toHaveText([...'000004000']);
});
