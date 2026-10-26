/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, openExportDialog, downloadBytes, closeDialog } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone, persistedProject } from './helpers/complex-editing-workflows.js';

test.use({ browserCoverage: false });

test('Stop cancels a pending recording storage check and a late response cannot stop the retry', async ({ page }) => {
	await installOscillatorMicrophone(page);
	await page.addInitScript(() => {
		const gate = { armed: false, calls: 0, release: () => {} };
		globalThis.__recordStartGate = gate;
		Object.defineProperty(globalThis, 'showSaveFilePicker', { configurable: true, value: undefined });
		const storage = navigator.storage ?? {};
		Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
		Object.defineProperty(storage, 'estimate', { configurable: true, value: async () => {
			if (!gate.armed || globalThis.__complexWorkflowStreams.length === 0) return { usage: 0, quota: 2 ** 30 };
			gate.armed = false; gate.calls++;
			return await new Promise(resolve => { gate.release = () => resolve({ usage: 0, quota: 2 ** 30 }); });
		} });
	});
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const projectId = await editor.getAttribute('data-project-id');
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await page.evaluate(() => { globalThis.__recordStartGate.armed = true; });
	await record.click();
	await expect.poll(() => page.evaluate(() => globalThis.__recordStartGate.calls)).toBe(1);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(record).toBeEnabled();
	await record.click();
	await expect(record).toHaveAttribute('aria-pressed', 'true');
	const start = Number(await playhead.getAttribute('aria-valuenow'));
	await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(start + 12_000);
	await page.evaluate(() => globalThis.__recordStartGate.release());
	await expect(record).toHaveAttribute('aria-pressed', 'true');
	const afterLateResponse = Number(await playhead.getAttribute('aria-valuenow'));
	await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(afterLateResponse + 12_000);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const saved = await persistedProject(page, projectId);
	expect(saved.sources).toHaveLength(1);
	expect(saved.sources[0].frameCount).toBeGreaterThan(24_000);
	const dialog = await openExportDialog(page, editor);
	let downloaded = false;
	const download = page.waitForEvent('download');
	void download.then(() => { downloaded = true; }, () => {});
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect.poll(async () => downloaded || await link.isVisible()).toBe(true);
	if (!downloaded) await link.click();
	const bytes = await downloadBytes(await download);
	const peak = await page.evaluate(async data => {
		const context = new AudioContext();
		try {
			const audio = await context.decodeAudioData(Uint8Array.from(data).buffer);
			return audio.getChannelData(0).reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
		} finally { await context.close(); }
	}, Array.from(bytes));
	expect(peak).toBeGreaterThan(.03);
	await closeDialog(dialog);
	expect(errors).toEqual([]);
});
