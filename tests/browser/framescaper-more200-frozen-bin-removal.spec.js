/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';
import { hasDurableMediaStorageCapability } from './helpers/durable-media-storage-capability.js';

test('Remove from project can delete a real Freeze from the Bin and Undo restores it', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	test.skip(!await page.evaluate(hasWebGl2Capability), 'Exact composited Freeze requires WebGL2.');
	test.skip(!await page.evaluate(hasDurableMediaStorageCapability, 'indexeddb-only'), 'Freeze requires durable IndexedDB Blob storage.');
	await editor.locator('[data-project-bin-input]').setInputFiles(createDeterministicSilentVideoFixture('freeze-workflow.webm'));
	const original = editor.locator('[data-project-bin-item]').first(); await expect(original).toBeVisible();
	await original.getByRole('button', { name: /Add to timeline/u }).click();
	const camera = editor.getByRole('group', { name: /^Video clip:/u }).first(); await camera.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Freeze Video']);
	const dialog = page.getByRole('dialog', { name: 'Freeze Selected Video', exact: true });
	await dialog.locator('[data-framescaper-authoring-freeze]').click();
	await expect(dialog.getByRole('status')).toHaveText('Exact playhead freeze created.', { timeout: 15_000 });
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	const frozen = editor.getByRole('group', { name: /^Video clip: .* Freeze$/u });
	await frozen.press('Enter'); await frozen.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const card = editor.getByRole('listitem', { name: /^Project bin: .* Freeze$/u });
	await expect(card).toBeVisible(); await expect(frozen).toHaveCount(0);
	await card.getByRole('button', { name: /^More file actions:/u }).click();
	await page.getByRole('menuitem', { name: 'Remove from project', exact: true }).click();
	const confirmation = page.getByRole('alertdialog', { name: 'Remove from project', exact: true });
	await confirmation.getByRole('button', { name: 'Remove from project', exact: true }).click();
	await expect(card).toHaveCount(0); await expect(camera).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expect(card).toBeVisible();
	await card.getByRole('button', { name: /Add to timeline/u }).click(); await expect(frozen).toBeVisible();
});
