/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { createPngFixture } from '../helpers/png-fixture.mjs';

test('Add Images does not import an outgoing file choice into a newly created project', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const outgoingId = await editor.getAttribute('data-project-id');
	const selecting = page.waitForEvent('filechooser'); await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
	const outgoing = await selecting;
	await editor.getByRole('button', { name: 'New project', exact: true }).click();
	await expect(editor).not.toHaveAttribute('data-project-id', outgoingId);
	await outgoing.setFiles({ name: 'outgoing.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	// The next serialized picker opening proves the outgoing gesture settled.
	const selectingFresh = page.waitForEvent('filechooser'); await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
	const fresh = await selectingFresh;
	await expect(editor.getByRole('group', { name: /^Image clip:/u })).toHaveCount(0);
	await fresh.setFiles({ name: 'incoming.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	await expect(editor.getByRole('group', { name: 'Image clip: incoming', exact: true })).toBeVisible();
	await expect(editor.getByRole('group', { name: /^Image clip:/u })).toHaveCount(1);
});
