/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';

test('New project quietly retires a pending MIDI file read and malformed imports still report errors', async ({ page }) => {
	await page.addInitScript(() => {
		const read = File.prototype.arrayBuffer;
		File.prototype.arrayBuffer = async function () {
			const bytes = await read.call(this);
			if (this.name === 'deferred.mid') {
				globalThis.__midiReadEntered = true;
				await new Promise(resolve => { globalThis.__releaseMidiRead = resolve; });
			}
			return bytes;
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const previous = await editor.getAttribute('data-project-id');
	const importing = editor.locator('[data-import-input]');
	await importing.setInputFiles({ name: 'deferred.mid', mimeType: 'audio/midi',
		buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex') });
	await expect.poll(() => page.evaluate(() => Boolean(globalThis.__midiReadEntered))).toBe(true);
	await editor.getByRole('button', { name: 'New project', exact: true }).click();
	await expect(editor).not.toHaveAttribute('data-project-id', previous);
	await page.evaluate(async () => {
		globalThis.__releaseMidiRead();
		// Drain the resumed read and workspace rejection, then its React paint.
		await new Promise(resolve => { requestAnimationFrame(() => { requestAnimationFrame(resolve); }); });
	});
	const error = page.locator('[data-editor-toast="workspace-error"]');
	await expect(error).toHaveCount(0);
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	await importing.setInputFiles({ name: 'broken.mid', mimeType: 'audio/midi', buffer: Buffer.from('invalid') });
	await expect(error).toBeVisible();
});
