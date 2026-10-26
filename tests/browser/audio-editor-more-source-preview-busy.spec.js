/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openSourceMonitor } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone } from './helpers/complex-editing-workflows.js';

test.use({ browserCoverage: false });
for (const gesture of ['ruler', 'space', 'panel-space', 'ruler-key']) test(`source preview ${gesture} honors recording admission`, async ({ page }) => {
	await installOscillatorMicrophone(page);
	const editor = await bootEditor(page, '/embed/en/');
	const file = createWavFixture({ name: 'audition.wav', duration: 8, channelCount: 1 });
	await importFiles(editor, [file]);
	const properties = await openSourceMonitor(page, editor, clipByName(editor, file.name));
	const source = properties.locator('[data-clip-source-editor]');
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	await record.click();
	try {
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		await expect(source.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
		const playhead = source.locator('.audio-editor-source-playhead');
		const position = await playhead.evaluate(element => element.style.left);
		if (gesture === 'ruler') {
			const bounds = await source.locator('.audio-editor-source-ruler__scale').boundingBox();
			expect(bounds).not.toBeNull();
			await page.mouse.click(bounds.x + 150, bounds.y + 30);
		}
		else if (gesture === 'ruler-key') await source.locator('.audio-editor-source-ruler__scale').press('End');
		else if (gesture === 'panel-space') await properties.locator('[data-clip-properties-active-clip]').press('Space');
		else await source.locator('.audio-editor-source-wave-area').press('Space');
		await expect(source.getByRole('button', { name: 'Play', exact: true })).toBeDisabled({ timeout: 2_000 });
		await expect(source.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		expect(await playhead.evaluate(element => element.style.left)).toBe(position);
	} finally {
		await editor.locator('[data-transport="stop"] button').first().click({ timeout: 5_000 });
	}
});
