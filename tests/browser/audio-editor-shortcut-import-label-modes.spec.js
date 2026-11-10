/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, halfMinuteTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

for (const [command, playing] of [['AddLabel', true], ['AddLabelPlaying', false]]) {
	test(`legacy ${command} import preserves the local ${playing ? 'live' : 'stopped'} label mode`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false }); await importFiles(editor, [halfMinuteTone]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
		const choosing = page.waitForEvent('filechooser');
		await preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true }).click();
		await (await choosing).setFiles({ name: 'audacity.xml', mimeType: 'application/xml',
			buffer: Buffer.from(`<audacitykeyboard audacityversion="3.7.7"><command name="${command}" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>`) });
		const review = preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true });
		await expect(review.getByRole('status')).toHaveText('0 commands ready to import; 1 skipped.');
		await expect(review.getByRole('button', { name: 'Apply shortcuts', exact: true })).toBeDisabled();
		await review.getByText('Skipped shortcuts', { exact: true }).click();
		await expect(review.getByRole('listitem')).toHaveText(`${command}: Command unavailable`);
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		if (playing) {
			await editor.getByRole('button', { name: 'Play', exact: true }).click();
			await expect.poll(async () => {
				const text = await editor.getByRole('group', { name: 'Playhead', exact: true }).locator('.timecode__display').textContent();
				const match = /^(\d+)h(\d+)m([\d.]+)s$/u.exec(text);
				expect(match).not.toBeNull();
				return (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 48_000;
			}).toBeGreaterThan(12_000);
		}
		await editor.getByRole('group', { name: 'Playhead', exact: true }).focus();
		await page.keyboard.press('Control+Alt+Shift+F7');
		const marker = editor.locator('[data-label-track] [data-label-id]');
		await expect(marker).toHaveCount(0);
		await page.keyboard.press('Control+b');
		await expect(marker).toHaveCount(1);
		await expect(marker).toHaveAttribute('data-point-label', playing ? 'true' : 'false');
		if (playing) await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	});
}
