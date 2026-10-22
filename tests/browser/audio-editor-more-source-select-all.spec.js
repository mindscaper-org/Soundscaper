/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openSourceMonitor } from './audio-editor-test-helpers.js';

test('Select All in the source waveform accepts the uppercase key produced by Caps Lock', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const file = createWavFixture({ name: 'source-key.wav', duration: 2, channelCount: 1 });
	await importFiles(editor, [file]);
	const panel = await openSourceMonitor(page, editor, clipByName(editor, file.name));
	const wave = panel.getByRole('region', { name: 'Source waveform', exact: true });
	await wave.press('Control+A');
	await expect(wave.locator('.audio-editor-source-selection')).toHaveCount(1);
	await expect(wave.locator('.audio-editor-source-selection')).toHaveAttribute('style', /left: 0px; width:/u);
});
