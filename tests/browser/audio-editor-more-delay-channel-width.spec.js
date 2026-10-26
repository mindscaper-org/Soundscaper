/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, clipByName, closeDialog, commitInput, disableNativeSavePicker,
	importFiles, openEffectsForTrack, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

for (const label of ['Feedback delay', 'Bass and Treble']) test(`${label} retains channel identity after a wide source ends on a mixed-width track`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const wide = createWavFixture({ name: 'wide silence.wav', sampleRate: 48_000, duration: .25,
		channelCount: 8, channelAmplitudes: Array(8).fill(0) });
	const mono = createWavFixture({ name: 'mono continuing.wav', sampleRate: 48_000, duration: 1,
		channelCount: 1, channelAmplitudes: [.4], frequency: 750 });
	await importFiles(editor, [wide, mono]);
	const clip = clipByName(editor, mono.name);
	await clip.click({ button: 'right', position: { x: 32, y: 10 } });
	const move = page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: /^Move to track \(preserve time\)/u });
	await move.hover();
	await move.getByRole('menuitem', { name: /wide silence/u }).click();
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', label);
	const effect = page.getByRole('dialog', { name: label, exact: true });
	if (label === 'Feedback delay') {
		await commitInput(effect.locator('[data-effect-param="time"] input[type="number"]'), '.01');
		await commitInput(effect.locator('[data-effect-param="feedback"] input[type="number"]'), '0');
		await commitInput(effect.locator('[data-effect-param="mix"] input[type="number"]'), '1');
	}
	await closeDialog(effect);
	const dialog = await openExportDialog(page, editor);
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const bytes = await readDownloadBytes(page, link);
	const levels = await page.evaluate(async data => {
		const context = new OfflineAudioContext(2, 1, 48_000);
		const audio = await context.decodeAudioData(Uint8Array.from(data).buffer);
		return Array.from({ length: 2 }, (_, channel) => {
			const samples = audio.getChannelData(channel);
			const peak = (from, to) => samples.slice(from, to).reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);
			return { before: peak(4800, 9600), after: peak(24000, 36000) };
		});
	}, Array.from(bytes));
	expect(levels[0].after).toBeGreaterThan(.1);
	expect(levels[1].before).toBeLessThan(.0001);
	expect(levels[1].after).toBeLessThan(.0001);
});
