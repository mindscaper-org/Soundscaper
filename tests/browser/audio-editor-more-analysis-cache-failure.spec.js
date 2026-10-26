/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

for (const failure of ['read', 'write']) test(`Analyze selection exports its valid report after an IndexedDB cache ${failure} failure`, async ({ page }) => {
	await page.addInitScript(({ failing }) => {
		const get = IDBObjectStore.prototype.get, put = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.get = function (key) {
			if (failing === 'read' && this.name === 'analysis' && String(key).startsWith('audio-editor-analysis-v5:')) {
				throw new DOMException('Analysis cache unavailable', 'InvalidStateError');
			}
			return get.call(this, key);
		};
		IDBObjectStore.prototype.put = function (value, key) {
			if (failing === 'write' && this.name === 'analysis' && String(value?.key).startsWith('audio-editor-analysis-v5:')) {
				throw new DOMException('Analysis cache quota exceeded', 'QuotaExceededError');
			}
			return key === undefined ? put.call(this, value) : put.call(this, value, key);
		};
	}, { failing: failure });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'cached analysis.wav', duration: 1, channelCount: 1 })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Analyze', 'Analyze selection');
	const dialog = page.getByRole('dialog', { name: 'Analyze selection', exact: true });
	await expect(dialog.locator('[data-analysis-report="levels"]')).toBeVisible();
	const downloading = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = await downloading;
	const report = JSON.parse(await readFile(await download.path(), 'utf8'));
	expect(report.mode).toBe('levels');
	expect(report.result.peakDbfs).toBeLessThan(0);
});
