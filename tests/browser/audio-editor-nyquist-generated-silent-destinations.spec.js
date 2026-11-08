/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, closeClipProperties, importFiles, openClipProperties, showClipTimingFields } from './audio-editor-test-helpers.js';
import { setClipTimeFrames } from './audio-editor-clip-timing-test-helpers.js';

test('shipped Pluck Generate reaches every selected silent lane just like ordinary Tone Generate', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const files = [440, 660].map((frequency, index) => createWavFixture({ name: `nyquist-generator-quiet-${index}.wav`, frequency, duration: 1, channelCount: 1 }));
	await importFiles(editor, files);
	const properties = await openClipProperties(page, editor, clipByName(editor, files[1].name));
	await showClipTimingFields(properties); await setClipTimeFrames(properties, 'startFrame', 144000); await closeClipProperties(properties);
	const select = async () => {
		await clipByName(editor, files[0].name).locator('.clip-header').click();
		await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'Select all tracks']);
		await expect(editor.getByRole('group', { name: 'Selection end', exact: true }).locator('.timecode__display')).toHaveText('00h00m01.000s');
	};
	await select();
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const tone = page.getByRole('dialog', { name: 'Tone', exact: true });
	const duration = tone.getByRole('group', { name: 'Duration (seconds)', exact: true });
	await duration.locator('.timecode-digit').first().click(); await page.keyboard.type('000002000'); await page.keyboard.press('Enter');
	await expect(duration.locator('.timecode__display')).toHaveText('00h00m02.000s');
	await tone.getByRole('button', { name: 'Generate', exact: true }).click(); await expect(tone).toBeHidden();
	await expect(clipByName(editor, files[1].name)).toHaveAttribute('aria-label', /starts at 4 seconds/u);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clipByName(editor, files[1].name)).toHaveAttribute('aria-label', /starts at 3 seconds/u);
	await select();
	await chooseNestedCommandAction(page, editor, 'Generate', ['Nyquist', 'Pluck']);
	const pluck = page.getByRole('dialog', { name: 'Pluck', exact: true });
	const pluckDuration = pluck.getByRole('spinbutton', { name: 'Duration (60s max)', exact: true });
	await pluckDuration.fill('2'); await pluckDuration.press('Tab');
	await expect(pluckDuration).toHaveValue('2');
	await pluck.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(pluck).toBeHidden({ timeout: 20000 });
	await expect(editor.getByRole('group', { name: /^Audio clip clip, starts at 0 seconds, 2 seconds long/u }).first()).toBeVisible();
	await expect(clipByName(editor, files[1].name)).toHaveAttribute('aria-label', /starts at 4 seconds/u);
});
