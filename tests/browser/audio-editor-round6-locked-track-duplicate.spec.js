/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('Track and selection Duplicate copy locked recordings and preserve their sources', async ({ page }) => {
	const caseTimeout = test.info().timeout;
	test.setTimeout(caseTimeout * 2);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [toneA]);
	const clips = clipByName(editor, toneA.name);
	const source = clips.first();
	const track = source.locator('xpath=ancestor::div[@data-track-row]');
	for (const entry of ['track', 'selection']) await test.step(`${entry} Duplicate`, async () => {
		await source.locator('.clip-header').click();
		await duplicate();
		await expect(clips).toHaveCount(2);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(clips).toHaveCount(1);
		await chooseTrackMenuAction(page, editor, track, 'Lock track');
		await source.locator('.clip-header').click();
		await duplicate();
		await expect(clips).toHaveCount(2);
		const copyTrack = clips.nth(1).locator('xpath=ancestor::div[@data-track-row]');
		await chooseTrackMenuAction(page, editor, copyTrack, 'Unlock track');
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(clips).toHaveCount(2);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(clips).toHaveCount(1);
		await chooseCommandAction(page, editor, 'Edit', 'Redo');
		await expect(clips).toHaveCount(2);
		await chooseTrackMenuAction(page, editor, track, 'Unlock track');
		await expect(clips).toHaveCount(2);

		if (entry === 'track') {
			for (let step = 0; step < 3; step++) await chooseCommandAction(page, editor, 'Edit', 'Undo');
			await expect(clips).toHaveCount(1);
		}

		async function duplicate() {
			if (entry === 'track') await chooseTrackMenuAction(page, editor, track, 'Duplicate track');
			else await chooseCommandAction(page, editor, 'Edit', 'Duplicate');
		}
	}, { timeout: caseTimeout });
});
