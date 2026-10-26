/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('Cancel while an effect preview worker is preparing releases the editor immediately', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__heldPreviewWorkers = [];
		const post = Worker.prototype.postMessage, terminate = Worker.prototype.terminate;
		Worker.prototype.postMessage = function (request, ...rest) {
			if (request?.operation === 'apply' && request.effectType === 'audacity-reverb') {
				globalThis.__heldPreviewWorkers.push(this); return;
			}
			return Reflect.apply(post, this, [request, ...rest]);
		};
		Worker.prototype.terminate = function () {
			if (globalThis.__heldPreviewWorkers.includes(this)) this.__previewTerminated = true;
			return Reflect.apply(terminate, this, []);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'cancel pending preview.wav', duration: 8 })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Delay and reverb', 'Reverb']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__heldPreviewWorkers.length)).toBe(1);
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect.poll(() => page.evaluate(() => globalThis.__heldPreviewWorkers[0].__previewTerminated === true)).toBe(true);
	await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
});
