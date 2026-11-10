/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const dryGainDb of [12, 10]) test(`authored Reverb keeps local gain and native compatibility at ${dryGainDb}dB`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [createWavFixture({ name: 'Reverb gain.wav', frequency: 440, duration: .25, channelCount: 1, channelAmplitudes: [.05] })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const before = await exportSamples(page, editor);
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New macro', exact: true }).click();
	await manager.getByRole('button', { name: 'Add effect', exact: true }).click();
	await page.getByRole('menu', { name: 'Choose an effect', exact: true }).getByRole('menuitem', { name: 'Reverb (Audacity)', exact: true }).click();
	await manager.getByRole('button', { name: 'Select effect', exact: true }).click();
	const settings = page.getByRole('dialog', { name: 'Reverb (Audacity)', exact: true });
	for (const [name, value] of [['preDelay', 200], ['dryGainDb', dryGainDb]]) {
		const field = settings.locator(`[data-effect-param="${name}"]`).getByRole('spinbutton');
		await field.fill(String(value)); await field.blur(); await expect(field).toHaveValue(String(value));
	}
	await settings.getByRole('button', { name: 'Close', exact: true }).click();
	if (dryGainDb > 10) {
		const downloads = []; page.on('download', download => downloads.push(download));
		await manager.getByRole('button', { name: 'Export macro', exact: true }).click();
		await expect(manager.getByRole('alert')).toContainText('WetGain / DryGain (dB) must be between -20 and 10.');
		expect(downloads).toHaveLength(0);
	} else {
		const downloading = page.waitForEvent('download');
		await manager.getByRole('button', { name: 'Export macro', exact: true }).click();
		const download = await downloading, text = Buffer.from(await downloadBytes(download)).toString('utf8');
		await download.delete();
		expect(text).toContain('DryGain="10"');
	}
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(manager).toContainText('Macro applied.');
	await manager.getByRole('button', { name: 'Close', exact: true }).click();
	const after = await exportSamples(page, editor);
	let cross = 0, power = 0;
	for (let index = 1000; index < 4000; index++) { cross += before[index] * after[index]; power += before[index] ** 2; }
	expect(cross / power).toBeCloseTo(10 ** (dryGainDb / 20), 2);
});
