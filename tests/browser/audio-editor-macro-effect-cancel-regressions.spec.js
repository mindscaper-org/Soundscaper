/* SPDX-License-Identifier: AGPL-3.0-only */
import { taskProgressCancel } from './helpers/task-progress.js';

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('canceling an effect macro releases the editor and permits another run', async ({ page }) => {
	await page.addInitScript(() => {
		const post = Worker.prototype.postMessage;
		Worker.prototype.postMessage = function (request, ...rest) {
			if (request?.operation === 'apply' && request.effectType === 'audacity-reverb') return;
			return Reflect.apply(post, this, [request, ...rest]);
		};
	});
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [createWavFixture({ name: 'speech-take.wav', frequency: 440, duration: 30 })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	const manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	await manager.getByRole('button', { name: 'New macro', exact: true }).click();
	await manager.getByRole('button', { name: 'Add effect', exact: true }).click();
	await page.getByRole('menu', { name: 'Choose an effect', exact: true }).getByRole('menuitem', { name: 'Reverb', exact: true }).click();
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await taskProgressCancel(page).click();
	await expect(manager).toContainText('Macro cancelled.');
	await expect(manager.getByRole('button', { name: 'Run macro', exact: true })).toBeEnabled();
	await expect(editor.locator('[data-editor-task-progress]')).toBeHidden();
});
