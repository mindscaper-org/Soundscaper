/* SPDX-License-Identifier: AGPL-3.0-only */
import { writeFile } from 'node:fs/promises';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, sourcePeakChannels } from './audio-editor-test-helpers.js';
import { opusPaddingAvFixture } from '../helpers/ordinary-ogg-opus-fixture.ts';

for (const action of ['continue editing', 'undo import']) test(`staged video import allows ${action} while a native thumbnail is pending`, async ({ page }, testInfo) => {
	await page.addInitScript(() => {
		const request = HTMLVideoElement.prototype.requestVideoFrameCallback;
		const cancel = HTMLVideoElement.prototype.cancelVideoFrameCallback;
		HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
			return request.call(this, (now, metadata) => {
				if (!globalThis.__holdImportFrame || this.getAttribute('aria-hidden') !== 'true') { callback(now, metadata); return; }
				globalThis.__holdImportFrame = false;
				// Decode a real frame, then hold its delivery to the importer. The
				// The pending derivative cannot race a browser-specific seek duration.
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
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await expect(editor.locator('[data-editor-task-progress="import"]')).toHaveCount(0);
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
		await expect.poll(async () => (await sourcePeakChannels(page, `${file.name.replace(/\.[^.]+$/u, '')} Audio`)).channels.length).toBeGreaterThan(0);
		if (action === 'continue editing') {
			await editor.locator('[data-import-input]').setInputFiles({ ...toneA, name: 'Fresh.wav' });
			await expect(editor).toHaveAttribute('data-clip-count', '3');
			await expect(editor.getByRole('group', { name: /^Fresh\.wav clip,/u })).toHaveCount(1);
		} else {
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect(editor).toHaveAttribute('data-clip-count', '0');
		}
		await page.evaluate(() => globalThis.__heldImportFrame.release());
		if (action === 'continue editing') {
			await expect(editor.locator('.audio-editor-video-clip__thumbnail img').first()).toBeVisible();
			await expect(editor).toHaveAttribute('data-clip-count', '3');
		} else {
			await expect.poll(() => page.evaluate(() => globalThis.__heldImportFrame.video.isConnected)).toBe(false);
			await expect(editor).toHaveAttribute('data-clip-count', '0');
		}
		await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toHaveCount(0);
		expect(errors).toEqual([]);
	} finally { await page.evaluate(() => globalThis.__heldImportFrame?.release()); }
});
