/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { chooseCommandAction, collectClientErrors } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { closeDissolve, openDissolve, ordinaryCameraPair, setClipSamples } from './helpers/round7-dissolve-user-path.js';

test('ordinary camera dissolve retains independent audio locks and one-frame admission', async ({ page }) => {
	// Preserve the original90s/60s journey budgets while sharing their
	// actual native import, physical Split tool and healthy Apply/Remove setup.
	test.setTimeout(150_000);
	const errors = collectClientErrors(page);
	const { editor, outgoing } = await ordinaryCameraPair(page);
	await test.step('an independently locked audio partner blocks the dissolve until unlocked', async () => {
		const audioTrack = editor.locator('[data-track-row]:has([data-spectrogram-scale]):has([data-clip-id][role="group"])').first();
		await expect(audioTrack).toBeVisible();
		await expect(audioTrack.locator('[data-clip-id][role="group"]')).toHaveCount(2);
		await chooseTrackMenuAction(page, editor, audioTrack, 'Lock track');
		const dialog = await openDissolve(page, editor, outgoing);
		await expect(dialog.getByRole('combobox', { name: 'Outgoing → incoming', exact: true })).toHaveCount(0);
		await expect(dialog.getByRole('button', { name: 'Apply dissolve', exact: true })).toHaveCount(0);
		await closeDissolve(page, dialog);
		await chooseTrackMenuAction(page, editor, audioTrack, 'Unlock track');
		const restored = await openDissolve(page, editor, outgoing);
		await restored.getByRole('button', { name: 'Apply dissolve', exact: true }).click();
		await expect(restored.getByRole('status')).toHaveText('Selected authored state applied.');
		await restored.getByRole('button', { name: 'Remove dissolve', exact: true }).click();
		await expect(restored.getByRole('status')).toHaveText('Selected authored state removed.');
		await closeDissolve(page, restored);
		expect(errors).toEqual([]);
	}, { timeout: 90_000 });
	await test.step('one normally trimmed frame offers no impossible dissolve and Undo restores it', async () => {
		await setClipSamples(page, editor, outgoing, 'durationFrame', 1_600);
		const dialog = await openDissolve(page, editor, outgoing);
		await expect(dialog.getByRole('combobox', { name: 'Outgoing → incoming', exact: true })).toHaveCount(0);
		await expect(dialog.getByRole('alert')).toHaveText('Select one clip from an unlocked video track containing an adjacent pair.');
		await expect(dialog.getByRole('button', { name: 'Apply dissolve', exact: true })).toHaveCount(0);
		await closeDissolve(page, dialog);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		const restored = await openDissolve(page, editor, outgoing);
		await expect(restored.getByRole('button', { name: 'Apply dissolve', exact: true })).toBeEnabled();
		expect(errors).toEqual([]);
	}, { timeout: 60_000 });
});
