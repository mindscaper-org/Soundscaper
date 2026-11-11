/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeDialog, commitInput, collectClientErrors, waitForEditor, dockWorkspacePanel } from './audio-editor-test-helpers.js';
import { capturePassingScreenshot } from './helpers/passing-screenshots.js';

test('Macros palette is an opt-in dockable launcher with a separate Macro manager', async ({ page }, testInfo) => {
	const errors = collectClientErrors(page);
	let editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const palette = () => editor.getByRole('region', { name: 'Macros palette', exact: true });
	await expect(palette()).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	await expect(palette()).toBeVisible();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(palette().getByRole('listitem')).toHaveCount(2);
	await expect(palette().getByRole('listitem', { name: 'Restoration', exact: true }).getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
	await capturePassingScreenshot(palette(), { path: testInfo.outputPath('macros-palette.png') });

	await palette().getByRole('button', { name: 'New macro', exact: true }).click();
	let manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	await expect(manager).toBeVisible();
	await commitInput(manager.getByLabel('Macro name', { exact: true }), 'Palette test');
	await closeDialog(manager);
	await expect(palette().getByRole('listitem', { name: 'Palette test', exact: true })).toBeVisible();
	await expect(palette().getByRole('listitem', { name: 'Palette test', exact: true }).getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
	await palette().getByRole('button', { name: 'Macro options: Palette test', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Edit macro', exact: true }).click();
	await expect(manager.getByLabel('Macro name', { exact: true })).toHaveValue('Palette test');
	await closeDialog(manager);
	await palette().getByRole('button', { name: 'Macro options: Palette test', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Delete macro', exact: true }).click();
	await expect(palette().getByRole('listitem', { name: 'Palette test', exact: true })).toHaveCount(0);

	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	const chooserPending = page.waitForEvent('filechooser');
	await manager.getByRole('button', { name: 'Import macro', exact: true }).click();
	await (await chooserPending).setFiles({ name: 'Create track.txt', mimeType: 'text/plain', buffer: Buffer.from('NewMonoTrack:\n') });
	await closeDialog(manager);
	await palette().getByRole('listitem', { name: 'Create track', exact: true }).getByRole('button', { name: 'Run', exact: true }).click();
	await expect(editor).toHaveAttribute('data-track-count', '2');
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	await commitInput(manager.getByLabel('Program name', { exact: true }), 'Palette program');
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill('await sound.command("NewMonoTrack");');
	await closeDialog(manager);
	const program = palette().getByRole('listitem', { name: 'Palette program', exact: true });
	await program.getByRole('button', { name: 'Run', exact: true }).click();
	await expect(editor).toHaveAttribute('data-track-count', '3');
	await program.getByRole('button', { name: 'Palette program', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Macro manager', exact: true }).getByLabel('Program name', { exact: true })).toHaveValue('Palette program');
	await closeDialog(page.getByRole('dialog', { name: 'Macro manager', exact: true }));

	await dockWorkspacePanel(editor, 'macros-palette', 'floating');
	await expect(palette()).toBeVisible();
	await page.reload();
	editor = await waitForEditor(page);
	await expect(palette()).toBeVisible();
	await expect(editor.locator('[data-panel-dock="floating"]').getByRole('region', { name: 'Macros palette', exact: true })).toBeVisible();
	await chooseCommandAction(page, editor, 'Window', 'Macros palette');
	await expect(palette()).toHaveCount(0);
	expect(errors).toEqual([]);
});

test('imported programs stay disabled in the palette until reviewed in the manager', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	const manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	const chooserPending = page.waitForEvent('filechooser');
	await manager.getByRole('button', { name: 'Import program', exact: true }).click();
	await (await chooserPending).setFiles({ name: 'Review.soundscapemacro', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
		schemaVersion: 1, kind: 'script', engine: 'soundscaper-macro-js/1', name: 'Review', source: 'await sound.command("NewMonoTrack");',
	})) });
	await closeDialog(manager);
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const row = editor.getByRole('region', { name: 'Macros palette', exact: true }).getByRole('listitem', { name: 'Review', exact: true });
	await expect(row.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
	await row.getByRole('button', { name: 'Review', exact: true }).click();
	await manager.getByRole('checkbox').check();
	await manager.getByRole('button', { name: 'Enable this program', exact: true }).click();
	await closeDialog(manager);
	await row.getByRole('button', { name: 'Run', exact: true }).click();
	await expect(editor).toHaveAttribute('data-track-count', '2');
});
