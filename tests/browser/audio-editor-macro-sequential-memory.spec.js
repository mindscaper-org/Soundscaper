/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('a sixteen-track Normalize macro fits the existing memory budget and produces normalized audio', async ({ page }) => {
	test.setTimeout(225_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const recording = createWavFixture({ name: 'Microphone.wav', frequency: 330, duration: 10 });
	const files = Array.from({ length: 16 }, (_, index) => ({ ...recording, name: `Microphone ${index + 1}.wav` }));
	await editor.getByRole('status').and(editor.locator('[data-status]')).evaluate(status => {
		// Keep the warning observable when the next import replaces it between polls.
		const observer = new MutationObserver(() => {
			if (!status.textContent.includes('exceeds the tested envelope')) return;
			globalThis.__sawMacroCapacityWarning = true;
			observer.disconnect();
		});
		observer.observe(status, { childList: true, characterData: true, subtree: true });
	});
	await editor.locator('[data-import-input]').setInputFiles(files);
	await expect(editor.getByRole('button', { name: /^Rename track: Microphone \d+$/u })).toHaveCount(16, { timeout: 60_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	expect(await page.evaluate(() => globalThis.__sawMacroCapacityWarning)).toBe(true);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	const manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	const [chooser] = await Promise.all([page.waitForEvent('filechooser'), manager.getByRole('button', { name: 'Import macro', exact: true }).click()]);
	await chooser.setFiles({ name: 'Normalize microphones.txt', mimeType: 'text/plain', buffer: Buffer.from('Normalize:ApplyVolume="1" PeakLevel="-1" RemoveDcOffset="1" StereoIndependent="0"\n') });
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(manager.getByRole('status')).toHaveText('Macro applied.', { timeout: 60_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'processing');
	await manager.getByRole('button', { name: 'Close', exact: true }).last().click();
	const finalTrack = editor.locator('[data-track-row]').filter({
		has: page.getByRole('button', { name: 'Rename track: Microphone 16', exact: true }),
	});
	await finalTrack.getByRole('button', { name: 'Solo', exact: true }).click();
	const pcm = await exportSamples(page, editor, { includeTail: false, renderTimeout: 75_000 });
	const peak = pcm.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
	expect(peak).toBeCloseTo(10 ** (-1 / 20), 3);
});
