/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('moving a MIDI clip onto an audio track retains piano-roll editing and its instrument', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'MIDI track (beta)']);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	await panel.getByRole('button', { name: 'Add note', exact: true }).click();
	const instrument = panel.getByRole('combobox', { name: 'Instrument', exact: true });
	await instrument.selectOption('square');
	await expect(instrument).toHaveValue('square');
	await clipByName(editor, 'MIDI track (beta)').click({ button: 'right', position: { x: 32, y: 10 } });
	const move = page.getByRole('menuitem', { name: /^Move to track \(preserve time\)/u });
	await move.hover();
	await move.getByRole('menuitem').first().click();
	await expect(instrument).toHaveValue('square');
	const pitch = panel.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true });
	await pitch.fill('67');
	await pitch.press('Enter');
	await expect(pitch).toHaveValue('67');
});

test('importing MIDI into Project Bin keeps it off the timeline until placement', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Project bin']);
	await editor.getByLabel('Add audio to Project bin', { exact: true }).setInputFiles({
		name: 'quarter-note.mid', mimeType: 'audio/midi',
		buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex'),
	});
	const card = editor.getByRole('listitem', { name: /^Project bin:/u });
	await expect(card).toHaveCount(1);
	await expect(editor.locator('[data-clip-id]')).toHaveCount(1);
	await card.getByRole('button', { name: /^Add to timeline:/u }).click();
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	await panel.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	await expect(panel.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true })).toHaveValue('60');
});
