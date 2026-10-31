/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseNestedCommandAction, clickClipInterior, clipByName, collectClientErrors,
	disableNativeSavePicker, downloadBytes, importFiles, waitForEditor,
} from './audio-editor-test-helpers.js';

const noteFile = {
	name: 'quarter-note.mid', mimeType: 'audio/midi',
	buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex'),
};

async function openPianoRoll(page, editor) {
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	return editor.getByRole('group', { name: 'Note editor', exact: true });
}

test.describe('beta MIDI editing and shared transport', () => {
	test.use({ viewport: { width: 1440, height: 1000 } });

	test('adds MIDI only through Tracks, edits notes in the optional piano roll and plays with audio', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await expect(editor.getByRole('group', { name: 'Note editor', exact: true })).toHaveCount(0);
		await importFiles(editor, [toneA]);
		await editor.getByRole('button', { name: 'Add track', exact: true }).click();
		const flyout = page.locator('.add-track-flyout');
		await expect(flyout).toBeVisible();
		await expect(flyout.getByRole('menuitem', { name: /MIDI/u })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'MIDI track (beta)']);
		await expect(editor.getByRole('group', { name: 'Note editor', exact: true })).toHaveCount(0);
		const noteEditor = await openPianoRoll(page, editor);
		const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
		await panel.getByRole('button', { name: 'Add note', exact: true }).click();
		await expect(noteEditor.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true })).toHaveValue('60');
		await noteEditor.getByRole('spinbutton', { name: 'Velocity', exact: true }).fill('85');
		await expect(noteEditor.getByRole('spinbutton', { name: 'Velocity', exact: true })).toHaveValue('85');
		await panel.getByRole('combobox', { name: 'Instrument', exact: true }).selectOption('square');
		await expect(panel.getByRole('combobox', { name: 'Instrument', exact: true })).toHaveValue('square');
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await panel.getByRole('button', { name: 'Delete selected notes', exact: true }).click();
		await expect(noteEditor.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true })).toBeDisabled();
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(noteEditor.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true })).toHaveValue('60');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload({ waitUntil: 'domcontentloaded' });
		const restored = await waitForEditor(page);
		await clickClipInterior(page, clipByName(restored, 'MIDI track (beta)'));
		const restoredNotes = restored.getByRole('group', { name: 'Note editor', exact: true });
		if (!await restoredNotes.isVisible()) await openPianoRoll(page, restored);
		await restoredNotes.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
		await expect(restoredNotes.getByRole('spinbutton', { name: 'Velocity', exact: true })).toHaveValue('85');
		await expect(restored.getByRole('combobox', { name: 'Instrument', exact: true })).toHaveValue('square');
		expect(errors).toEqual([]);
	});

	test('imports MIDI through the shared picker and exports MIDI and Allegro from Export other', async ({ page }) => {
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [noteFile]);
		const noteEditor = await openPianoRoll(page, editor);
		await noteEditor.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
		await expect(noteEditor.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true })).toHaveValue('60');
		for (const [label, extension] of [['Export MIDI (beta)', '.mid'], ['Export Allegro (beta)', '.gro']]) {
			const downloading = page.waitForEvent('download');
			await chooseNestedCommandAction(page, editor, 'File', ['Export other', label]);
			const download = await downloading;
			expect(download.suggestedFilename().endsWith(extension)).toBe(true);
			const bytes = await downloadBytes(download);
			await download.delete();
			expect(bytes.byteLength).toBeGreaterThan(20);
			if (extension === '.mid') expect(Buffer.from(bytes).subarray(0, 4).toString('ascii')).toBe('MThd');
			else {
				await importFiles(editor, [{ name: 'roundtrip.gro', mimeType: 'text/plain', buffer: Buffer.from(bytes) }]);
				await noteEditor.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
				await expect(noteEditor.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true })).toHaveValue('60');
			}
		}
		expect(errors).toEqual([]);
	});
});
