/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, sourcePeakChannels } from './audio-editor-test-helpers.js';
import { aacLcAdtsPceFixture } from '../helpers/os-audio-codec-fixtures.ts';

for (const action of ['continue editing', 'undo import']) test(`audio clips allow ${action} while waveform analysis is pending`, async ({ page }) => {
	await page.addInitScript(() => {
		const post = Worker.prototype.postMessage, terminate = Worker.prototype.terminate;
		Worker.prototype.postMessage = function (...args) {
			const [message] = args;
			if (globalThis.__holdNextPeaks && message?.type === 'start' && Number.isSafeInteger(message.frameCount)) {
				globalThis.__holdNextPeaks = false;
				globalThis.__heldPeakWorker = this;
				globalThis.__releasePeakStart = () => { Reflect.apply(post, this, args); };
				return;
			}
			return Reflect.apply(post, this, args);
		};
		Worker.prototype.terminate = function () {
			if (globalThis.__heldPeakWorker === this) globalThis.__heldPeaksFinished = true;
			return terminate.call(this);
		};
	});
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await page.evaluate(() => { globalThis.__holdNextPeaks = true; });
	// Repeat complete ADTS frames so the decoded PCM exceeds the tiny-source local analysis limit.
	const aac = Buffer.from(aacLcAdtsPceFixture(false));
	await editor.locator('[data-import-input]').setInputFiles({
		name: 'Pending.bin', mimeType: 'application/octet-stream', buffer: Buffer.concat([aac, aac, aac, aac]),
	});
	try {
		await expect.poll(() => page.evaluate(() => Boolean(globalThis.__heldPeakWorker))).toBe(true);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.locator('[data-editor-task-progress="import"]')).toHaveCount(0);
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
		if (action === 'continue editing') {
			await editor.locator('[data-import-input]').setInputFiles({ ...toneA, name: 'Fresh.wav' });
			await expect(editor).toHaveAttribute('data-clip-count', '2');
		} else {
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect(editor).toHaveAttribute('data-clip-count', '0');
		}
		await page.evaluate(() => globalThis.__releasePeakStart());
		await expect.poll(() => page.evaluate(() => Boolean(globalThis.__heldPeaksFinished))).toBe(true);
		await expect(editor).toHaveAttribute('data-clip-count', action === 'continue editing' ? '2' : '0');
		if (action === 'continue editing') {
			await expect.poll(async () => (await sourcePeakChannels(page, 'Pending.bin')).channels.length).toBeGreaterThan(0);
		}
		await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toHaveCount(0);
		expect(errors).toEqual([]);
	} finally { await page.evaluate(() => globalThis.__releasePeakStart?.()); }
});
