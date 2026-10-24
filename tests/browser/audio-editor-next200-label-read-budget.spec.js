/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction } from './audio-editor-test-helpers.js';

let directory;
test.beforeAll(async () => {
	directory = await mkdtemp(path.join(tmpdir(), 'soundscaper-label-budget-'));
	for (const format of ['srt', 'cue']) {
		const target = path.join(directory, `Too large.${format}`);
		await writeFile(target, ''); await truncate(target, 3 * 16 * 1024 * 1024 + 4);
	}
});
test.afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

for (const format of ['srt', 'cue']) test(`File Import refuses oversized ${format} before allocating its full native buffer`, async ({ page }) => {
	await page.addInitScript(() => {
		const read = Blob.prototype.arrayBuffer;
		window.__oversizedLabelReads = 0;
		Blob.prototype.arrayBuffer = function (...args) {
			if (this instanceof File && this.name.startsWith('Too large.')) window.__oversizedLabelReads += 1;
			return Reflect.apply(read, this, args);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles(path.join(directory, `Too large.${format}`));
	if (format === 'cue') await page.locator('[data-cue-import-choice]').getByRole('button', { name: 'Labels', exact: true }).click();
	await expect(editor.getByRole('alert')).toContainText('input limit');
	expect(await page.evaluate(() => window.__oversizedLabelReads)).toBe(0);
	await expect(editor.locator('[data-label-id]')).toHaveCount(0);
	const retry = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Import');
	await (await retry).setFiles({ name: 'Healthy.srt', mimeType: 'application/x-subrip', buffer: Buffer.concat([
		Buffer.from([0xff, 0xfe]), Buffer.from('1\r\n00:00:00,000 --> 00:00:01,000\r\n漢字\r\n', 'utf16le'),
	]) });
	await expect(editor.locator('[data-label-id]')).toHaveAttribute('aria-label', 'Edit labels: 漢字');
});
