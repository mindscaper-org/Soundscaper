/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('Motion Tracking sample display uses the project sample clock for its native video boundary', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('motion-clock.webm')]);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Managed Color & Source Interpretation']);
	const color = page.getByRole('dialog', { name: 'Managed Color & Source Interpretation', exact: true });
	const sourceId = JSON.parse(await color.getByRole('textbox', { name: 'Canonical finishing document', exact: true }).inputValue()).videoSourceColorInterpretations[0].sourceId;
	await color.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseCommandAction(page, editor, 'Analyze', 'Motion Tracking');
	const dialog = page.getByRole('dialog', { name: 'Motion Tracking', exact: true });
	const document = dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true });
	const state = JSON.parse(await document.inputValue());
	state.videoProcessorStacks = [{ schemaVersion: 1, id: 'clock-stack', sourceId, processors: [{
		schemaVersion: 1, id: 'tracking', kind: 'tracking', enabled: true, maximumFeatures: 32,
		quality: 0.01, minimumDistance: 2, windowRadius: 2, pyramidLevels: 2,
	}] }];
	await document.fill(JSON.stringify(state)); await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Finishing state updated.');
	const end = dialog.getByRole('group', { name: 'End frame', exact: true });
	await end.getByRole('button', { name: 'End frame: format', exact: true }).click();
	await page.getByRole('menuitem', { name: 'seconds + milliseconds', exact: true }).click();
	await expect(end.locator('.timecode__display')).toHaveText('000,002.152s');
	await end.getByRole('button', { name: 'End frame: format', exact: true }).click();
	await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	// The same2.152second source boundary on the48kHzproject sample clock.
	await expect.poll(async () => (await end.locator('.timecode-digit').allTextContents()).join('')).toBe('000000103296');
});
