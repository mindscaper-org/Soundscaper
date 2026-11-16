/* SPDX-License-Identifier: AGPL-3.0-only */
import { test, expect } from './audio-editor-test-fixtures.js';
import { chooseCommandAction, clipByName, collectClientErrors, waitForEditor } from './audio-editor-test-helpers.js';
import { openVampAnalyzer } from './helpers/vamp-analyzer-fixture.js';

test('Vamp chord notes create an editable MIDI track through the Analyze menu with undo and redo', async ({ page }) => {
	const errors = collectClientErrors(page);
	const dialog = await openVampAnalyzer(page, { noteOutput: { id: 'chordnotes', unit: 'MIDI units' },
		features: [60, 64, 67].map(pitch => ({ outputId: 'chordnotes',
			timestamp: { seconds: 0, nanoseconds: 50_000_000 },
			duration: { seconds: 0, nanoseconds: 100_000_000 }, values: [pitch], label: '' })) });
	await dialog.getByRole('button', { name: 'Analyze', exact: true }).click();
	await expect(dialog.getByText('Create MIDI chord voicings', { exact: false })).toBeVisible();
	await dialog.getByRole('button', { name: 'Create MIDI track', exact: true }).click();
	await expect(dialog).toBeHidden();
	const editor = page.locator('[data-audio-editor]');
	await chooseCommandAction(page, editor, 'Window', 'Piano roll (beta)');
	const piano = editor.getByRole('group', { name: 'Note editor', exact: true });
	await expect(piano).toBeVisible();
	await expect(piano.getByRole('combobox', { name: 'Selected note', exact: true }).getByRole('option')).toHaveCount(4);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clipByName(editor, 'Onsets — Notes')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await clipByName(editor, 'Onsets — Notes').click();
	await expect(piano.getByRole('combobox', { name: 'Selected note', exact: true }).getByRole('option')).toHaveCount(4);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload({ waitUntil: 'domcontentloaded' });
	const restored = await waitForEditor(page);
	await clipByName(restored, 'Onsets — Notes').click();
	if (!await restored.getByRole('group', { name: 'Note editor', exact: true }).isVisible()) {
		await chooseCommandAction(page, restored, 'Window', 'Piano roll (beta)');
	}
	const notes = restored.getByRole('combobox', { name: 'Selected note', exact: true });
	await expect(notes.getByRole('option')).toHaveCount(4);
	await notes.selectOption({ index: 2 });
	await expect(restored.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true })).toHaveValue('64');
	expect(errors).toEqual([]);
});
