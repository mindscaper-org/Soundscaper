/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName } from './audio-editor-test-helpers.js';

test('piano-roll wheel zoom keeps the main timeline at its independently chosen zoom', async ({ page }) => {
	await page.setViewportSize({ width: 1800, height: 1100 });
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'MIDI track (beta)']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	await panel.getByRole('button', { name: 'Add note', exact: true }).click();
	await expect(panel.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true })).toHaveValue('60');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const clip = clipByName(editor, 'MIDI track (beta)'), note = panel.locator('[data-note-id="1"]');
	const width = async locator => {
		const box = await locator.boundingBox();
		if (!box) throw new Error('Expected visible user geometry.');
		return box.width;
	};
	const zoom = async box => {
		await page.mouse.move(box.x, box.y);
		await page.keyboard.down('Control');
		try { for (let index = 0; index < 3; index++) await page.mouse.wheel(0, -120); }
		finally { await page.keyboard.up('Control'); }
	};
	const mainBefore = await width(clip), pianoBefore = await width(note);
	const clipBox = await clip.boundingBox();
	if (!clipBox) throw new Error('Expected the main timeline clip.');
	await zoom({ x: clipBox.x + 100, y: clipBox.y + 40 });
	await expect.poll(() => width(clip)).toBeGreaterThan(mainBefore);
	expect(await width(note)).toBe(pianoBefore);
	await editor.getByRole('button', { name: 'Fit project', exact: true }).click();
	const mainAtFit = await width(clip), pianoAtFit = await width(note);
	const grid = await panel.locator('.kw-audio-editor__piano-roll-notes > [tabindex="0"]').boundingBox();
	if (!grid) throw new Error('Expected the local note grid.');
	await zoom({ x: grid.x + 2, y: grid.y + 80 });
	await expect.poll(() => width(note)).toBeGreaterThan(pianoAtFit);
	expect(await width(clip), 'the local grid already owns this wheel zoom').toBe(mainAtFit);
});
