/* SPDX-License-Identifier: AGPL-3.0-only */
import { writeFile } from 'node:fs/promises';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors } from './audio-editor-test-helpers.js';
import { opusPaddingAvFixture } from '../helpers/ordinary-ogg-opus-fixture.ts';

test('Cancel releases a real pending native video frame before fresh import', async ({ page }, testInfo) => {
	await page.addInitScript(() => {
		const request = HTMLVideoElement.prototype.requestVideoFrameCallback;
		const cancel = HTMLVideoElement.prototype.cancelVideoFrameCallback;
		HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
			return request.call(this, (now, metadata) => {
				if (!globalThis.__holdImportFrame) { callback(now, metadata); return; }
				globalThis.__holdImportFrame = false;
				// Decode a real frame, then hold its delivery to the importer. The
				// Cancel action no longer races a browser-specific seek duration.
				globalThis.__heldImportFrame = { video: this, cancelled: false, released: false,
					release() { if (!this.released) { this.released = true; callback(now, metadata); } } };
			});
		};
		HTMLVideoElement.prototype.cancelVideoFrameCallback = function (id) {
			if (globalThis.__heldImportFrame?.video === this) globalThis.__heldImportFrame.cancelled = true;
			cancel.call(this, id);
		};
	});
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	// Keep the native decoder's file backing alive after the input is cleared.
	const file = opusPaddingAvFixture(), path = testInfo.outputPath(file.name);
	await writeFile(path, new Uint8Array(await file.arrayBuffer()));
	await page.evaluate(() => { globalThis.__holdImportFrame = true; });
	await editor.locator('[data-import-input]').setInputFiles(path);
	try {
		await expect.poll(() => page.evaluate(() => Boolean(globalThis.__heldImportFrame)), { timeout: 20_000 }).toBe(true);
		const progress = editor.locator('[data-editor-task-progress="import"]');
		await progress.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(progress).toHaveCount(0);
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
		expect(await page.evaluate(() => {
			const held = globalThis.__heldImportFrame;
			return { cancelled: held.cancelled, released: held.released,
				connected: held.video.isConnected, source: held.video.getAttribute('src') };
		})).toEqual({ cancelled: true, released: false, connected: false, source: null });
		await editor.locator('[data-import-input]').setInputFiles({ ...toneA, name: 'Fresh.wav' });
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.getByRole('group', { name: /^Fresh\.wav clip,/u })).toHaveCount(1);
		await page.evaluate(() => globalThis.__heldImportFrame.release());
		await expect(editor.getByRole('group', { name: /^Short audio/u })).toHaveCount(0);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toHaveCount(0);
		expect(errors).toEqual([]);
	} finally { await page.evaluate(() => globalThis.__heldImportFrame?.release()); }
});
