/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { showClipTimingFields, bootEditor, chooseNestedCommandAction, closeWorkspacePanel, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';

test('video Properties shows source in on the native source clock after a normal trim', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1').file]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	await clip.press('Enter');
	await seekFramescaperTimecode(page, editor, '00:00:00:12');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Trim left edge to playhead']);
	const properties = await openClipProperties(page, editor, clip);
	await showClipTimingFields(properties);
	const sourceIn = properties.getByRole('group', { name: 'Source in', exact: true });
	await expect.poll(async () => (await sourceIn.locator('.timecode-digit').allTextContents()).slice(-3).join('')).toBe('400');
	await sourceIn.locator('.timecode-digit').nth(6).click();
	await page.keyboard.type('240');
	await page.keyboard.press('Enter');
	await closeWorkspacePanel(editor, 'clip-properties');
	await openClipProperties(page, editor, clip);
	await showClipTimingFields(properties);
	await expect.poll(async () => (await sourceIn.locator('.timecode-digit').allTextContents()).slice(-3).join('')).toBe('240');
});

for (const format of ['native frames', 'hundredths']) test(`video Properties uses source boundaries when editing VFR in ${format}`, async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [videoTimingProbeMedia.find(({ id }) => id === 'vfr-irregular-webm-v1').file]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	const properties = await openClipProperties(page, editor, clip);
	await showClipTimingFields(properties);
	const duration = properties.getByRole('group', { name: 'Duration', exact: true });
	await duration.locator('.timecode-digit').nth(6).click();
	await page.keyboard.type('300');
	await page.keyboard.press('Enter');
	const sourceIn = properties.getByRole('group', { name: 'Source in', exact: true });
	const digits = sourceIn.locator('.timecode-digit');
	const formatButton = sourceIn.getByRole('button', { name: 'Source in: format', exact: true });
	if (format === 'native frames') {
		await digits.nth(6).click();
		await page.keyboard.type('245');
		await page.keyboard.press('Enter');
		await expect.poll(async () => (await digits.allTextContents()).slice(-3).join('')).toBe('245');
		await formatButton.click();
		await page.getByRole('menuitem', { name: /^Video frames/u }).hover();
		await page.getByRole('menuitem', { name: /^film frames/u }).click();
		await expect(digits.last()).toHaveText('3');
		await digits.last().click();
		await page.keyboard.type('4');
		await page.keyboard.press('Enter');
	} else {
		await formatButton.click();
		await page.getByRole('menuitem', { name: 'hh:mm:ss + hundredths', exact: true }).click();
		await digits.nth(6).click();
		await page.keyboard.type('54');
		await page.keyboard.press('Enter');
	}
	await formatButton.click();
	await page.getByRole('menuitem', { name: 'hh:mm:ss + milliseconds', exact: true }).click();
	await expect.poll(async () => (await digits.allTextContents()).slice(-3).join('')).toBe('542');
});
