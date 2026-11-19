/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';
import { croppedOpusGranuleFixture, multiplexedOpusFixture } from '../helpers/ogg-multiplexed-tail-fixture.ts';

test('ordinary File Import and playback admit cropped and multiplexed primary Opus streams', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const cropped = await croppedOpusGranuleFixture();
	await importFiles(editor, [{ name: 'Cropped live stream.opus', mimeType: 'audio/ogg', buffer: Buffer.from(cropped.cropped) }]);
	await expect(clipByName(editor, 'Cropped live stream.opus')).toBeVisible();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const multiplexed = await multiplexedOpusFixture();
	await importFiles(editor, [{ name: 'Two languages.opus', mimeType: 'audio/ogg', buffer: Buffer.from(multiplexed.multiplexed) }]);
	await expect(clipByName(editor, 'Two languages.opus')).toBeVisible();
	await expect(editor.locator('[data-clip-id]')).toHaveCount(2);
	await expect(editor.getByRole('alert')).toHaveCount(0);
	expect(errors).toEqual([]);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});
