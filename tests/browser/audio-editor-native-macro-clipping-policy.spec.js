/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const allowClipping of [false, true]) test(`authored Amplify macro keeps its clipping policy with allowClipping=${allowClipping}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [createWavFixture({ name: 'Guarded gain.wav', frequency: 440, duration: 0.25, channelCount: 1, channelAmplitudes: [0.8] })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const before = await exportSamples(page, editor);
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New macro', exact: true }).click();
	await manager.getByRole('button', { name: 'Add effect', exact: true }).click();
	await page.getByRole('menu', { name: 'Choose an effect', exact: true }).getByRole('menuitem', { name: 'Amplify', exact: true }).click();
	await manager.getByRole('button', { name: 'Select effect', exact: true }).click();
	const settings = page.getByRole('dialog', { name: 'Amplify', exact: true });
	const gain = settings.locator('[data-effect-param="gainDb"]').getByRole('spinbutton');
	await gain.fill('6'); await gain.blur();
	await settings.locator('[data-effect-param="allowClipping"]').getByRole('checkbox').setChecked(allowClipping);
	await settings.getByRole('button', { name: 'Close', exact: true }).click();
	if (allowClipping) {
		const downloading = page.waitForEvent('download');
		await manager.getByRole('button', { name: 'Export macro', exact: true }).click();
		const download = await downloading, text = Buffer.from(await downloadBytes(download)).toString('utf8'); await download.delete();
		expect(text).toBe('Amplify:Ratio="1.9952623149688795"\n');
	} else {
		const downloads = []; page.on('download', download => downloads.push(download));
		await manager.getByRole('button', { name: 'Export macro', exact: true }).click();
		await expect(manager.getByRole('alert')).toContainText('Audacity Amplify macros cannot retain a no-clipping guard');
		expect(downloads).toHaveLength(0);
	}
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(manager).toContainText('Macro applied.');
	await manager.getByRole('button', { name: 'Close', exact: true }).click();
	const after = await exportSamples(page, editor);
	let product = 0, power = 0;
	for (let index = 100; index < before.length - 100; index += 1) {
		if (Math.abs(before[index]) <= 0.02 || Math.abs(before[index]) >= 0.2) continue;
		product += before[index] * after[index]; power += before[index] ** 2;
	}
	expect(product / power).toBeCloseTo(allowClipping ? 10 ** (6 / 20) : 1.25, 3);
});
