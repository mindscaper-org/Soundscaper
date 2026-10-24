/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { aacLcM4a48_000Fixture } from '../helpers/os-audio-codec-fixtures.ts';

for (const rejectLate of [false, true]) test(`Cancel retires a real native audio decode before fresh File Import (late failure=${rejectLate})`, async ({ page }) => {
	await page.addInitScript(rejectLate => {
		const nativeDecode = BaseAudioContext.prototype.decodeAudioData;
		BaseAudioContext.prototype.decodeAudioData = function (...args) {
			const operation = Reflect.apply(nativeDecode, this, args);
			if (!globalThis.__holdNextImportDecode) return operation;
			globalThis.__holdNextImportDecode = false;
			return operation.then(decoded => {
				globalThis.__heldImportDecode = { rate: decoded.sampleRate, channels: decoded.numberOfChannels, frames: decoded.length };
				return new Promise((resolve, reject) => { globalThis.__releaseImportDecode = () => {
					globalThis.__importDecodeReleased = true;
					if (rejectLate) reject(new DOMException('Old decoder failed.', 'EncodingError')); else resolve(decoded);
				}; });
			});
		};
	}, rejectLate);
	const editor = await bootEditor(page, '/embed/en/');
	await page.evaluate(() => { globalThis.__holdNextImportDecode = true; });
	await editor.locator('[data-import-input]').setInputFiles({ name: 'Pending.bin', mimeType: 'application/octet-stream', buffer: Buffer.from(aacLcM4a48_000Fixture()) });
	try {
		await expect.poll(() => page.evaluate(() => globalThis.__heldImportDecode?.channels ?? 0)).toBe(2);
		const progress = editor.locator('[data-editor-task-progress="import"]');
		await progress.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(progress).toHaveCount(0);
		expect(await page.evaluate(() => Boolean(globalThis.__importDecodeReleased))).toBe(false);
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
		await editor.locator('[data-import-input]').setInputFiles({ ...toneA, name: 'Fresh.wav' });
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
		await expect(editor.getByRole('group', { name: /^Fresh\.wav clip,/u })).toHaveCount(1);
		await page.evaluate(() => globalThis.__releaseImportDecode());
		await expect.poll(() => page.evaluate(() => globalThis.__importDecodeReleased)).toBe(true);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.getByRole('group', { name: /^Pending\.bin clip,/u })).toHaveCount(0);
		await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toHaveCount(0);
	} finally { await page.evaluate(() => globalThis.__releaseImportDecode?.()); }
});

for (const rejectLate of [false, true]) test(`Cancel retires a real optional marker read before fresh File Import (late failure=${rejectLate})`, async ({ page }) => {
	await page.addInitScript(rejectLate => {
		const nativeSlice = Blob.prototype.slice;
		Blob.prototype.slice = function (start, end, type) {
			const result = Reflect.apply(nativeSlice, this, [start, end, type]);
			if (!(this instanceof File) || this.name !== 'Pending.bin' || start !== 0 || end !== 12) return result;
			globalThis.__markerSignatureReads = (globalThis.__markerSignatureReads ?? 0) + 1;
			// Three attribution probes precede the optional marker signature.
			if (globalThis.__markerSignatureReads !== 4) return result;
			const read = result.arrayBuffer.bind(result);
			result.arrayBuffer = () => {
				globalThis.__markerReadHeld = true;
				return new Promise((resolve, reject) => { globalThis.__releaseMarkerRead = () => {
					globalThis.__markerReadReleased = true;
					if (rejectLate) reject(new Error('Old marker read failed.')); else resolve(read());
				}; });
			};
			return result;
		};
	}, rejectLate);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-import-input]').setInputFiles({ name: 'Pending.bin', mimeType: 'application/octet-stream', buffer: Buffer.from(aacLcM4a48_000Fixture()) });
	try {
		await expect.poll(() => page.evaluate(() => globalThis.__markerReadHeld)).toBe(true);
		const progress = editor.locator('[data-editor-task-progress="import"]');
		await progress.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(progress).toHaveCount(0);
		expect(await page.evaluate(() => Boolean(globalThis.__markerReadReleased))).toBe(false);
		await editor.locator('[data-import-input]').setInputFiles({ ...toneA, name: 'Fresh.wav' });
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
		await expect(editor.getByRole('group', { name: /^Fresh\.wav clip,/u })).toHaveCount(1);
		await page.evaluate(() => globalThis.__releaseMarkerRead());
		await expect.poll(() => page.evaluate(() => globalThis.__markerReadReleased)).toBe(true);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.getByRole('group', { name: /^Pending\.bin clip,/u })).toHaveCount(0);
		await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toHaveCount(0);
	} finally { await page.evaluate(() => globalThis.__releaseMarkerRead?.()); }
});
