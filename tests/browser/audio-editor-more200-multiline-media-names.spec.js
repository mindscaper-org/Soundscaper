/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, chooseNestedCommandAction, closeWorkspacePanel, openClipProperties } from './audio-editor-test-helpers.js';
import { writeDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

const ORIGINAL = 'Opening\nRoom tone';

for (const surface of ['clip header', 'clip properties', 'track header', 'Project bin', 'Clip spreadsheet', 'project menu', 'track menu']) {
	test(`File Open DAWproject multiline media names survive ${surface} editing`, async ({ page }) => {
		const archive = await writeDawprojectArchive({ metadataXml: surface === 'project menu' ? '<MetaData><Title>Opening\nRoom tone</Title></MetaData>' : '<MetaData/>',
			files: [{ path: 'take.wav', blob: new Blob([encodeWav([new Float32Array(96_000).fill(.25)], { sampleRate: 48_000 })]) }],
			projectXml: `<Project version="1.0"><Structure><Track id="voice" name="Opening&#10;Room tone" contentType="audio"><Channel role="regular"/></Track></Structure>
			<Arrangement><Lanes timeUnit="seconds"><Lanes track="voice"><Clips><Clip name="Opening&#10;Room tone" time="0" duration="2">
			<Audio timeUnit="seconds"><File path="take.wav"/></Audio></Clip></Clips></Lanes></Lanes></Arrangement></Project>`,
		});
		const editor = await bootEditor(page, '/embed/en/');
		const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
		await (await choosing).setFiles({ name: 'Multiline.dawproject', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
		await expect(editor.locator('[data-status]')).toHaveText('DAWproject imported.', { timeout: 30_000 });
		const clip = editor.locator('[data-clip-id]').first();
		const row = editor.locator('[data-track-row]').first();
		const display = surface === 'project menu' ? editor.locator('[data-project-name]')
			: surface.startsWith('track') ? row.locator('.track-control-panel__track-name-text') : clip.locator('.clip-header__name');
		await expect.poll(() => display.textContent()).toBe(ORIGINAL);
		if (surface === 'project menu' || surface === 'track menu') {
			if (surface === 'project menu') await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
			else {
				await row.locator('[data-track-header]').click();
				await chooseCommandAction(page, editor, 'Edit', 'Preferences');
				const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
				await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
				await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('Rename track');
				const binding = preferences.locator('[data-shortcut-action="track-rename"]');
				await binding.locator('[data-shortcut-binding="0"]').fill('Ctrl+Alt+Shift+R');
				await binding.getByRole('button', { name: 'Assign', exact: true }).click();
				await preferences.locator('.audio-editor-dialog-footer').getByRole('button', { name: 'Close', exact: true }).click();
				await expect(preferences).toBeHidden();
				await editor.locator('.kw-audio-editor__keyboard-help').focus(); await page.keyboard.press('Control+Alt+Shift+r');
			}
			const dialog = page.getByRole('dialog', { name: surface === 'project menu' ? 'Rename project' : 'Track name', exact: true });
			const field = dialog.getByRole('textbox'); await field.focus(); await field.press('Control+End');
			await field.pressSequentially('!'); await field.press('Enter'); await expect(dialog).toBeHidden();
			await expect.poll(() => display.textContent()).toBe(`${ORIGINAL}!`);
			await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expect.poll(() => display.textContent()).toBe(ORIGINAL);
			await chooseCommandAction(page, editor, 'Edit', 'Redo'); await expect.poll(() => display.textContent()).toBe(`${ORIGINAL}!`); return;
		}
		if (surface === 'Clip spreadsheet') {
			await chooseCommandAction(page, editor, 'Window', 'Clip spreadsheet');
			const panel = editor.locator('[data-workspace-panel="clip-spreadsheet"]');
			const cell = panel.locator('[data-row="0"][data-column="name"]'); await cell.dblclick();
			const name = panel.getByRole('textbox', { name: 'Name', exact: true });
			await name.focus(); await name.press('Control+End'); await name.pressSequentially('!'); await name.press('Enter');
			await expect.poll(() => display.textContent()).toBe(`${ORIGINAL}!`);
			await closeWorkspacePanel(editor, 'clip-spreadsheet');
			await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expect.poll(() => display.textContent()).toBe(ORIGINAL);
			await chooseCommandAction(page, editor, 'Edit', 'Redo'); await expect.poll(() => display.textContent()).toBe(`${ORIGINAL}!`); return;
		}
		if (surface === 'Project bin') {
			await chooseCommandAction(page, editor, 'Window', 'Project bin'); await clip.click({ button: 'right' });
			await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
			const name = editor.locator('[data-project-bin-name]').first();
			await expect(name).toHaveValue(ORIGINAL); await name.focus(); await name.press('Control+End');
			await name.pressSequentially('!'); await name.press('Enter'); await expect(name).toHaveValue(`${ORIGINAL}!`);
			await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expect(name).toHaveValue(ORIGINAL);
			await chooseCommandAction(page, editor, 'Edit', 'Redo'); await expect(name).toHaveValue(`${ORIGINAL}!`); return;
		}
		let field;
		if (surface === 'clip header') {
			await clip.locator('.clip-header').click(); await clip.press('F2');
			field = clip.getByRole('textbox', { name: 'Clip name', exact: true });
			await expect(field).toBeFocused(); await field.press('Tab');
			await expect.poll(() => display.textContent()).toBe(ORIGINAL);
			await clip.locator('.clip-header').click(); await clip.press('F2');
		} else if (surface === 'clip properties') {
			const properties = await openClipProperties(page, editor, clip);
			field = properties.getByRole('textbox', { name: 'Clip name', exact: true });
		} else {
			await display.dblclick(); field = row.locator('[data-track-name]').getByRole('textbox');
		}
		await field.focus(); await field.press('Control+End'); await field.pressSequentially('!');
		await field.press('Enter');
		const edited = `${ORIGINAL}!`;
		await expect.poll(() => display.textContent()).toBe(edited);
		if (surface === 'clip properties') await closeWorkspacePanel(editor, 'clip-properties');
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect.poll(() => display.textContent()).toBe(ORIGINAL);
		await chooseCommandAction(page, editor, 'Edit', 'Redo');
		await expect.poll(() => display.textContent()).toBe(edited);
	});
}
