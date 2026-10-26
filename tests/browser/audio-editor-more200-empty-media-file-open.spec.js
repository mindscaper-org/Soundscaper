/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';

test('opening an empty WAV reports the refusal while retaining the current project', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const id = await editor.getAttribute('data-project-id');
	const tabs = await editor.getByRole('tab').count();
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Empty take.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(0) });
	await expect(editor.getByRole('alert')).toContainText(/empty|failed/iu);
	await expect(editor).toHaveAttribute('data-project-id', id);
	await expect(editor.getByRole('tab')).toHaveCount(tabs);
	await expect(editor.getByRole('alert')).toContainText(/empty/iu);
});
