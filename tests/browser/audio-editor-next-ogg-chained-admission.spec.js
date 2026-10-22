/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, closeWorkspacePanel, importFiles } from './audio-editor-test-helpers.js';
import { chainedOpusFixture } from '../helpers/ogg-multiplexed-tail-fixture.ts';

test('File Import reports a chained recording instead of silently importing its first link', async ({ page }) => {
	const fixture = await chainedOpusFixture();
	const editor = await bootEditor(page, '/embed/en/');
	if (await editor.locator('[data-workspace-panel="project-bin"]').isVisible()) await closeWorkspacePanel(editor, 'project-bin');
	await editor.locator('[data-import-input]').setInputFiles({ name: 'Radio recording.opus', mimeType: 'audio/ogg', buffer: Buffer.from(fixture.chained) });
	await expect(editor.getByRole('alert')).toContainText('1 failed');
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	await editor.getByRole('region', { name: 'Unknown error', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
	await importFiles(editor, [{ name: 'Single recording.opus', mimeType: 'audio/ogg', buffer: Buffer.from(fixture.first) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});
