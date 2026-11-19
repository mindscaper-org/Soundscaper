/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, closeDialog, importFiles, openEffectsForTrack, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';

test('Limiter offers true peak limiting below its knobs and persists the choice', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Limiter');
	let dialog = page.getByRole('dialog', { name: 'Limiter', exact: true });
	let checkbox = dialog.getByRole('checkbox', { name: 'Limit True Peaks', exact: true });
	await expect(checkbox).not.toBeChecked();
	const bounds = await checkbox.boundingBox();
	const release = dialog.locator('[data-effect-param="releaseMs"]');
	const releaseBounds = await release.boundingBox();
	const primaryKnob = await dialog.locator('[data-effect-param="thresholdDb"]').getByRole('slider').boundingBox();
	const releaseKnob = await release.getByRole('slider').boundingBox();
	expect(bounds.y).toBeGreaterThanOrEqual(releaseBounds.y + releaseBounds.height);
	expect(primaryKnob.y).toBeLessThan(releaseKnob.y);
	await checkbox.check();
	await expect(checkbox).toBeChecked();
	await closeDialog(dialog);
	const projectId = await editor.getAttribute('data-project-id');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload();
	await waitForEditor(page);
	await expect(editor).toHaveAttribute('data-project-id', projectId);
	await waitForProjectActivation(editor);
	const reopenedPanel = await openEffectsForTrack(editor, 1);
	await reopenedPanel.getByRole('group', { name: 'Limiter', exact: true })
		.getByRole('button', { name: 'Select effect', exact: true }).click();
	dialog = page.getByRole('dialog', { name: 'Limiter', exact: true });
	checkbox = dialog.getByRole('checkbox', { name: 'Limit True Peaks', exact: true });
	await expect(checkbox).toBeChecked();
	await checkbox.uncheck();
	await expect(checkbox).not.toBeChecked();
});
