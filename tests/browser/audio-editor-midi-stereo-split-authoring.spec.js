/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, closeClipProperties, disableNativeSavePicker,
	importFiles, openClipProperties, showClipTimingFields } from './audio-editor-test-helpers.js';
import { setClipTimeFrames } from './audio-editor-clip-timing-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const split of [false, true]) test(`MIDI note editing retains rendered level ${split ? 'after mixed stereo split' : 'on an ordinary mixed lane'}`, async ({ page }) => {
	test.setTimeout(60_000);
	await page.setViewportSize({ width: 1440, height: 1000 });
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const bed = createWavFixture({ name: 'Stereo bed.wav', sampleRate: 48000, channelCount: 2, frequency: 330, duration: 1 });
	await importFiles(editor, [bed]);
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'MIDI track (beta)']);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	await panel.getByRole('button', { name: 'Add note', exact: true }).click();
	const midi = clipByName(editor, 'MIDI track (beta)');
	await expect(midi).toBeVisible();
	const properties = await openClipProperties(page, editor, midi);
	await showClipTimingFields(properties);
	await setClipTimeFrames(properties, 'startFrame', 144000);
	await closeClipProperties(properties);
	const destination = clipByName(editor, bed.name).locator('xpath=ancestor::*[@data-track-row][1]');
	const destinationId = await destination.getAttribute('data-track-id');
	const destinationLabel = await destination.getByRole('button', { name: /^Rename track:/u }).getAttribute('aria-label');
	if (!destinationId || !destinationLabel) throw new Error('Expected the imported stereo destination.');
	const destinationName = destinationLabel.slice('Rename track: '.length);
	await midi.click({ button: 'right', position: { x: 32, y: 10 } });
	const move = page.getByRole('menuitem', { name: /^Move to track \(preserve time\)/u });
	await move.hover();
	await move.getByRole('menuitem', { name: destinationName, exact: true }).click();
	await expect(midi.locator('xpath=ancestor::*[@data-track-row][1]')).toHaveAttribute('data-track-id', destinationId);
	const noteRms = values => Math.sqrt(values.slice(145200, 147600).reduce((sum, value) => sum + value * value, 0) / 2400);
	const original = noteRms(await exportSamples(page, editor));
	expect(original).toBeGreaterThan(.001);
	if (split) {
		await chooseTrackMenuAction(page, editor, destination, ['Track channels', 'Split stereo to left/right mono']);
		await expect(editor).toHaveAttribute('data-clip-count', '4');
		const splitLevel = noteRms(await exportSamples(page, editor));
		expect(splitLevel / original).toBeGreaterThan(.98);
		expect(splitLevel / original).toBeLessThan(1.02);
	}
	await midi.locator('.clip-header').click();
	await panel.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	const velocity = panel.getByRole('spinbutton', { name: 'Velocity', exact: true });
	await expect(velocity).toHaveValue('100');
	await velocity.fill('99');
	await velocity.press('Enter');
	await expect(velocity).toHaveValue('99');
	const edited = noteRms(await exportSamples(page, editor));
	expect(edited / original).toBeGreaterThan(.97);
	expect(edited / original).toBeLessThan(1.01);
});
