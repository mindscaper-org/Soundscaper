/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';

for (const sidecar of ['labels', 'cue']) test(`Cancel stops the remaining ${sidecar} files in a mixed File Import`, async ({ page }) => {
	await page.addInitScript(() => {
		const held = new WeakSet();
		const slice = File.prototype.slice;
		File.prototype.slice = function (...args) {
			const result = slice.apply(this, args);
			if (this.name === 'Cancel take.wav') held.add(result);
			return result;
		};
		let released = false;
		const waiting = [];
		globalThis.__mixedImportReleaseRead = () => {
			released = true;
			for (const resume of waiting) resume();
		};
		const read = Blob.prototype.arrayBuffer;
		Blob.prototype.arrayBuffer = async function () {
			if (held.has(this) && !released) {
				globalThis.__mixedImportReadPending = true;
				await new Promise(resolve => { waiting.push(resolve); });
			}
			return read.call(this);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const annotation = sidecar === 'labels'
		? { name: 'Later.txt', mimeType: 'text/plain', buffer: Buffer.from('0\t1\tLater label\n') }
		: { name: 'Later.cue', mimeType: 'application/x-cue', buffer: Buffer.from('FILE "Cancel take.wav" WAVE\n TRACK 01 AUDIO\n INDEX 01 00:00:00\n') };
	await editor.locator('[data-import-input]').setInputFiles([{ ...toneA, name: 'Cancel take.wav' }, annotation]);
	await expect.poll(() => page.evaluate(() => globalThis.__mixedImportReadPending)).toBe(true);
	const progress = editor.locator('[data-editor-task-progress="import"]');
	await progress.getByRole('button', { name: 'Cancel', exact: true }).click();
	await page.evaluate(() => globalThis.__mixedImportReleaseRead());
	await expect(progress).toHaveCount(0);
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await expect(page.locator('[data-cue-import-choice]')).toHaveCount(0);
	await expect(editor).toHaveAttribute('data-clip-count', '0');
});
