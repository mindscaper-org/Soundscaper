/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';
import { multiplexedOpusFixture } from '../helpers/ogg-multiplexed-tail-fixture.ts';

test('File Import opens primary Ogg audio before a longer secondary stream ends', async ({ page }) => {
	const fixture = await multiplexedOpusFixture();
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'Two languages.opus', mimeType: 'audio/ogg', buffer: Buffer.from(fixture.multiplexed) }]);
	await expect(clipByName(editor, 'Two languages.opus')).toBeVisible();
	await expect(editor.locator('[data-clip-id]')).toHaveCount(1);
	expect(errors).toEqual([]);
});
