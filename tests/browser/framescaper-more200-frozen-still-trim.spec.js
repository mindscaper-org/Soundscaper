/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { videoPreviewBenchmarkMedia } from './fixtures/video-preview-benchmark-media.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';
import { hasDurableMediaStorageCapability } from './helpers/durable-media-storage-capability.js';

test('a newly frozen picture keeps ordinary edge trimming and Undo', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	test.skip(!await page.evaluate(hasWebGl2Capability), 'Exact composited Freeze requires WebGL2.');
	test.skip(!await page.evaluate(hasDurableMediaStorageCapability, 'indexeddb-only'), 'Freeze requires durable IndexedDB Blob storage.');
	await editor.locator('[data-project-bin-input]').setInputFiles(videoPreviewBenchmarkMedia.file);
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
	const before = await frozen.boundingBox(); expect(before).not.toBeNull();
	const handle = await frozen.getByRole('button', { name: 'Trim right edge', exact: true }).boundingBox();
	expect(handle).not.toBeNull();
	const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
	await page.mouse.move(x, y); await page.mouse.down();
	await page.mouse.move(x - before.width / 3, y, { steps: 6 }); await page.mouse.up();
	await expect.poll(async () => (await frozen.boundingBox())?.width).toBeLessThan(before.width * .85);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(async () => (await frozen.boundingBox())?.width).toBe(before.width);
});
