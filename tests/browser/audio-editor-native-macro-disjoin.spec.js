/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeDialog, importFiles, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { encodeWav } from '../../src/common/editor/wav.js';

for (const nonzero of [false, true]) test(`native Disjoin retains quiet audio with nonzero=${nonzero}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const values = new Float32Array(48_000);
	for (let frame = 0; frame < values.length; frame++) {
		const middle = frame >= 12_000 && frame < 36_000;
		values[frame] = Math.sin(2 * Math.PI * 1000 * frame / 48_000) * (middle ? (nonzero ? .0005 : 0) : .2);
	}
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-track-row]').first().locator('.track-control-panel__track-name-text').click();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Remove tracks']);
	await importFiles(editor, [{ name: 'Quiet passage.wav', mimeType: 'audio/wav',
		buffer: Buffer.from(encodeWav([values], { sampleRate: 48_000, float: true })) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const before = passagePeak(await exportSamples(page, editor));
	if (nonzero) expect(before).toBeGreaterThan(.0003);
	else expect(before).toBeLessThan(1e-5);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	const choosing = page.waitForEvent('filechooser');
	await manager.getByRole('button', { name: 'Import macro', exact: true }).click();
	await (await choosing).setFiles({ name: 'Native Disjoin.txt', mimeType: 'text/plain', buffer: Buffer.from('Disjoin:\n') });
	await expect(manager.getByRole('textbox', { name: 'Macro name', exact: true })).toHaveValue('Native Disjoin');
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(editor.locator('[data-status]')).toHaveText('Done'); await closeDialog(manager);
	const after = await exportSamples(page, editor);
	expect(after.length).toBe(48_000);
	if (nonzero) {
		expect(passagePeak(after)).toBeGreaterThan(before * .9);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
	} else {
		expect(passagePeak(after)).toBeLessThan(1e-5);
		await expect(editor).toHaveAttribute('data-clip-count', '2');
	}
});

function passagePeak(samples) {
	return samples.slice(18_000, 30_000).reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
}

test('legacy Disjoin shortcut truthfully declines the local near-silence classifier', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	const choosing = page.waitForEvent('filechooser');
	await preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true }).click();
	await (await choosing).setFiles({ name: 'Native Disjoin.xml', mimeType: 'application/xml',
		buffer: Buffer.from('<audacitykeyboard><command name="Disjoin" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>') });
	const review = preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true });
	await expect(review.getByRole('status')).toHaveText('0 commands ready to import; 1 skipped.');
	await expect(review.getByRole('button', { name: 'Apply shortcuts', exact: true })).toBeDisabled();
	await review.getByText('Skipped shortcuts', { exact: true }).click();
	await expect(review.getByRole('listitem')).toHaveText('Disjoin: Command unavailable');
});
