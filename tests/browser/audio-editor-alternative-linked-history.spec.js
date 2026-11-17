/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, chooseDropdown, closeDialog, collectClientErrors, openExportDialog, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { installLinkedAudioBridge } from './helpers/linked-audio-relink-fixture.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

async function snapshots(page, editor) {
	await chooseFileAction(page, editor, 'Session snapshots');
	return page.getByRole('dialog', { name: 'Session snapshots', exact: true });
}

test('Undo keeps the linked recording behind a deleted snapshot after twenty saved edits', async ({ page }) => {
	test.setTimeout(90000);
	const errors = collectClientErrors(page);
	await installLinkedAudioBridge(page);
	let editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Link WAV', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first();
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const clip = editor.locator('[data-clip-id]').first();
	await card.getByRole('button', { name: /More file actions/u }).click();
	await page.getByRole('menuitem', { name: 'Remove from Project bin', exact: true }).click();
	let dialog = await snapshots(page, editor);
	await dialog.getByRole('textbox', { name: 'Snapshot name', exact: true }).fill('Linked recording');
	await dialog.getByRole('button', { name: 'Create snapshot', exact: true }).click();
	await expect(dialog.getByRole('option', { name: 'Linked recording', exact: true })).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Done', exact: true }).click();
	await clip.click(); await page.keyboard.press('Delete');
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	await page.reload(); editor = await waitForEditor(page); await waitForProjectActivation(editor);
	dialog = await snapshots(page, editor);
	await dialog.getByRole('listbox', { name: 'Saved snapshots', exact: true }).selectOption({ label: 'Linked recording' });
	await dialog.getByRole('button', { name: 'Delete snapshot', exact: true }).click();
	await expect(dialog.getByText('No snapshots yet.', { exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Done', exact: true }).click();
	for (let edit = 0; edit < 21; edit++) {
		const title = `Saved edit ${edit}`;
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
		const rename = page.getByRole('dialog', { name: 'Rename project', exact: true });
		await rename.getByRole('textbox', { name: 'Project name', exact: true }).fill(title);
		await rename.getByRole('button', { name: 'Save name', exact: true }).click();
		await expect.poll(async () => (await persistedProject(page, projectId)).title).toBe(title);
	}
	for (let edit = 0; edit < 22; edit++) await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	dialog = await snapshots(page, editor);
	await dialog.getByRole('listbox', { name: 'Saved snapshots', exact: true }).selectOption({ label: 'Linked recording' });
	await dialog.getByRole('button', { name: 'Restore snapshot', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await dialog.getByRole('button', { name: 'Done', exact: true }).click();
	const bindings = await page.evaluate(databaseName => new Promise((resolve, reject) => {
		const open = indexedDB.open(databaseName);
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const database = open.result;
			const request = database.transaction('linkedVideoOriginalBindings', 'readonly').objectStore('linkedVideoOriginalBindings').getAll();
			request.onerror = () => { database.close(); reject(request.error); };
			request.onsuccess = () => { database.close(); resolve(request.result); };
		};
	}), SOUNDSCAPER_DATABASE_NAME);
	expect(bindings).toHaveLength(1);
	expect(await page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.released)).toEqual([]);
	const previousExports = await page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length);
	const output = await openExportDialog(page, editor);
	await chooseDropdown(page, output.locator('[data-export-field="format"]'), 'WAV');
	await output.getByRole('button', { name: 'Export', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length)).toBe(previousExports + 1);
	await closeDialog(output);
	const peak = await page.evaluate(async () => {
		const bytes = globalThis.__projectBinLinkedAudioFixture.exports.at(-1);
		const context = new AudioContext();
		try {
			const audio = await context.decodeAudioData(bytes.buffer.slice(0));
			return audio.getChannelData(0).reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
		} finally { await context.close(); }
	});
	expect(peak).toBeGreaterThan(.1);
	expect(errors).toEqual([]);
});
