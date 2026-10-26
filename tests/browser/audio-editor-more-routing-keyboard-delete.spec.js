/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('Delete on a routing bus keeps its confirmation available through the selection change', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Window', 'Mixer');
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
	await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	const graph = mixer.locator('[data-soundscaper-routing-graph]');
	const node = graph.locator('[data-routing-node^="mixer-node:"]').first();
	await node.locator('.kw-routing-graph__node-main').press('Delete');
	const confirm = graph.getByRole('button', { name: 'Confirm delete', exact: true });
	await expect(confirm).toBeVisible();
	await confirm.click();
	await expect(node).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(node).toHaveCount(1);
});
