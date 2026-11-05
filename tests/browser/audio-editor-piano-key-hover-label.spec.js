/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('hovering a black piano key reveals its note name inside the key', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'keyboard.mid', mimeType: 'audio/midi', buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex') }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const key = panel.locator('.kw-audio-editor__piano-roll-grid > div:first-child > div:last-child > div').filter({ has: page.locator('div[style*="linear-gradient"]') }).nth(1);
	await key.hover();
	const label = key.locator('span');
	await expect(label).toContainText('#');
	await expect(label).toBeInViewport({ ratio: 1 });
});
