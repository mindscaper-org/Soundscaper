/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, clipByName, closeClipProperties, closeDialog, importFiles, openClipProperties, openSourceMonitor, showClipTimingFields } from './audio-editor-test-helpers.js';
import { setClipTimeFrames } from './audio-editor-clip-timing-test-helpers.js';

test('a moved clip Auto Duck auditions in the source editor with its guide', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, ['music', 'guide'].map((name, index) => createWavFixture({ name: `${name}.wav`, frequency: index ? 1000 : 330, duration: 4, channelCount: 1 })));
	const clip = clipByName(editor, 'music.wav');
	const properties = await openClipProperties(page, editor, clip);
	await showClipTimingFields(properties);
	await setClipTimeFrames(properties, 'startFrame', 48000);
	await properties.getByText('Effects', { exact: true }).click();
	await addRackEffect(page, properties, 'track', 'Auto Duck');
	await closeDialog(page.getByRole('dialog', { name: 'Auto Duck', exact: true }));
	await closeClipProperties(properties);
	const source = await openSourceMonitor(page, editor, clip);
	await source.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(source.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await expect.poll(() => source.getByRole('slider', { name: 'Source timeline', exact: true }).getAttribute('aria-valuenow')).not.toBe('0');
	await source.getByRole('button', { name: 'Stop', exact: true }).click();
});
