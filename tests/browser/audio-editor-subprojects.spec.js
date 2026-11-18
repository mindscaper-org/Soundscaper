/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, clipByName, collectClientErrors,
	commitInput, disableNativeSavePicker, importFiles, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { exportSamples } from './helpers/round2-audio-export.js';

async function renameProject(page, editor, name) {
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	const dialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
	await commitInput(dialog.getByRole('textbox', { name: 'Project name', exact: true }), name);
	await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
	await expect(dialog).toBeHidden();
}
async function openSubprojects(page, editor) {
	await chooseFileAction(page, editor, 'Subprojects');
	const dialog = page.getByRole('dialog', { name: 'Subprojects', exact: true });
	await expect(dialog).toBeVisible(); return dialog;
}
async function storedLink(page, projectId) {
	return page.evaluate(({ databaseName, id }) => new Promise((resolve, reject) => {
		const request = indexedDB.open(databaseName);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const database = request.result;
			const project = database.transaction('projects', 'readonly').objectStore('projects').get(id);
			project.onerror = () => { database.close(); reject(project.error); };
			project.onsuccess = () => { database.close(); resolve(project.result?.metadata?.subprojects?.[0] ?? null); };
		};
	}), { databaseName: SOUNDSCAPER_DATABASE_NAME, id: projectId });
}

