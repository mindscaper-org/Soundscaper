/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { chooseCommandAction, collectClientErrors } from './audio-editor-test-helpers.js';
import { openVampAnalyzer } from './helpers/vamp-analyzer-fixture.js';

test('publishing Vamp labels closes the completed dialog and keeps one undoable result', async ({ page }) => {
	const errors = collectClientErrors(page);
	const dialog = await openVampAnalyzer(page, { features: [{ outputId: 'onsets',
		timestamp: { seconds: 0, nanoseconds: 50_000_000 }, duration: null, values: [], label: 'Detected onset' }] });
	await dialog.getByRole('button', { name: 'Analyze', exact: true }).click();
	const publish = dialog.getByRole('button', { name: 'Publish labels', exact: true });
	await expect(publish).toBeEnabled();
	await publish.click();
	const editor = page.locator('[data-audio-editor]');
	const labels = editor.locator('[data-label-id]');
	await expect(labels).toHaveCount(1);
	await expect(labels).toHaveAttribute('aria-label', 'Edit labels: Detected onset');
	await expect(dialog).toBeHidden();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(labels).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(labels).toHaveCount(1);
	expect(errors).toEqual([]);
});
