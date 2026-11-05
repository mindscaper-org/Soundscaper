/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('piano preview keys support keyboard traversal and audition without transport playback', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__pianoPreviewStarts = 0;
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.buffer && Math.abs(this.buffer.duration - 0.35) < 0.0001) globalThis.__pianoPreviewStarts++;
			return start.apply(this, args);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'keys.mid', mimeType: 'audio/midi', buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex') }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const noteEditor = panel.getByRole('group', { name: 'Note editor', exact: true });
	await noteEditor.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	await noteEditor.getByRole('button', { name: 'Preview selected note', exact: true }).focus();
	await page.keyboard.press('Tab');
	const tabStop = panel.locator('[data-piano-key][tabindex="0"]');
	await expect(tabStop).toHaveCount(1);
	await expect(tabStop).toBeFocused();
	const initialPitch = Number(await tabStop.getAttribute('data-piano-key'));
	for (let pitch = initialPitch; pitch > 61; pitch--) await page.keyboard.press('ArrowDown');
	const key = panel.getByRole('button', { name: 'C#4', exact: true });
	await expect(key).toBeFocused();
	await key.press('Enter');
	await expect.poll(() => page.evaluate(() => globalThis.__pianoPreviewStarts)).toBe(1);
	await key.press('Space');
	await expect.poll(() => page.evaluate(() => globalThis.__pianoPreviewStarts)).toBe(2);
	await expect(editor.locator('[data-transport="play"]').getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	await key.press('ArrowDown');
	await expect(panel.getByRole('button', { name: 'C4', exact: true })).toBeFocused();
});
