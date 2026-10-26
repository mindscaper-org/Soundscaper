/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeWorkspacePanel, disableNativeSavePicker, importFiles, waitForEditor } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

for (const mode of ['levels', 'contrast', 'export']) test(`${mode === 'export' ? 'Export' : `Analyze ${mode}`} works after unused Project Bin media is lost from local storage`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Programme.wav', frequency: 523, duration: 1, channelCount: 1 })]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Project bin']);
	await editor.locator('[data-project-bin-input]').setInputFiles(createWavFixture({ name: 'Unused.wav', frequency: 233, duration: 1, channelCount: 1 }));
	await expect(editor.locator('[data-project-bin-item]')).toHaveCount(1);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.evaluate(async databaseName => {
		const open = indexedDB.open(databaseName);
		const database = await new Promise((resolve, reject) => {
			open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
		});
		try {
			const transaction = database.transaction('sources', 'readwrite');
			const sources = transaction.objectStore('sources');
			const read = sources.getAll();
			read.onsuccess = () => {
				const unused = read.result.find(source => source.name === 'Unused.wav');
				if (!unused) { transaction.abort(); return; }
				// Model an evicted source record while preserving the saved document.
				sources.delete(unused.id);
			};
			await new Promise((resolve, reject) => {
				transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error ?? new Error('Unused source absent'));
				transaction.onerror = () => reject(transaction.error);
			});
		} finally { database.close(); }
	}, SOUNDSCAPER_DATABASE_NAME);
	await page.reload(); await waitForEditor(page);
	const bin = editor.locator('[data-workspace-panel="project-bin"]');
	await expect(bin.locator('[data-project-bin-item]')).toHaveCount(1);
	await expect(bin.getByRole('textbox', { name: 'Rename Project bin item: Unused', exact: true })).toHaveValue('Unused');
	await expect(bin.getByRole('status')).toContainText('The local audio is unavailable.');
	await closeWorkspacePanel(editor, 'project-bin');
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	if (mode === 'export') {
		const samples = await exportSamples(page, editor);
		expect(samples.length).toBe(48_000);
		expect(samples.some(sample => Math.abs(sample) > .1)).toBe(true);
		return;
	}
	await chooseCommandAction(page, editor, 'Analyze', mode === 'levels' ? 'Analyze selection' : 'Contrast');
	const dialog = page.getByRole('dialog', { name: mode === 'levels' ? 'Analyze selection' : 'Contrast', exact: true });
	if (mode === 'contrast') {
		await expect(dialog.getByRole('button', { name: 'Measure foreground', exact: true })).toBeEnabled();
		await dialog.getByRole('button', { name: 'Measure foreground', exact: true }).click();
	}
	await expect(dialog.locator(`[data-analysis-report="${mode}"]`)).toBeVisible();
	if (mode === 'levels') await expect(dialog.locator('[data-analysis-value="peak"]')).toContainText('dBFS');
	else await expect(dialog.locator('[data-analysis-report="contrast"]')).toContainText('dBFS');
	await expect(dialog.getByRole('alert')).toHaveCount(0);
});
