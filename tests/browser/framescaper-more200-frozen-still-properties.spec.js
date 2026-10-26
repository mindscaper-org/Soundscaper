/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { showClipTimingFields } from './audio-editor-inspector-test-helpers.js';
import { videoPreviewBenchmarkMedia } from './fixtures/video-preview-benchmark-media.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';
import { hasDurableMediaStorageCapability } from './helpers/durable-media-storage-capability.js';

test('a newly frozen picture edits its duration in Clip properties with Undo', async ({ page }) => {
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
	const frozen = editor.getByRole('group', { name: /^Video clip: .* Freeze$/u }); await frozen.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Window', ['Clip properties']);
	const panel = editor.locator('[data-workspace-panel="clip-properties"]'); await showClipTimingFields(panel);
	const duration = panel.getByRole('group', { name: 'Duration', exact: true });
	await expect(duration.locator('.timecode-digit')).toHaveText([...'000000800']);
	await duration.locator('.timecode-digit').nth(5).click();
	await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
	await expect(duration.locator('.timecode-digit')).toHaveText([...'000001800']);
	await expect(panel.locator('[data-clip-field="sampleRate"]')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(duration.locator('.timecode-digit')).toHaveText([...'000000800']);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(duration.locator('.timecode-digit')).toHaveText([...'000001800']);
});
