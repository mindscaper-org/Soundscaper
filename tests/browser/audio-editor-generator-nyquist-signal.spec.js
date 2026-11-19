/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, commitInput, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const [name, fields] of [['Tone', ['frequency']], ['Chirp', ['startFrequency', 'endFrequency']], ['Morse code', ['frequency']]]) {
	test(`${name} generates a nonzero sine signal at the admitted Nyquist frequency`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Generate', name);
		const dialog = page.getByRole('dialog', { name, exact: true });
		for (const key of fields) await commitInput(dialog.locator(`[data-generator-field="${key}"] input`).first(), '24000');
		await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		const samples = (await exportSamples(page, editor, { sampleRate: 48_000 })).slice(240, 248);
		expect(samples).toHaveLength(8);
		for (const [index, sample] of samples.entries()) expect(sample * (index % 2 ? -1 : 1)).toBeGreaterThan(0.75);
	});
}
