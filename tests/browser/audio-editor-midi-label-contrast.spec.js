/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { wcagContrastRatio } from '../../src/common/editor/ui/theme-contrast.ts';

test('selected MIDI note pitch labels retain readable contrast', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'contrast.mid', mimeType: 'audio/midi', buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex') }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const noteEditor = panel.getByRole('group', { name: 'Note editor', exact: true });
	await noteEditor.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	const velocity = noteEditor.getByRole('spinbutton', { name: 'Velocity', exact: true });
	const note = panel.locator('.note-rect[data-note-id="1"]');
	const hex = color => '#' + color.match(/\d+/g).slice(0, 3).map(value => Number(value).toString(16).padStart(2, '0')).join('');
	for (const value of ['127', '1']) {
		await velocity.fill(value);
		await velocity.press('Enter');
		await expect(note).toHaveCSS('opacity', '1');
		await expect.poll(async () => {
			const colors = await note.evaluate(element => ({ fill: getComputedStyle(element).backgroundColor,
				text: getComputedStyle(element.querySelector('.note-rect__label')).color }));
			return wcagContrastRatio(hex(colors.text), hex(colors.fill));
		}).toBeGreaterThanOrEqual(4.5);
	}
});
