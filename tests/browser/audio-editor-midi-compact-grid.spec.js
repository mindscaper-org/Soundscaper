/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('piano-roll note editing surface remains reachable in a narrow editor', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'narrow.mid', mimeType: 'audio/midi', buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex') }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const grid = panel.locator('.kw-audio-editor__piano-roll-notes > [tabindex="0"]');
	await panel.locator('.kw-audio-editor__piano-roll-controls').hover();
	await page.mouse.wheel(0, 800);
	await expect(grid).toBeInViewport({ ratio: 0.9 });
	const note = panel.locator('.note-rect[data-note-id="1"]');
	await expect(note).toBeInViewport({ ratio: 0.9 });
	const bounds = await note.boundingBox();
	if (!bounds) throw new Error('Note drawing surface is unavailable');
	await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width / 2 + 25, bounds.y + bounds.height / 2, { steps: 3 });
	await page.mouse.up();
	await expect(panel.getByRole('spinbutton', { name: 'Note start (seconds)', exact: true })).toHaveValue('0.25');
});
