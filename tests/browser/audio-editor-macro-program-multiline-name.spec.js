/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

test('editing an admitted multiline macro program name preserves its line break on export', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	const original = 'Opening\nRoom tone';
	const choosing = page.waitForEvent('filechooser');
	await manager.getByRole('button', { name: 'Import program', exact: true }).click();
	await (await choosing).setFiles({ name: 'Room.soundscapemacro', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
		schemaVersion: 1, kind: 'script', engine: 'soundscaper-macro-js/1', name: original, source: "sound.log.info('room');",
	})) });
	const row = manager.locator('[data-macro-script-id]');
	await expect.poll(() => row.evaluate(element => [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(''))).toBe(original);
	const name = manager.getByRole('textbox', { name: 'Program name', exact: true });
	await name.focus();
	await name.press('Control+End');
	await name.pressSequentially('!');
	await name.press('Enter');
	const downloading = page.waitForEvent('download');
	await manager.getByRole('button', { name: 'Export program', exact: true }).click();
	const bytes = await downloadBytes(await downloading);
	expect(JSON.parse(Buffer.from(bytes).toString('utf8')).name).toBe(`${original}!`);
	await name.fill('Plain name');
	await name.press('Enter');
	expect(await name.evaluate(element => element.tagName)).toBe('TEXTAREA');
	await expect(name).toBeFocused();
	const newProgram = manager.getByLabel('New program', { exact: true });
	await newProgram.click();
	await expect(name).toHaveValue('New program');
	expect(await name.evaluate(element => element.tagName)).toBe('INPUT');
	await expect(newProgram).toBeFocused();
});
