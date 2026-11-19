/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

async function runProgram(page, editor, source, timeout = 30_000) {
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	const manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	await manager.getByLabel('New program', { exact: true }).click();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill(source);
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(manager.locator('[data-macro-script-log]')).toHaveAttribute('data-outcome', 'completed', { timeout });
	await manager.getByRole('button', { name: 'Close', exact: true }).click();
}

test('native macro targets retain Select all, concurrent requests and staged audio in fresh projects', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await test.step('a step-list macro applies Invert to every track selected by Select all', async () => {
		await importFiles(editor, [toneA, toneB]);
		const before = await exportSamples(page, editor);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
		const manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
		await manager.getByRole('button', { name: 'New macro', exact: true }).click();
		await manager.getByRole('button', { name: 'Add effect', exact: true }).click();
		await page.getByRole('menu', { name: 'Choose an effect', exact: true }).getByRole('menuitem', { name: 'Invert', exact: true }).click();
		await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
		await expect(manager).toContainText('Macro applied.');
		await manager.getByRole('button', { name: 'Close', exact: true }).click();
		const after = await exportSamples(page, editor);
		expect(after).toHaveLength(before.length);
		const residual = after.reduce((peak, sample, index) => Math.max(peak, Math.abs(sample + before[index])), 0);
		expect(residual).toBeLessThan(0.0001);
	});
	await freshProject(page, editor);
	await test.step('two awaited concurrent macro effects cannot silently discard one request', async () => {
		await importFiles(editor, [toneA]);
		const before = await exportSamples(page, editor);
		await runProgram(page, editor, "await sound.select.all(); await Promise.all([sound.effect('audacity-invert'), sound.effect('audacity-invert')]);");
		const after = await exportSamples(page, editor);
		expect(after).toHaveLength(before.length);
		const residual = after.reduce((peak, sample, index) => Math.max(peak, Math.abs(sample - before[index])), 0);
		expect(residual).toBeLessThan(0.0001);
	});
	await freshProject(page, editor);
	await test.step('a mixed offline and realtime macro renders its staged audio', async () => {
		await importFiles(editor, [toneA]);
		const original = await exportSamples(page, editor);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await runProgram(page, editor,
			"await sound.effects([{type:'audacity-amplify',params:{gainDb:0}},{type:'audacity-invert',params:{}}]);", 10_000);
		const inverted = await exportSamples(page, editor);
		expect(inverted).toHaveLength(original.length);
		expect(inverted.reduce((peak, sample, index) => Math.max(peak, Math.abs(sample + original[index])), 0)).toBeLessThan(0.0001);
	});
});

async function freshProject(page, editor) {
	const previousId = await editor.getAttribute('data-project-id');
	await chooseCommandAction(page, editor, 'File', 'New');
	await expect(editor).not.toHaveAttribute('data-project-id', previousId);
	await waitForProjectActivation(editor);
	await expect(editor).toHaveAttribute('data-clip-count', '0');
}
