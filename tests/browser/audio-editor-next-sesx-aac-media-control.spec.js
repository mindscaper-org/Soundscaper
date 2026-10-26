/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, clipByName, sourcePeakChannels } from './audio-editor-test-helpers.js';
import { aacLcM4a48_000Fixture } from '../helpers/os-audio-codec-fixtures.ts';

// The desktop SESX resolver regression uses the identical authenticated AAC body.
// This shipping import control independently exercises real browser decoding;
// the desktop admission regression records its existing utility-codec port.
test('the AAC body used by the SESX filename regression decodes through File Import', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const name = 'SESX AAC control.m4a';
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles({ name, mimeType: 'audio/mp4', buffer: Buffer.from(aacLcM4a48_000Fixture()) });
	await expect(clipByName(editor, name)).toBeVisible();
	const peaks = await sourcePeakChannels(page, name);
	expect(peaks.channelCount).toBe(2);
	for (const channel of peaks.channels) {
		expect(channel.minimum).toBeLessThan(-0.05); expect(channel.maximum).toBeGreaterThan(0.05);
	}
});
