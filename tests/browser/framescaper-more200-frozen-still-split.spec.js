/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';
import { hasDurableMediaStorageCapability } from './helpers/durable-media-storage-capability.js';

test('a newly frozen picture keeps ordinary Split at playhead and Undo', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	test.skip(!await page.evaluate(hasWebGl2Capability), 'Exact composited Freeze requires WebGL2.');
	test.skip(!await page.evaluate(hasDurableMediaStorageCapability, 'indexeddb-only'), 'Freeze requires durable IndexedDB Blob storage.');
	await editor.locator('[data-project-bin-input]').setInputFiles(createDeterministicSilentVideoFixture('freeze-workflow.webm'));
	const card = editor.locator('[data-project-bin-item]').first(); await expect(card).toBeVisible();
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	const camera = editor.getByRole('group', { name: /^Video clip:/u }).first(); await camera.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Freeze Video']);
	const dialog = page.getByRole('dialog', { name: 'Freeze Selected Video', exact: true });
	await dialog.locator('[data-framescaper-authoring-freeze]').click();
	await expect(dialog.getByRole('status')).toHaveText('Exact playhead freeze created.', { timeout: 15_000 });
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	const frozen = editor.getByRole('group', { name: /^Video clip: .* Freeze$/u });
	await frozen.press('Enter');
	await editor.getByRole('button', { name: 'Next frame', exact: true }).click();
	await editor.getByRole('button', { name: 'Split at playhead', exact: true }).click();
	await expect(frozen).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expect(frozen).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Redo'); await expect(frozen).toHaveCount(2);
});
