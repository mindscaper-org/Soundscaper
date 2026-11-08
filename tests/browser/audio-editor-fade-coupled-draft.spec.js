/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('Fades reports the opposite length that Apply saves after either edge pushes it away', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const file = createWavFixture({ name: 'Fade lengths.wav', duration: 1 });
	await importFiles(editor, [file]);
	const clip = clipByName(editor, file.name);
	const open = async () => {
		await clip.locator('.clip-header').click({ button: 'right' });
		const parent = page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: /^Fade in/u });
		await parent.hover();
		await parent.getByRole('menuitem', { name: 'Edit fade-in', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Fades', exact: true });
		await expect(dialog).toBeVisible(); return dialog;
	};
	let dialog = await open();
	const incoming = () => dialog.getByRole('textbox', { name: 'Fade-in length', exact: true });
	const outgoing = () => dialog.getByRole('textbox', { name: 'Fade-out length', exact: true });
	const originalIn = await incoming().inputValue();
	await outgoing().fill('0.8');
	await expect(incoming()).toHaveValue(originalIn);
	for (const edited of ['in', 'out']) {
		await incoming().fill('0.8');
		if (edited === 'out') await outgoing().fill('0.8');
		const expectedIn = edited === 'in' ? '0.8' : '0.2';
		const expectedOut = edited === 'in' ? '0.2' : '0.8';
		await expect(incoming()).toHaveValue(expectedIn);
		await expect(outgoing()).toHaveValue(expectedOut);
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(dialog).toBeHidden();
		dialog = await open();
		await expect(incoming()).toHaveValue(expectedIn);
		await expect(outgoing()).toHaveValue(expectedOut);
	}
	await outgoing().fill('0.200 s');
	await incoming().clear(); await incoming().pressSequentially('0.1');
	await expect(incoming()).toHaveValue('0.1');
	await expect(outgoing()).toHaveValue('0.200 s');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	dialog = await open();
	await expect(incoming()).toHaveValue('0.1');
	await expect(outgoing()).toHaveValue('0.2');
});
