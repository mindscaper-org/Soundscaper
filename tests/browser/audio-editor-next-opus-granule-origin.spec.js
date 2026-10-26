/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';
import { croppedOpusGranuleFixture } from '../helpers/ogg-multiplexed-tail-fixture.ts';

test('ordinary file import retains cropped Opus audio with a nonzero granule origin', async ({ page }) => {
	const fixture = await croppedOpusGranuleFixture();
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'Cropped live stream.opus', mimeType: 'audio/ogg', buffer: Buffer.from(fixture.cropped) }]);
	const clip = editor.locator('[data-clip-id]').first();
	await expect(clip).toBeVisible();
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});
