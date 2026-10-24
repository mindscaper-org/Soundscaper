/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { installLinkedAudioBridge } from './helpers/linked-audio-relink-fixture.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

for (const reopen of [false, true]) test(`${reopen ? 'Dismissed' : 'Visible'} Recovery completion ${reopen ? 'preserves the newly opened dialog' : 'closes its own dialog'}`, async ({ page }) => {
	test.setTimeout(90_000);
	await installLinkedAudioBridge(page);
	await page.addInitScript(() => {
		const nativeFetch = globalThis.fetch.bind(globalThis);
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		const state = { armed: false, held: false, release };
		globalThis.__recoveryReadGate = state;
		globalThis.fetch = async (input, init) => {
			const url = input instanceof Request ? input.url : String(input);
			if (state.armed && !state.held && url.includes('/linked-audio-range-v1/')) { state.held = true; await gate; }
			return nativeFetch(input, init);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Link WAV', exact: true }).click();
	await expect(editor.locator('[data-project-bin-item]')).toHaveCount(1);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const originalId = await editor.getAttribute('data-project-id');
	const original = await persistedProject(page, originalId);
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Recover a project']);
	const dialog = page.getByRole('dialog', { name: 'Project recovery', exact: true });
	await dialog.getByLabel('Project to recover').selectOption(originalId);
	await expect(dialog.getByLabel('Saved version').locator('option').first()).toContainText('Ready to recover');
	await page.evaluate(() => { globalThis.__recoveryReadGate.armed = true; });
	try {
		await dialog.getByRole('button', { name: 'Recover as a new project' }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__recoveryReadGate.held)).toBe(true);
		await expect(dialog.getByRole('button', { name: 'Close', exact: true }).last()).toBeDisabled();
		if (reopen) {
			await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
			await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Recover a project']);
			await expect(dialog).toBeVisible();
			await expect(dialog.getByRole('button', { name: 'Recover as a new project' })).toBeEnabled();
		}
		await page.evaluate(() => globalThis.__recoveryReadGate.release());
		await expect(editor).not.toHaveAttribute('data-project-id', originalId);
		await waitForProjectActivation(editor);
		const firstCopyId = await editor.getAttribute('data-project-id');
		const firstCopy = await persistedProject(page, firstCopyId);
		expect(firstCopy.sources.map(source => source.name)).toEqual(original.sources.map(source => source.name));
		expect(await persistedProject(page, originalId)).toEqual(original);
		if (reopen) {
			await expect(dialog).toBeVisible();
			await expect(dialog.getByLabel('Project to recover')).toHaveValue(originalId);
			await dialog.getByRole('button', { name: 'Recover as a new project' }).click();
			await expect(dialog).toBeHidden();
			await expect(editor).not.toHaveAttribute('data-project-id', firstCopyId);
			await waitForProjectActivation(editor);
		} else await expect(dialog).toBeHidden();
	} finally { await page.evaluate(() => globalThis.__recoveryReadGate?.release()); }
});