test('nested subprojects follow grandchild saves without rewriting inactive parents and retain portable audio', async ({ page }) => {
	test.setTimeout(90_000);
	const errors = collectClientErrors(page);
	await disableNativeSavePicker(page);
	let editor = await bootEditor(page, '/embed/en/');
	await renameProject(page, editor, 'Dialogue scene');
	await importFiles(editor, [toneA]);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const childId = await editor.getAttribute('data-project-id');
	await chooseFileAction(page, editor, 'New');
	await waitForProjectActivation(editor);
	await renameProject(page, editor, 'Episode');
	const parentId = await editor.getAttribute('data-project-id');
	let dialog = await openSubprojects(page, editor);
	await dialog.getByRole('combobox', { name: 'Project to insert or relink', exact: true }).selectOption({ label: 'Dialogue scene' });
	await dialog.getByRole('button', { name: 'Insert subproject', exact: true }).click();
	await expect(dialog.getByRole('option', { name: 'Dialogue scene — Automatic updates', exact: true })).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const sounding = await exportSamples(page, editor, { includeTail: false });
	expect(Math.max(...sounding.slice(0, 4096).map(Math.abs))).toBeGreaterThan(0.1);
	await expect.poll(async () => (await storedLink(page, parentId))?.sourceId).toMatch(/^subproject-audio-/u);
	const original = await storedLink(page, parentId);
	await chooseFileAction(page, editor, 'New');
	await waitForProjectActivation(editor);
	await renameProject(page, editor, 'Series');
	const seriesId = await editor.getAttribute('data-project-id');
	dialog = await openSubprojects(page, editor);
	await dialog.getByRole('combobox', { name: 'Project to insert or relink', exact: true }).selectOption({ label: 'Episode' });
	await dialog.getByRole('button', { name: 'Insert subproject', exact: true }).click();
	await expect(dialog.getByRole('option', { name: 'Episode — Automatic updates', exact: true })).toHaveCount(1);
	await dialog.getByRole('listbox', { name: 'Linked subprojects', exact: true }).selectOption({ label: 'Episode — Automatic updates' });
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect.poll(async () => (await storedLink(page, seriesId))?.sourceId).toMatch(/^subproject-audio-/u);
	const originalSeries = await storedLink(page, seriesId);
	const soundingSeries = await exportSamples(page, editor, { includeTail: false });
	dialog = await openSubprojects(page, editor);
	await dialog.getByRole('listbox', { name: 'Linked subprojects', exact: true }).selectOption({ label: 'Episode — Automatic updates' });
	await dialog.getByRole('button', { name: 'Open subproject', exact: true }).click();
	await expect(editor).toHaveAttribute('data-project-id', parentId);
	await waitForProjectActivation(editor);

	dialog = await openSubprojects(page, editor);
	await dialog.getByRole('listbox', { name: 'Linked subprojects', exact: true }).selectOption({ label: 'Dialogue scene — Automatic updates' });
	await dialog.getByRole('button', { name: 'Open subproject', exact: true }).click();
	await expect(editor).toHaveAttribute('data-project-id', childId);
	await waitForProjectActivation(editor);
	const track = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row]');
	await track.getByRole('button', { name: 'Mute', exact: true }).click();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await editor.getByRole('tab', { name: 'Series', exact: true }).click();
	await waitForProjectActivation(editor);
	// Verify the automatic watcher publishes before the user asks to export.
	await expect.poll(async () => (await storedLink(page, seriesId))?.sourceId, { timeout: 15_000 }).not.toBe(originalSeries.sourceId);
	expect((await storedLink(page, parentId)).sourceId).toBe(original.sourceId);
	const muted = await exportSamples(page, editor, { includeTail: false });
	expect(muted.length).toBe(sounding.length);
	expect(Math.max(...muted.map(Math.abs))).toBeLessThan(0.00001);

	const mutedProxy = await storedLink(page, seriesId);
	await editor.getByRole('tab', { name: 'Dialogue scene', exact: true }).click();
	await waitForProjectActivation(editor);
	await track.getByRole('button', { name: 'Mute', exact: true, pressed: true }).click();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await editor.getByRole('tab', { name: 'Series', exact: true }).click();
	await waitForProjectActivation(editor);
	await expect.poll(async () => (await storedLink(page, seriesId))?.sourceId, { timeout: 15_000 }).not.toBe(mutedProxy.sourceId);
	expect(await exportSamples(page, editor, { includeTail: false })).toEqual(soundingSeries);

	dialog = await openSubprojects(page, editor);
	await dialog.getByRole('listbox', { name: 'Linked subprojects', exact: true }).selectOption({ label: 'Episode — Automatic updates' });
	await dialog.getByRole('button', { name: 'Pin current audio', exact: true }).click();
	await expect(dialog.getByRole('option', { name: 'Episode — Pinned audio', exact: true })).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Make independent audio', exact: true }).click();
	await expect(dialog.getByText('No linked subprojects.', { exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload(); editor = await waitForEditor(page); await waitForProjectActivation(editor);
	await expect(editor).toHaveAttribute('data-project-id', seriesId);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	expect(errors).toEqual([]);
});

test('a parent still exports its installed audio after its editable child is deleted', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await renameProject(page, editor, 'Child scene');
	await importFiles(editor, [toneA]);
	await chooseFileAction(page, editor, 'New');
	await waitForProjectActivation(editor);
	await renameProject(page, editor, 'Parent mix');

	const dialog = await openSubprojects(page, editor);
	await dialog.getByRole('combobox', { name: 'Project to insert or relink', exact: true }).selectOption({ label: 'Child scene' });
	await dialog.getByRole('button', { name: 'Insert subproject', exact: true }).click();
	await expect(dialog.getByRole('option', { name: 'Child scene — Automatic updates', exact: true })).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	const before = await exportSamples(page, editor, { includeTail: false });
	expect(Math.max(...before.slice(0, 4096).map(Math.abs))).toBeGreaterThan(0.1);

	await editor.getByRole('tab', { name: 'Child scene', exact: true }).click();
	await waitForProjectActivation(editor);
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Delete project']);
	const confirmation = page.getByRole('dialog', { name: 'Delete this project?', exact: true });
	await confirmation.getByRole('button', { name: 'Delete permanently', exact: true }).click();
	await expect(confirmation).toBeHidden();
	await expect(editor.getByRole('tab', { name: 'Parent mix', exact: true })).toHaveAttribute('aria-selected', 'true');
	await waitForProjectActivation(editor);

	const after = await exportSamples(page, editor, { includeTail: false });
	expect(after).toEqual(before);
});
