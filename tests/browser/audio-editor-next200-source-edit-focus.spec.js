/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openSourceMonitor } from './audio-editor-test-helpers.js';

for (const sourceFocused of [true, false]) test(`Cut uses the focused editing surface, source=${sourceFocused}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const file = createWavFixture({ name: 'Focus recording.wav', duration: 1, channelCount: 1 });
	await importFiles(editor, [file]);
	const clip = clipByName(editor, file.name);
	if (sourceFocused) {
		const panel = await openSourceMonitor(page, editor, clip);
		const waveform = panel.getByRole('region', { name: 'Source waveform', exact: true });
		const box = await waveform.boundingBox();
		if (!box) throw new Error('Missing source waveform');
		await page.mouse.move(box.x + box.width / 4, box.y + 80);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2, box.y + 80, { steps: 4 });
		await page.mouse.up();
		await waveform.press('Control+x');
		await expect(clip).toBeVisible();
	} else {
		await clip.focus();
		await clip.press('Control+x');
		await expect(clip).toHaveCount(0);
	}
});
