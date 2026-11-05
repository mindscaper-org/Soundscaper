/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../../src/soundscaper/editor-project-commands.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

const ORIGINAL = 'Opening\nRoom tone';

test('native send name retains its multiline text through ordinary append and Undo', async ({ page }) => {
	const project = applySoundscaperProjectCommand(createSoundscaperProject({ id: 'multiline-output-name' }),
		{ type: 'mixer/bus-add', busType: 'send', bus: { id: 'send', name: ORIGINAL } });
	expect(project.mixer.sends[0].name).toBe(ORIGINAL);
	const store = createProjectStore({ indexedDB: null, preferOpfs: false });
	let bytes;
	try {
		bytes = Buffer.from(await (await exportScapeProject(project, store)).blob.arrayBuffer());
	} finally {
		await store.close();
	}
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Multiline.sscape', mimeType: 'application/zip', buffer: bytes });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	const row = editor.locator('[data-output-track-row][data-output-scope="send"]');
	const display = row.locator('.track-control-panel__track-name-text');
	await expect.poll(() => display.textContent()).toBe(ORIGINAL);
	await display.dblclick();
	const field = row.getByRole('textbox');
	await expect(field).toBeFocused();
	await expect(field).toHaveValue(ORIGINAL);
	await field.press('Control+End');
	await field.pressSequentially('!');
	await field.press('Enter');
	await expect(field).toHaveCount(0);
	await expect.poll(() => display.textContent()).toBe(`${ORIGINAL}!`);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(() => display.textContent()).toBe(ORIGINAL);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(() => display.textContent()).toBe(`${ORIGINAL}!`);
});
