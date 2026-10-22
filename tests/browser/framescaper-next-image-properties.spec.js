/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { showClipTimingFields } from './audio-editor-inspector-test-helpers.js';
import { createPngFixture } from '../helpers/png-fixture.mjs';

for (const kind of ['image', 'generator']) for (const entry of ['Window', 'clip menu']) test(`${kind} timing properties open through ${entry}`, async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	if (kind === 'image') {
		const choosing = page.waitForEvent('filechooser'); await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
		await (await choosing).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	} else await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	const clip = editor.getByRole('group', { name: kind === 'image' ? 'Image clip: poster' : 'Video clip: Title', exact: true });
	await expect(clip).toBeVisible(); await waitForProjectActivation(editor);
	await clip.press('Enter'); await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	if (entry === 'Window') await chooseNestedCommandAction(page, editor, 'Window', ['Clip properties']);
	else {
		await clip.click({ button: 'right' });
		const command = page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: 'Clip properties', exact: true });
		await expect(command).toBeEnabled(); await command.click();
	}
	const panel = editor.locator('[data-workspace-panel="clip-properties"]'); await expect(panel).toBeVisible();
	await showClipTimingFields(panel);
	const duration = panel.getByRole('group', { name: 'Duration', exact: true });
	await expect(duration.locator('.timecode-digit')).toHaveText([...'000005000']);
	const before = await clip.boundingBox(); expect(before).not.toBeNull();
	await duration.locator('.timecode-digit').nth(5).click();
	await page.keyboard.press(kind === 'image' ? 'ArrowUp' : 'ArrowDown'); await page.keyboard.press('Enter');
	await expect(duration.locator('.timecode-digit')).toHaveText([...kind === 'image' ? '000006000' : '000004000']);
	await expect.poll(async () => (await clip.boundingBox())?.width).toBeCloseTo(before.width * (kind === 'image' ? 1.2 : 0.8), 0);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
	await expect(duration.locator('.timecode-digit')).toHaveText([...'000005000']);
});
